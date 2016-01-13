'use strict'

const assert = require('assert')
const EventEmitter = require('events').EventEmitter

const assertArgs = require('assert-args')
const co = require('co')
const isEmpty = require('101/is-empty')
const koaCompose = require('koa-compose')
const noop = require('101/noop')

const Context = require('./context.js')
const callbackOrPromise = require('./utils/cb-or-promise.js')
const createAppConnection = require('./rabbit-utils/create-app-connection.js')
const createAppChannel = require('./rabbit-utils/create-app-channel.js')
const consumeAppQueues = require('./rabbit-utils/consume-app-queues.js')
const respond = require('./rabbit-utils/app-respond.js')

const isGeneratorFunction = require('is-generator').fn
const assertGeneratorFunctions = function (fn) {
  assert(isGeneratorFunction(fn), 'must be generator functions')
}
const logErr = function (err) {
  const msg = (err.stack || err.toString()).replace(/^/gm, '  ')

  console.error()
  console.error(msg)
  console.error()
}
const nextTickThrowErr = function (err) {
  // escape "try..catch" and throw an error to crash the process
  process.nextTick(function () {
    throw err
  })
}

module.exports = Application

/**
 * Initialize a new `Application` inherits from EventEmitter
 * @constructor
 * @param  {RabbitSchema} [schema]  a RabbitMQ schema created by https://npmjs.com/rabbitmq-schema, optional
 * @api public
 */
function Application (schema) {
  if (!(this instanceof Application)) return new Application(schema)

  EventEmitter.call(this)

  if (schema) {
    this.schema = schema
  }

  this.middlewares = []
  this.queueMiddlewares = {
    // <queueName>: [middlewares...]
  }
  /*
  this.connection = <amqplibConnection>
  this.consumerChannel = <amqplibChannel>
  this.publisherChannel = <amqplibChannel>
  this.consumerTags = [...]
  */
}

/**
 * Inherit from `Emitter.prototype`.
 */
Object.setPrototypeOf(Application.prototype, EventEmitter.prototype)

Object.assign(Application.prototype, {
  /**
   * Use the given middleware for all queues
   * @param  {GeneratorFunction} middleware
   * @return {Application} self
   */
  use (middleware) {
    assert(isGeneratorFunction(middleware), 'app.use() requires all middlewares to be generators')

    this.middlewares.push(middleware)

    return this
  },
  /**
   * Setup consumer queue message handler middlewares
   * @param  {String} queueName queue name for which the middleware will be used
   * @param  {Object} [options] consume options
   * @param  {GeneratorFunction} ...middlewares one middleware is required
   * @return {Application} self
   */
  consume (queueName, options /*, ...middlewares */) {
    let middlewares
    const args = assertArgs(arguments, {
      'queueName': 'string',
      '[options]': 'object',
      '...middlewares': assertGeneratorFunctions
    })
    queueName = args.queueName
    options = args.options
    middlewares = args.middlewares

    if (this.schema) {
      assert(this.schema.getQueueByName(queueName), "app.consume() requires queue with 'queueName' to exist in schema")
    }

    this.queueMiddlewares[queueName] = this.queueMiddlewares[queueName] || []

    this.queueMiddlewares[queueName] = this.queueMiddlewares[queueName].concat(middlewares)

    if (options) {
      this.queueMiddlewares[queueName].options = options
    }

    return this
  },
  /**
   * Message handler attached to all queues
   * @param  {String} queueName name of queue that is the message's source
   * @param  {Buffer} message message recieved from queue
   */
  messageHandler (queueName) {
    const self = this
    const middlewares = this.middlewares.concat(this.queueMiddlewares[queueName])
    const handler = co.wrap(koaCompose(middlewares))
    return function (message) {
      const ctx = new Context(self, queueName, message)
      handler.call(ctx).then(function () {
        return respond.call(ctx)
      }).catch(function (err) {
        return ctx.onerror(err)
      })
        // of `onerror` errors escape try..catch and throw `err`
        .catch(nextTickThrowErr)
    }
  },
  /**
   * Connect to RabbitMQ, idempotent
   * Creates a connection to rabbitmq - http://www.squaremobius.net/amqp.node/channel_api.html#connect
   * and creates a consume channel and publish channel - http://www.squaremobius.net/amqp.node/channel_api.html#model_createChannel
   * @param {String} [url] rabbitmq connection url, default: 'http://127.0.0.1:5672'
   * @param {Object} [socketOptions] socket options
   * @param {Function} [cb] callback, not required if using promises
   * @return {Promise} if no callback is supplied
   */
  connect (url, socketOptions, cb) {
    assert(!isEmpty(this.queueMiddlewares), 'App requires consumers, please use consume before calling connect')
    const self = this
    const args = assertArgs(arguments, {
      'url': 'string',
      '[socketOptions]': 'object',
      '[cb]': 'function'
    })
    url = args.url
    socketOptions = args.socketOptions
    cb = args.cb
    // check for pending connect
    if (this.connectingPromise) {
      return callbackOrPromise(this.connectingPromise, cb)
    }
    // check for pending close
    if (this.closingPromise) {
      this.connectingPromise = this.closingPromise
        .catch(function (err) {
          const connectErr = new Error('Connect cancelled because pending close failed (closeErr)')
          connectErr.closeErr = err
          // delete connecting promise, connect cancelled
          delete self.connectingPromise
          throw connectErr
        })
        .then(function () {
          // delete connecting promise, new connecting promise will be created in connect
          delete self.connectingPromise
          return self.connect(url, socketOptions)
        })
      return callbackOrPromise(this.connectingPromise, cb)
    }
    // connect to rabbitmq and start consuming messages
    this.connectingPromise = co(function * () {
      if (!self.connection) {
        // app.connection
        yield createAppConnection(self, url, socketOptions)
      }
      if (!self.consumerChannel) {
        // app.consumerChannel
        yield createAppChannel(self, 'consumerChannel')
      }
      if (!self.publisherChannel) {
        // app.publisherChannel
        yield createAppChannel(self, 'publisherChannel')
      }
      if (!self.consumerTags) {
        self.consumerTags = yield consumeAppQueues(self)
      }
      // delete connecting-promise ref
      delete self.connectingPromise
    }).catch(function (connectErr) {
      // delete connecting-promise ref
      delete self.connectingPromise
      // close will clean up hanging refs
      return self.close()
        .catch(noop) // ignore close error
        .then(function () {
          throw connectErr
        })
    })

    return callbackOrPromise(this.connectingPromise, cb)
  },
  /**
   * Disconnect from RabbitMQ, idempotent
   * @param  {Function} [cb] callback, not required if using promises
   * @return {Promise}  if no callback is supplied
   */
  close (cb) {
    const self = this
    // check for pending close
    if (this.closingPromise) {
      return callbackOrPromise(this.closingPromise, cb)
    }
    // check for pending connect
    if (this.connectingPromise) {
      this.closingPromise = this.connectingPromise
        .catch(function (err) {
          const closeErr = new Error('Close cancelled because pending connect failed (closeErr)')
          closeErr.connectErr = err
          // delete closing promise, close cancelled
          delete self.closingPromise
          throw closeErr
        })
        .then(function () {
          // delete closing promise, new closing promise will be created in close
          delete self.closingPromise
          return self.close()
        })
      return callbackOrPromise(this.closingPromise, cb)
    }
    // close channel and connection to rabbitmq
    this.closingPromise = co(function * () {
      if (self.consumerChannel) {
        // close consumer channel
        yield self.consumerChannel.close()
        // delete consumer tags
        delete self.consumerTags
      }
      if (self.producerChannel) {
        // close producer channel
        yield self.producerChannel.close()
      }
      if (self.connection) {
        // close connection
        yield self.connection.close()
      }
      // delete closing-promise ref
      delete self.closingPromise
    }).catch(function (closeErr) {
      // delete closing-promise ref
      delete self.closingPromise
      throw closeErr
    })

    return callbackOrPromise(this.closingPromise, cb)
  },
  /**
   * error handler
   * @param  {Error} err handle message handler errors
   */
  onerror (err) {
    const ctx = this
    const app = ctx.app
    return co(function * () {
      assert(err instanceof Error, 'non-error thrown: ' + err)
      if (!app.silent) {
        logErr(err)
      }

      // If allUpTo is truthy, all outstanding messages prior to and including the given message are rejected
      const allUpTo = false
      // If requeue is truthy, the server will try to put the message or messages back on the source queue(s)
      const requeue = true
      // call nack directly on consumerChannel
      return yield ctx.consumerChannel.nack(ctx.message, allUpTo, requeue)
    }).catch(function (err) {
      logErr(err)
      throw err
    })
  },
  /**
   * final handler, when a message is not acknowledged in anyway
   * @param  {[type]} ) {             const ctx [description]
   * @return {[type]}   [description]
   */
  finalhandler () {
    const ctx = this

    return ctx.onerror(new Error('Message reached final handler w/out any ack'))
  }
})
