'use strict'

const co = require('co')

module.exports = assertAndConsumeAppQueue

/**
 * Start consuming message from app's queues
 * @param  {Application} app coworkers instance
 * @param  {String} queueName app queue's name
 * @return {Promise} consume promise (yields consumer tag)
 */
function assertAndConsumeAppQueue (app, queueName) {
  return co(function * () {
    const queue = app.queueMiddlewares[queueName]
    const queueOpts = queue.queueOpts
    const consumeOpts = queue.consumeOpts
    const handler = app.messageHandler(queueName)

    yield app.consumerChannel.assertQueue(queueName, queueOpts)

    return yield app.consumerChannel.consume(queueName, handler, consumeOpts)
  })
}
