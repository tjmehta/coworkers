'use strict'

const assert = require('assert')

const amqplib = require('amqplib')
const co = require('co')

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

    conn.once('close', module.exports.closeHandler.bind(null, app))
    conn.once('error', module.exports.errorHandler.bind(null, app))
    app.emit('connection:create', conn)

    return conn
  })
}

/**
 * connection close handler
 */
function closeHandler (app, conn) {
  delete app.connection

  app.emit('connection:close', conn)
}
/**
 * connection error handler
 */
function errorHandler (app, err, conn) {
  delete app.connection

  app.emit('connection:error', err, conn)
}
