'use strict'

const assert = require('assert')

const co = require('co')

const wrap = require('../utils/wrap-func.js')

module.exports = createAppChannel
// exports handlers for testing
module.exports.closeHandler = closeHandler
module.exports.errorHandler = errorHandler

/**
 * Create consumer or publisher RabbitMQ channel
 * @param {String} key channel key {consumer, publisher}
 * @return {Promise} channel promise
 */
function createAppChannel (app, key) {
  assert(~['consumerChannel', 'publisherChannel'].indexOf(key),
    'Channel key must be "consumerChannel" or "publisherChannel"')
  assert(app.connection, 'Cannot create a channel without a connection')
  assert(!app[key], 'Channel "' + key + '" already exists')

  return co(function * () {
    const channel =
      app[key] =
        yield app.connection.createChannel()

    channel.once('close', module.exports.closeHandler.bind(null, app, key))
    channel.once('error', module.exports.errorHandler.bind(null, app, key))
    app.emit('channel:create', channel)

    // attach special event to determine if a message has been confirmed
    // this event is handled in context.js
    if (key === 'consumerChannel') {
      wrap(channel, ['ack', 'nack'], function (fn, args) {
        const message = args[0]
        const context = message.context
        assert(!context.messageAcked, 'Messages cannot be acked/nacked more than once (will close channel)')

        const ret = fn.apply(this, args)
        context.messageAcked = true
        return ret
      })
    }

    return channel
  })
}

/**
 * channel close handler
 */
function closeHandler (app, key, channel) {
  // set channel type to 'consumer' or 'publisher'
  const type = key.replace(/Channel$/, '')
  // delete app key
  delete app[key]
  // emit app event
  app.emit('channel:close', channel, type)
}

/**
 * channel error handler
 */
function errorHandler (app, key, err, channel) {
  // set channel type to 'consumer' or 'publisher'
  const type = key.replace(/Channel$/, '')
  // delete app key
  delete app[key]
  // emit app event
  app.emit('channel:error', err, channel, type)
}
