'use strict'

const assert = require('assert')

const amqplib = require('amqplib')
const co = require('co')

const debug = require('../utils/debug')()

module.exports = createAppConnection
// exports handlers for testing
module.exports.closeHandler = closeHandler
module.exports.errorHandler = errorHandler

/**
 * Create a RabbitMQ connection
 * @param  {Application} app        coworkers application
 * @param  {String} url             connection url
 * @param  {Object} [socketOptions] connection socket options
 * @return {Promise}                connection promise
 */
function createAppConnection (app, url, socketOptions) {
  assert(!app.connection, 'Cannot create connection if it already exists')

  return co(function * () {
    const conn =
      app.connection =
        yield amqplib.connect(url, socketOptions)

    conn.__coworkersCloseHandler = module.exports.closeHandler.bind(null, app)
    conn.__coworkersErrorHandler = module.exports.errorHandler.bind(null, app)
    conn.once('close', conn.__coworkersCloseHandler)
    conn.once('error', conn.__coworkersErrorHandler)
    app.emit('connection:create', conn)

    return conn
  })
}

/**
 * connection close handler
 */
function closeHandler (app) {
  delete app.connection
  // log and throw err
  debug('"app.connection" unexpectedly closed')
  throw new Error('"app.connection" unexpectedly closed')
}
/**
 * connection error handler
 */
function errorHandler (app, err) {
  delete app.connection
  // log and adjust err message
  const msg = `"app.connection" unexpectedly errored: ${err.message}`
  debug(msg, err)
  err.message = msg
  // throw the error
  throw err
}
