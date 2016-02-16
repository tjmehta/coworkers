'use strict'

const assert = require('assert')

const co = require('co')

const debug = require('../utils/debug')()
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

    channel.__coworkersCloseHandler = module.exports.closeHandler.bind(null, app, key)
    channel.__coworkersErrorHandler = module.exports.errorHandler.bind(null, app, key)
    channel.once('close', channel.__coworkersCloseHandler)
    channel.once('error', channel.__coworkersErrorHandler)
    app.emit('channel:create', channel)

    // attach special event to determine if a message has been confirmed
    // this event is handled in context.js
    if (key === 'consumerChannel') {
      wrap(channel, ['ack', 'nack'], function (fn, args) {
        const message = args[0]
        assert(!message.messageAcked, 'Messages cannot be acked/nacked more than once (will close channel)')

        const ret = fn.apply(this, args)
        message.messageAcked = true
        return ret
      })
    }

    return channel
  })
}

/**
 * channel close handler
 */
function closeHandler (app, key) {
  // delete app key
  delete app[key]
  // log and throw err
  debug(`app.${key} unexpectedly closed`)
  throw new Error(`"app.${key}" unexpectedly closed`)
}

/**
 * channel error handler
 */
function errorHandler (app, key, err) {
  // delete app key
  delete app[key]
  // log and adjust err message
  const msg = `"app.${key}" unexpectedly errored: ${err.message}`
  debug(msg, err)
  err.message = msg
  // throw the error
  throw err
}
