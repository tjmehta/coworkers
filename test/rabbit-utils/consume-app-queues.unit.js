'use strict'
const Lab = require('lab')
const sinon = require('sinon')

const Application = require('../../lib/application.js')
const consumeAppConnection = require('../../lib/rabbit-utils/consume-app-queues.js')

const lab = exports.lab = Lab.script()
const describe = lab.describe
const it = lab.it
const beforeEach = lab.beforeEach

describe('consumeAppConnection', function () {
  let ctx

  beforeEach(function (done) {
    ctx = {}
    ctx.queueName = 'queue-name'
    ctx.app = new Application()
    // mock consumer channel
    ctx.consumerChannel =
      ctx.app.consumerChannel = {
        consume: sinon.stub()
      }
    // mock handler
    ctx.handler = function () {}
    ctx.consumerOpts = {}
    sinon.stub(ctx.app, 'messageHandler').returns(ctx.handler)
    ctx.app.consume(ctx.queueName, ctx.consumerOpts, function * () {})
    done()
  })

  it('should consume all app\'s queues', function (done) {
    consumeAppConnection(ctx.app)
      .then(function () {
        // assert messageHandler created
        sinon.assert.calledOnce(ctx.app.messageHandler)
        // assert channel consume queues
        sinon.assert.calledOnce(ctx.consumerChannel.consume)
        sinon.assert.calledWith(
          ctx.consumerChannel.consume,
          ctx.queueName, ctx.handler, ctx.consumerOpts)
        done()
      })
      .catch(done)
  })
})
