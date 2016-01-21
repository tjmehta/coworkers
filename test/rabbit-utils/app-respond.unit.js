'use strict'

const Code = require('code')
const Lab = require('lab')
const sinon = require('sinon')

const Application = require('../../lib/application.js')
const Context = require('../../lib/context.js')
const NoAckError = require('../../lib/no-ack-error.js')
const respond = require('../../lib/rabbit-utils/app-respond.js')

const lab = exports.lab = Lab.script()
const describe = lab.describe
const expect = Code.expect
const it = lab.it
const beforeEach = lab.beforeEach

describe('RabbitUtils - appRespond', function () {
  let ctx

  beforeEach(function (done) {
    ctx = {}
    // create app
    ctx.app = new Application()
    ctx.queueName = 'queue-name'
    ctx.message = {
      fields: {
        deliveryTag: 1
      }
    }
    ctx.app.queue(ctx.queueName, function * () {})
    ctx.context = new Context(ctx.app, ctx.queueName, ctx.message)
    ctx.context.consumerChannel = {}
    sinon.stub(ctx.app, 'emit')
    done()
  })

  it('should emit app error if there is no ack', function (done) {
    const matchNoAckErr = sinon.match(function (err) {
      expect(err).to.be.an.instanceOf(NoAckError)
      return true
    })
    respond.call(ctx.context)
    sinon.assert.calledWith(ctx.app.emit, 'error', matchNoAckErr, ctx.context)
    done()
  })

  it('should not error if there is no ack on a queue w/ consumeOpts.noAck', function (done) {
    ctx.context.consumeOpts = { noAck: true }
    respond.call(ctx.context)
    sinon.assert.notCalled(ctx.app.emit)
    done()
  })

  describe('ack', function () {
    beforeEach(function (done) {
      ctx.ack = sinon.stub()
      ctx.context.consumerChannel = { ack: ctx.ack }
      ctx.allUpTo = false
      ctx.context.ack = { allUpTo: ctx.allUpTo }
      done()
    })

    it('should call consumerChannel.ack', function (done) {
      respond.call(ctx.context)
      sinon.assert.calledOnce(ctx.ack)
      sinon.assert.calledWith(ctx.ack, ctx.message, ctx.allUpTo)
      done()
    })
  })

  describe('nackAll', function () {
    beforeEach(function (done) {
      ctx.nackAll = sinon.stub()
      ctx.context.consumerChannel = { nackAll: ctx.nackAll }
      ctx.requeue = false
      ctx.context.nackAll = { requeue: false }
      done()
    })

    it('should call consumerChannel.nackAll', function (done) {
      respond.call(ctx.context)
      sinon.assert.calledOnce(ctx.nackAll, ctx.requeue)
      done()
    })
  })
})
