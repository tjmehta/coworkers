'use strict'

const assertArgs = require('assert-args')
const clone = require('101/clone')
const defaults = require('101/defaults')
const delegates = require('delegates')
const exists = require('101/exists')
const equals = require('101/equals')
const isObject = require('101/is-object')
const not = require('101/not')
const passAny = require('101/pass-any')
const pick = require('101/pick')
const rpcRequest = require('amqplib-rpc').request
const rpcReply = require('amqplib-rpc').reply
const checkQueue = require('amqplib-rpc').checkQueue
const checkReplyQueue = require('amqplib-rpc').checkReplyQueue
const values = require('object-values')

const castBuffer = require('cast-buffer')
const defineProperties = require('./utils/define-properties.js')
const remove = function (arr, removeItems) {
  const equalsAny = passAny.apply(null, removeItems.map(function (item) { return equals(item) }))
  return arr.filter(not(equalsAny))
}

const Context = module.exports = class Context {
  constructor (app, queueName, message) {
    const queue = app.queueMiddlewares[queueName]
    // instances, note: update toJSON if you add any other non-literal properties
    this.app = app
    this.connection = app.connection
    this.consumerChannel = app.consumerChannel
    this.publisherChannel = app.publisherChannel
    // properties
    this.queueName = queueName
    this.message = message
    this.message.messageAcked = false // custom coworkers property set in create-app-channel.js ack/nack wrapper
    // options
    this.queueOpts = clone(queue.queueOpts)
    this.consumeOpts = clone(queue.consumeOpts)
    // user state
    this.state = {}
    // acknowledgement properties
    var channelAction = {}
    Object.defineProperty(this, 'ack', channelActionProperty('ack', ['allUpTo'])) // defaults: allUpTo=false
    Object.defineProperty(this, 'nack', channelActionProperty('nack', ['allUpTo', 'requeue'])) // defaults: allUpTo=false, requeue=true
    Object.defineProperty(this, 'ackAll', channelActionProperty('ackAll', []))
    Object.defineProperty(this, 'nackAll', channelActionProperty('nackAll', ['requeue'])) // defaults: requeue=true
    Object.defineProperty(this, 'reject', channelActionProperty('reject', ['requeue'])) // defaults: requeue=false
    function channelActionProperty (method, argNames) {
      return {
        enumerable: true,
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
    return rpcReply(this.publisherChannel, this.message, content, options)
  }
  /**
   * Make an rpc request, publish a message to an rpc queue
   * @param  {String}   queueName     name of rpc-queue to send the message to
   * @param  {Buffer}   content   message content
   * @param  {Object}   [sendOpts]  sendToQueue options
   * @param  {Object}   [queueOpts] assertQueue options for replyTo queue, queueOpts.exclusive defaults to true
   * @param  {Object}   [consumeOpts] consume options for replyTo queue, consumeOpts defaults to true
   * @param  {Function} [cb] callback, optional if using callback api
   * @return {Promise}  returns a promise, if using promise api
   */
  request (queueName, content, sendOpts, queueOpts, consumeOpts, cb) {
    const args = assertArgs(arguments, {
      'queueName': 'string',
      'content': ['object', 'array', 'number', 'string', Buffer],
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
    queueName = args.queueName
    content = castBuffer(args.content)
    sendOpts = args.sendOpts
    queueOpts = args.queueOpts
    consumeOpts = args.consumeOpts
    const opts = {
      sendOpts: sendOpts,
      queueOpts: queueOpts,
      consumeOpts: consumeOpts
    }

    return rpcRequest(this.connection, queueName, content, opts, cb)
  }
  /**
   * create a channel, check if the queue exists, and close the channel
   * @param  {String}   queue    queue name
   * @param  {Function} [cb]     callback, not required if using promises
   * @return {Promise}  if using promises
   */
  checkQueue (queue, cb) {
    return checkQueue(this.connection, queue, cb)
  }
  /**
   * create a channel, check if replyTo queue exists, and close the channel
   * @param  {Function} [cb]    not required if using promises
   * @return {Promise}  if using promises
   */
  checkReplyQueue (cb) {
    return checkReplyQueue(this.connection, this.message, cb)
  }
  /**
   * return json equivalent of context; picks all enumerable properties from context
   * @return {Object} context's enumerable properties
   */
  toJSON () {
    const ctxKeys = remove(Object.keys(this), [
      'app',
      'connection',
      'consumerChannel',
      'publisherChannel'
    ]).concat([
      'fields',
      'properties',
      'content',
      'messageAcked',
      'headers',
      'consumerTag',
      'deliveryTag',
      'redelivered',
      'exchange',
      'routingKey'
    ])
    const json = pick(this, ctxKeys)
    return json
  }
}

const proto = Context.prototype
// message accessors
delegates(proto, 'message')
  .getter('fields')
  .getter('properties')
  .access('content')
  .access('messageAcked') // custom
// message.properties getters
delegates(proto, 'properties')
  .getter('headers')
// message.field getters and accessors
delegates(proto, 'fields')
  .getter('consumerTag')
  .getter('deliveryTag')
  .access('redelivered')
  .access('exchange')
  .access('routingKey')
