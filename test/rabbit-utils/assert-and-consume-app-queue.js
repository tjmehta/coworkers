'use strict'
const Lab = require('lab')
const sinon = require('sinon')
require('sinon-as-promised')
const Code = require('code')

const Application = require('../../lib/application.js')
const assertAndConsumeAppQueue = require('../../lib/rabbit-utils/assert-and-consume-app-queue.js')

const lab = exports.lab = Lab.script()
const describe = lab.describe
const it = lab.it
const beforeEach = lab.beforeEach
const expect = Code.expect

describe('RabbitUtils - assertAndConsumeAppQueue', function () {
  let ctx

  beforeEach(function (done) {
    ctx = {}
    ctx.queueName = 'queue-name'
    ctx.queueOpts = {}
    ctx.consumeOpts = {}
    ctx.app = new Application()
    ctx.app.queue(ctx.queueName, ctx.queueOpts, ctx.consumeOpts, function * () {})
    ctx.handler = function () {}
    sinon.stub(ctx.app, 'messageHandler').returns(ctx.handler)
    ctx.app.consumerChannel = {
      assertQueue: sinon.stub().resolves(),
      consume: sinon.stub().resolves()
    }
    done()
  })

  describe('provided a prefetch count in the consumeOpts', function () {
    beforeEach(function (done) {
      ctx = {}
      ctx.queueName = 'queue-name'
      ctx.queueOpts = {}
      ctx.consumeOpts = {
        prefetch: 1
      }
      ctx.app = new Application()
      ctx.app.queue(ctx.queueName, ctx.queueOpts, ctx.consumeOpts, function * () {})
      ctx.handler = function () {}
      sinon.stub(ctx.app, 'messageHandler').returns(ctx.handler)
      ctx.app.consumerChannel = {
        assertQueue: sinon.stub().resolves(),
        consume: sinon.stub().resolves()
      }
      done()
    })

    it('should set a prefetch count on the consumerChannel', function (done) {
      assertAndConsumeAppQueue(ctx.app, ctx.queueName).then(function () {
        expect(ctx.app.consumerChannel.prefetch).to.equal(1)
        done()
      }).catch(done)
    })
  })

  describe('not provided a prefetch count in the consumeOpts', function () {
    it('should not set a prefetch count on the consumerChannel', function (done) {
      assertAndConsumeAppQueue(ctx.app, ctx.queueName).then(function () {
        expect(ctx.app.consumerChannel.prefetch).to.not.equal(1)
        done()
      }).catch(done)
    })
  })

  it('should assert and assume the queue', function (done) {
    assertAndConsumeAppQueue(ctx.app, ctx.queueName).then(function () {
      sinon.assert.calledOnce(ctx.app.consumerChannel.assertQueue)
      sinon.assert.calledWith(ctx.app.consumerChannel.assertQueue, ctx.queueName, ctx.queueOpts)
      sinon.assert.calledOnce(ctx.app.consumerChannel.consume)
      sinon.assert.calledWith(ctx.app.consumerChannel.consume, ctx.queueName, ctx.handler, ctx.consumeOpts)
      done()
    }).catch(done)
  })
})
