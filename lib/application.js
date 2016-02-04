'use strict'

const assert = require('assert')
const cluster = require('cluster')
const EventEmitter = require('events').EventEmitter

const assertArgs = require('assert-args')
const co = require('co')
const defaults = require('101/defaults')
const exists = require('101/exists')
const isEmpty = require('101/is-empty')
const isObject = require('101/is-object')
const isGeneratorFunction = require('is-generator').fn
const koaCompose = require('koa-compose')
const noop = require('101/noop')

const assertAndConsumeAppQueue = require('./rabbit-utils/assert-and-consume-app-queue.js')
const assertGeneratorFunctions = require('./utils/assert-generator-functions.js')
const callbackOrPromise = require('./utils/cb-or-promise.js')
const ClusterManager = require('./cluster-manager.js')
const Context = require('./context.js')
const createAppConnection = require('./rabbit-utils/create-app-connection.js')
const createAppChannel = require('./rabbit-utils/create-app-channel.js')
const debug = require('./utils/debug')()
const getEnv = require('./utils/get-env.js')
const NoAckError = require('./no-ack-error.js')
const respond = require('./rabbit-utils/app-respond.js')

module.exports = Application
module.exports.NoAckError = NoAckError

/**
 * Initialize a new `Application` inherits from EventEmitter
 * @constructor
 * @param  {Object|RabbitSchema} [options|schema] coworkers application options or rabbitmq schema
 * @param  {RabbitSchema} [options.schema] a RabbitMQ schema created by https://npmjs.com/rabbitmq-schema, optional
 * @param  {Boolean} [options.cluster] whether to use clustering or not
 * @param  {String} [options.queueName] queue name which this application is consuming
 * @api public
 */
function Application (options) {
  if (!(this instanceof Application)) return new Application(options)
  EventEmitter.call(this)
  // options defaults
  const env = getEnv()
  const COWORKERS_CLUSTER = env.COWORKERS_CLUSTER
  const COWORKERS_QUEUE = env.COWORKERS_QUEUE
  const COWORKERS_QUEUE_WORKER_NUM = env.COWORKERS_QUEUE_WORKER_NUM || 1
  options = options || {}
  // hack: instanceof check while avoiding rabbitmq-schema dep (for now)
  if (options.constructor.name === 'Schema') {
    options = { schema: options }
  }
  defaults(options, {
    cluster: COWORKERS_CLUSTER,
    queueName: COWORKERS_QUEUE,
    queueWorkerNum: COWORKERS_QUEUE_WORKER_NUM
  })
  defaults(options, {
    cluster: true
  })
  // set options on app
  this.schema = options.schema
  this.queueName = options.queueName
  this.queueWorkerNum = options.queueWorkerNum
  // validate options
  if (options.cluster && cluster.isMaster) {
    this.clusterManager = new ClusterManager(this)
    if (exists(options.queueName)) {
      console.warn('warn: "queueName" is not required when clustering is enabled')
    }
  } else {
    assert(exists(options.queueName), '"queueName" is required for consumer processes')
  }
  // app properties
  this.context = {}
  this.middlewares = []
  this.queueMiddlewares = {
    // <queueName>: [middlewares...]
  }
  Object.defineProperty(this, 'queueNames', {
    get () {
      return Object.keys(this.queueMiddlewares)
    }
  })
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
   * Use the given middleware for all queue consumers
   * @param  {GeneratorFunction} middleware
   * @return {Application} self
   */
  use (middleware) {
    assert(isGeneratorFunction(middleware), 'app.use() requires all middlewares to be generators')
    debug('use %s', middleware.name || '-')

    this.middlewares.push(middleware)

    return this
  },
  /**
   * Setup queue assertion options, consume options, and message handler w/ middleware
   *   `connect` will assert queue and initiates consumption of queues
   * @param  {String} queueName queue name for which the middleware will be used
   * @param  {Object} [queueOpts] queue options, not required if rabbit-schema is being used
   * @param  {Object} [consumeOpts] consume options
   * @param  {GeneratorFunction} ...middlewares one middleware is required
   * @return {Application} self
   */
  queue (queueName, queueOpts, consumeOpts /*, ...middlewares */) {
    let middlewares
    let args

    if (this.schema) {
      // queueOpts should not be passed if this.schema exists
      assert(!isObject(arguments[2]), 'app.queue() cannot use "queueOpts" when using a schema')
      args = assertArgs(arguments, {
        'queueName': 'string',
        '[consumeOpts]': 'object',
        '...middlewares': assertGeneratorFunctions
      })
      queueName = args.queueName
      consumeOpts = args.consumeOpts
      middlewares = args.middlewares

      let queueSchema = this.schema.getQueueByName(queueName)
      assert(queueSchema, `app.queue() requires "${queueName}" queue to exist in schema`)
      queueOpts = queueSchema.options
    } else {
      args = assertArgs(arguments, {
        'queueName': 'string',
        '[queueOpts]': 'object',
        '[consumeOpts]': 'object',
        '...middlewares': assertGeneratorFunctions
      })
      queueName = args.queueName
      queueOpts = args.queueOpts || {}
      consumeOpts = args.consumeOpts || {}
      middlewares = args.middlewares
      debug('queue %s, %o, %o, %s',
        queueName, queueOpts, consumeOpts,
        middlewares.length === 1
          ? middlewares[0].name || '-'
          : middlewares.length + ' middlewares')
    }

    assert(!this.queueMiddlewares[queueName], `"${queueName}" already exists`)
    this.queueMiddlewares[queueName] = []
    this.queueMiddlewares[queueName] = this.queueMiddlewares[queueName].concat(middlewares)

    this.queueMiddlewares[queueName].queueOpts = queueOpts
    this.queueMiddlewares[queueName].consumeOpts = consumeOpts

    return this
  },
  /**
   * Connect to RabbitMQ
   * 1) Creates a connection to rabbitmq - http://www.squaremobius.net/amqp.node/channel_api.html#connect
   * 2) Creates a consumer channel and publisher channel - http://www.squaremobius.net/amqp.node/channel_api.html#model_createChannel
   * 3) Begins consuming queues
   * Note on Clustering:
   *   If using clustering and isMaster, it will create all workers and wait for them to connect to RabbitMQ.
   *   If any of the workers fail to connect to Rabbitmq they will cause master's connect to error.
   * @param {String} [url] rabbitmq connection url, default: 'amqp://127.0.0.1:5672'
   * @param {Object} [socketOpts] socket options
   * @param {Function} [cb] callback, not required if using promises
   * @return {Promise} promise, if no callback is supplied
   */
  connect (url, socketOpts, cb) {
    debug('connect')
    assert(!isEmpty(this.queueMiddlewares), 'App requires consumers, please use "queue" before calling connect')
    assert(this.listeners('error').length > 0, 'App requires an error handler (very important, please read the docs)')
    const self = this
    const args = assertArgs(arguments, {
      '[url]': 'string',
      '[socketOpts]': 'object',
      '[cb]': 'function'
    })

    url = args.url || getEnv().COWORKERS_RABBITMQ_URL
    socketOpts = args.socketOpts
    cb = args.cb
    // check for pending connect
    if (this.connectingPromise) {
      return callbackOrPromise(this.connectingPromise, cb)
    }
    // check for pending close
    if (this.closingPromise) {
      this.connectingPromise = this.closingPromise
        .catch(function (err) {
          const connectErr = new Error('Connect cancelled because pending close failed (.closeErr)')
          connectErr.closeErr = err
          // delete connecting promise, connect cancelled
          delete self.connectingPromise
          throw connectErr
        })
        .then(function () {
          // delete connecting promise, new connecting promise will be created in connect
          delete self.connectingPromise
          return self.connect(url, socketOpts)
        })
      return callbackOrPromise(this.connectingPromise, cb)
    }
    // connect to rabbitmq and start consuming messages
    const prepend = self.clusterManager ? 'master: ' : ''
    this.connectingPromise = co(function * () {
      if (self.clusterManager) {
        // clusterManager is only initialized for cluster.isMaster
        // start cluster manager, idempotent
        yield self.clusterManager.start()
        // return!
        return
      }
      assert(self.queueName in self.queueMiddlewares,
        '"app.queueName" must match a queue being consumed')
      if (!self.connection) {
        // app.connection
        yield createAppConnection(self, url, socketOpts)
      }
      if (!self.consumerChannel) {
        // app.consumerChannel
        yield createAppChannel(self, 'consumerChannel') // uses: self.connection
      }
      if (!self.publisherChannel) {
        // app.publisherChannel
        yield createAppChannel(self, 'publisherChannel') // uses: self.connection
      }
      if (!exists(self.consumerTag)) {
        self.consumerTag = yield assertAndConsumeAppQueue(self, self.queueName)
      }
      if (cluster.isWorker && !self.sigintHandler) {
        // handle worker messages
        // if message === coworkers:shutdown, close worker
        self.sigintHandler = function () {
          debug('recieved SIGINT, exit gracefully or throw err')
          return self.close().catch(function (err) {
            process.nextTick(function () {
              throw err
            })
          })
        }
        process.on('SIGINT', self.sigintHandler)
      }
    }).then(function () {
      // delete connecting-promise ref
      debug(prepend + 'connect success')
      delete self.connectingPromise
      if (process.send) {
        process.send({ coworkersEvent: 'coworkers:connect' })
      }
    }).catch(function (connectErr) {
      debug(prepend + 'connect errored', connectErr)
      if (process.send) {
        process.send({ coworkersEvent: 'coworkers:connect:error' })
      }
      // delete connecting-promise ref
      delete self.connectingPromise
      // close will clean up hanging refs
      debug(prepend + 'connect errored -> close to cleanup')
      return self.close()
        .catch(noop) // ignore close error
        .then(function () {
          throw connectErr
        })
    })

    return callbackOrPromise(this.connectingPromise, cb)
  },
  /**
   * Message handler attached to all queues
   * @param  {String} queueName name of queue that is the message's source
   * @param  {Buffer} message message recieved from queue
   * @return {Function} handler(message)
   */
  messageHandler (queueName) {
    const self = this
    const middlewares = this.middlewares.concat(this.queueMiddlewares[queueName])
    const mwPromise = co.wrap(koaCompose(middlewares))

    /**
     * message handler for the queue w/ queueName
     * @param  {object} message  rabbitmq message
     * @param  {Context} [_MockContext] optional, can be used for testing
     * @return {Promise} middleware chain promise
     */
    return function (message, _MockContext) {
      const context = _MockContext
        ? new _MockContext(self, queueName, message)
        : new Context(self, queueName, message)

      return mwPromise.call(context).then(function () {
        respond.call(context)
      }).catch(function (err) {
        Context.onerror(context, err)
      }).then(function () {
        return context // return context, for aiding testing
      })
    }
  },
  /**
   * Disconnect from RabbitMQ, idempotent
   * @param  {Function} [cb] callback, not required if using promises
   * @return {Promise}  promise, if no callback is supplied
   */
  close (cb) {
    debug('close')
    const self = this
    // check for pending close
    if (this.closingPromise) {
      return callbackOrPromise(this.closingPromise, cb)
    }
    // check for pending connect
    if (this.connectingPromise) {
      this.closingPromise = this.connectingPromise
        .catch(function (err) {
          const closeErr = new Error('Close cancelled because pending connect failed (.closeErr)')
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
      if (self.clusterManager) {
        // clusterManager is only initialized for cluster.isMaster
        // stop clusterManager, idempotent
        yield self.clusterManager.stop()
        // return!
        return
      }
      if (self.consumerChannel) {
        // close consumer channel
        let channel = self.consumerChannel
        channel.removeListener('close', channel.__coworkersCloseHandler)
        channel.removeListener('error', channel.__coworkersErrorHandler)
        yield channel.close()
      }
      if (exists(self.consumerTag)) {
        // delete consumer tags
        delete self.consumerTag
      }
      if (self.producerChannel) {
        // close producer channel
        let channel = self.producerChannel
        channel.removeListener('close', channel.__coworkersCloseHandler)
        channel.removeListener('error', channel.__coworkersErrorHandler)
        yield channel.close()
      }
      if (self.connection) {
        // close connection
        let connection = self.connection
        connection.removeListener('close', connection.__coworkersCloseHandler)
        connection.removeListener('error', connection.__coworkersErrorHandler)
        yield connection.close()
      }
      if (self.sigintHandler) {
        // handle worker messages
        // if message === shutdown, close worker
        process.removeListener('SIGINT', self.sigintHandler)
        delete self.sigintHandler
      }
      // delete closing-promise ref
      debug('close success')
      delete self.closingPromise
      if (process.send) {
        process.send({ coworkersEvent: 'coworkers:close' })
      }
    }).catch(function (closeErr) {
      debug('close errored', closeErr.stack)
      if (process.send) {
        process.send({ coworkersEvent: 'coworkers:close:error' })
      }
      // delete closing-promise ref
      delete self.closingPromise
      throw closeErr
    })

    return callbackOrPromise(this.closingPromise, cb)
  }
})
