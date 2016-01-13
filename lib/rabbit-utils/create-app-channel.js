'use strict'

const assert = require('assert')

const co = require('co')

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
