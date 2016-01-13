'use strict'

const co = require('co')

module.exports = consumeAppQueues

/**
 * Start consuming message from app's queues
 * @param  {Application} app coworkers instance
 * @return {Promise}
 */
function consumeAppQueues (app) {
  return co(function * () {
    var queuesToConsume = Object.keys(app.queueMiddlewares)

    return yield queuesToConsume.map(function (queueName) {
      const options = app.queueMiddlewares[queueName].options
      const handler = app.messageHandler(queueName)

      return app.consumerChannel.consume(queueName, handler, options)
    })
  })
}
