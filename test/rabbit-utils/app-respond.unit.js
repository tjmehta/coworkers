'use strict'
const Lab = require('lab')
const sinon = require('sinon')

const Application = require('../../lib/application.js')
const Context = require('../../lib/context.js')
const respond = require('../../lib/rabbit-utils/app-respond.js')

const lab = exports.lab = Lab.script()
const describe = lab.describe
const it = lab.it
const beforeEach = lab.beforeEach

describe('respond', function () {
  let ctx

  beforeEach(function (done) {
    ctx = {}
    // create app
    ctx.app = new Application()
    ctx.finalhandler = ctx.app.finalhandler = sinon.stub()
    ctx.queueName = 'queue-name'
    ctx.message = 'message'
    ctx.context = new Context(ctx.app, ctx.queueName, ctx.message)
    done()
  })

  it('should call final handler if there is no action', function (done) {
    respond.call(ctx.context)
    sinon.assert.calledOnce(ctx.finalhandler)
    sinon.assert.calledOn(ctx.finalhandler, ctx.context)
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
