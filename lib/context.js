'use strict'
const assert = require('assert')

const assertArgs = require('assert-args')
const assign = require('101/assign')
const co = require('co')
const clone = require('101/clone')
const defaults = require('101/defaults')
const exists = require('101/exists')
const first = require('ee-first')
const isObject = require('101/is-object')
const pick = require('101/pick')
const uuid = require('uuid')
const values = require('object-values')

const castBuffer = require('cast-buffer')
const defineProperties = require('./utils/define-properties.js')

module.exports = class Context {
  constructor (app, queueName, message) {
    const queue = app.queueMiddlewares[queueName]
    // set message.context
    message.context = this
    // instances
    this.app = app
    this.connection = app.connection
    this.consumerChannel = app.consumerChannel
    this.publisherChannel = app.publisherChannel
    // properties
    this.queueName = queueName
    this.message = message
    this.deliveryTag = message.fields.deliveryTag
    this.queueOpts = clone(queue.queueOpts)
    this.consumeOpts = clone(queue.consumeOpts)
    this.messageAcked // set by create-app-channel.js
    this.state = {}
    // defined properties
    // * special behavior, not enumerable, not writable
    var channelAction = {}
    Object.defineProperty(this, 'ack', channelActionProperty('ack', ['allUpTo'])) // defaults: allUpTo=false
    Object.defineProperty(this, 'nack', channelActionProperty('nack', ['allUpTo', 'requeue'])) // defaults: allUpTo=false, requeue=true
    Object.defineProperty(this, 'ackAll', channelActionProperty('ackAll', []))
    Object.defineProperty(this, 'nackAll', channelActionProperty('nackAll', ['requeue'])) // defaults: requeue=true
    Object.defineProperty(this, 'reject', channelActionProperty('reject', ['requeue'])) // defaults: requeue=false
    function channelActionProperty (method, argNames) {
      return {
        configurable: true,
        get () {
          return channelAction.method === method
            ? channelAction.args
            : undefined
        },
        set (value) {
          if (!value) {
            // falsy value, unset if set
            if (channelAction.method === method) {
              channelAction = {}
            }

            return value
          } else if (!isObject(value)) {
            value = {}
          }

          channelAction.method = method
          channelAction.args = pick(value, argNames)

          return value
        }
      }
    }
    // last, inherit properties from app.context
    defaults(this, app.context)
  }
  static onerror (context, err) {
    const acks = [
      'ack',
      'nack',
      'ackAll',
      'nackAll',
      'reject'
    ]
    defineProperties(context, acks, {
      get: throwUseChannelErr,
      set: throwUseChannelErr
    })
    // emit the error
    context.app.emit('error', err, context)
    // util
    function throwUseChannelErr () {
      throw new Error('Ack shortcuts are not available in the errorHandler, please use "consumerChannel" methods directly')
    }
  }
  /**
   * Proxy method to publisherChannel.publish
   *   publish a message to an exchange
   * @param  {String} exchange   exchange name to publish to
   * @param  {String} routingKey message routing key
   * @param  {Buffer|Object|Array|String} content    message content
   * @param  {Object} [options]    publish options
   */
  publish (exchange, routingKey, content, options) {
    const publisherChannel = this.publisherChannel
    let args = assertArgs(arguments, {
      'exchange': 'string',
      'routingKey': 'string',
      'content': ['object', 'array', 'string', Buffer],
      '[options]': 'object'
    })
    // array args
    args = values(args).filter(exists)
    // cast content to buffer
    args[2] = castBuffer(args[2])

    return publisherChannel.publish.apply(publisherChannel, args)
  }
  /**
   * Proxy method to publisherChannel.sendToQueue
   *   publish a message directly to a queue
   * @param  {String} queue   queue name to publish to
   * @param  {Buffer|Object|Array|String} content message content
   * @param  {Object} [options] publish options
   */
  sendToQueue (queue, content, options) {
    const publisherChannel = this.publisherChannel
    let args = assertArgs(arguments, {
      'queue': 'string',
      'content': ['object', 'array', 'string', Buffer],
      '[options]': 'object'
    })
    // array args
    args = values(args).filter(exists)
    // cast content to buffer
    args[1] = castBuffer(args[1])

    return publisherChannel.sendToQueue.apply(publisherChannel, args)
  }
  /**
   * Reply to an rpc request, publish a message to replyTo queue
   * @param  {Buffer|Object|Array|String} content message content
   * @param  {Object} options publish options
   */
  reply (content, options) {
    const replyTo = this.message.properties.replyTo
    const correlationId = this.message.properties.correlationId

    assert(replyTo, "reply() cannot reply to a message without 'replyTo'")
    assert(correlationId, "reply() cannot reply to a message without 'correlationId'")

    const args = assertArgs(arguments, {
      'content': ['object', 'array', 'string', Buffer],
      '[options]': 'object'
    })
    defaults(args, {
      options: {}
    })
    // cast content to a buffer
    content = castBuffer(args.content)
    options = args.options
    // set correlation id for the reply message
    options.correlationId = correlationId

    return this.publisherChannel.sendToQueue(replyTo, content, options)
  }
  /**
   * Make an rpc request, publish a message to an rpc queue
   * @param  {String}   queue     name of rpc-queue to send the message to
   * @param  {Buffer}   content   message content
   * @param  {Object}   [sendOpts]  sendToQueue options
   * @param  {Object}   [queueOpts] assertQueue options for replyTo queue, queueOpts.exclusive defaults to true
   * @param  {Object}   [consumeOpts] consume options for replyTo queue, consumeOpts defaults to true
   * @return {Promise}  returns a promise
   */
  request (queue, content, sendOpts, queueOpts, consumeOpts) {
    const self = this
    const args = assertArgs(arguments, {
      'queue': 'string',
      'content': ['object', 'string', Buffer],
      '[sendOpts]': 'object',
      '[queueOpts]': 'object',
      '[consumeOpts]': 'object',
      '[cb]': 'function'
    })
    defaults(args, {
      sendOpts: {},
      queueOpts: {},
      consumeOpts: {}
    })
    defaults(args.queueOpts, { exclusive: true }) // default exclusive queue. scopes queue to the connection
    defaults(args.consumeOpts, { noAck: true }) // default no ack required for replyTo
    queue = args.queue
    content = castBuffer(args.content)
    sendOpts = args.sendOpts
    queueOpts = args.queueOpts
    consumeOpts = args.consumeOpts

    const promise = co(function * () {
      const channel = yield self.connection.createChannel()
      // set channel type
      self.app.emit('channel:create', channel, 'rpc')

      return yield co(function * () {
        // create a queue w/ a random name
        const q = yield channel.assertQueue('', queueOpts)
        const corrId = uuid.v4()
        const messagePromise = new Promise(function (resolve, reject) {
          const thunk = first([[channel, 'error', 'exit']], exitHandler)
          channel
            .consume(q.queue, messageHandler, consumeOpts)
            .catch(reject) // if consume attach fails
          function messageHandler (message) {
            if (message.properties.correlationId === corrId) {
              thunk.cancel() // remove 'error' and 'exit' event handler
              resolve(message)
            }
          }
          function exitHandler (err) {
            channel.___closed = true
            if (err) { return reject(err) }
            reject(new Error('rpc channel exited before recieving reply message'))
          }
        })
        // assign correlationId and replyTo
        assign(sendOpts, { correlationId: corrId, replyTo: q.queue })
        channel.sendToQueue(queue, content, sendOpts)
        // > `finally`
        const message = yield messagePromise
        // close channel, don't yield
        closeChannel(channel)

        return message
      }).catch(function (err) {
        // close channel, don't yield
        closeChannel(channel)
        throw err
      })
    })
    function closeChannel (channel) {
      if (channel.___closed) return
      channel.close()
        .then(function () {
          self.app.emit('channel:close', channel, 'rpc')
        })
        .catch(function (err) {
          self.app.emit('channel:close:error', err, channel, 'rpc')
        })
    }

    return promise
  }
}
