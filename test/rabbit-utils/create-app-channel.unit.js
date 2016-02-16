'use strict'
const EventEmitter = require('events').EventEmitter

const Lab = require('lab')
const Code = require('code')
const sinon = require('sinon')
require('sinon-as-promised')

const Application = require('../../lib/application.js')
const createAppChannel = require('../../lib/rabbit-utils/create-app-channel.js')

const lab = exports.lab = Lab.script()
const describe = lab.describe
const it = lab.it
const beforeEach = lab.beforeEach
const afterEach = lab.afterEach
const expect = Code.expect

describe('RabbitUtils - createAppChannel', function () {
  let ctx

  beforeEach(function (done) {
    ctx = {}
    // create app
    ctx.app = new Application()
    sinon.spy(ctx.app, 'emit')
    // mock channels
    ctx.consumerChannel = new EventEmitter()
    sinon.spy(ctx.consumerChannel, 'once')
    ctx.publisherChannel = new EventEmitter()
    sinon.spy(ctx.publisherChannel, 'once')
    ctx.consumerChannel.ack = function () {}
    ctx.consumerChannel.nack = function () {}
    // mock connection
    ctx.app.connection = {
      createChannel: sinon.stub()
    }
    done()
  })

  it('should create a consumerChannel for app', function (done) {
    ctx.app.connection.createChannel.resolves(ctx.consumerChannel)
    createAppChannel(ctx.app, 'consumerChannel')
      .then(function () {
        // assert createChannel called
        sinon.assert.calledOnce(ctx.app.connection.createChannel)
        // assert channel created
        expect(ctx.app.consumerChannel).to.exist()
        expect(ctx.app.consumerChannel).to.equal(ctx.consumerChannel)
        // assert attached error, close channel handlers
        const consumerOnce = ctx.app.consumerChannel.once
        sinon.assert.calledTwice(consumerOnce)
        sinon.assert.calledWith(consumerOnce, 'close', sinon.match.func)
        sinon.assert.calledWith(consumerOnce, 'error', sinon.match.func)
        // assert app emit channel:create
        sinon.assert.calledOnce(ctx.app.emit)
        sinon.assert.calledWith(ctx.app.emit, 'channel:create', ctx.consumerChannel)
        // assert ack and nack wrapped w/ multi call error
        const message = {}
        ctx.consumerChannel.ack(message)
        expect(message.messageAcked).to.be.true()
        expect(function () {
          ctx.consumerChannel.ack(message)
        }).to.throw(/cannot be acked/)
        expect(function () {
          ctx.consumerChannel.nack(message)
        }).to.throw(/cannot be acked/)
        done()
      }).catch(done)
  })

  it('should create a publisherChannel for app', function (done) {
    ctx.app.connection.createChannel.resolves(ctx.publisherChannel)
    createAppChannel(ctx.app, 'publisherChannel')
      .then(function () {
        // assert createChannel called
        sinon.assert.calledOnce(ctx.app.connection.createChannel)
        // assert channel created
        expect(ctx.app.publisherChannel).to.exist()
        expect(ctx.app.publisherChannel).to.equal(ctx.publisherChannel)
        // assert attached error, close channel handlers
        const publisherOnce = ctx.app.publisherChannel.once
        sinon.assert.calledTwice(publisherOnce)
        sinon.assert.calledWith(publisherOnce, 'close', sinon.match.func)
        sinon.assert.calledWith(publisherOnce, 'error', sinon.match.func)
        // assert app emits channel:create
        sinon.assert.calledOnce(ctx.app.emit)
        sinon.assert.calledWith(ctx.app.emit, 'channel:create', ctx.publisherChannel)
        done()
      }).catch(done)
  })

  describe('closeHandler', function () {
    beforeEach(function (done) {
      ctx.app.connection.createChannel.resolves(ctx.consumerChannel)
      sinon.spy(createAppChannel, 'closeHandler')
      done()
    })
    afterEach(function (done) {
      createAppChannel.closeHandler.restore()
      done()
    })

    it('should delete key and emit channel:close', function (done) {
      createAppChannel(ctx.app, 'consumerChannel')
        .then(function () {
          expect(ctx.app.consumerChannel).to.equal(ctx.consumerChannel)
          expect(function () {
            ctx.consumerChannel.emit('close')
          }).to.throw('"app.consumerChannel" unexpectedly closed')
          sinon.assert.calledOnce(createAppChannel.closeHandler)
          sinon.assert.calledWith(
            createAppChannel.closeHandler,
            ctx.app, 'consumerChannel')
          expect(ctx.app.consumerChannel).to.not.exist()
          done()
        }).catch(done)
    })
  })

  describe('errorHandler', function () {
    beforeEach(function (done) {
      ctx.app.connection.createChannel.resolves(ctx.consumerChannel)
      sinon.spy(createAppChannel, 'errorHandler')
      done()
    })
    afterEach(function (done) {
      createAppChannel.errorHandler.restore()
      done()
    })

    it('should delete key and emit channel:error', function (done) {
      createAppChannel(ctx.app, 'consumerChannel')
        .then(function () {
          expect(ctx.app.consumerChannel).to.equal(ctx.consumerChannel)
          ctx.err = new Error('boom')
          expect(function () {
            ctx.consumerChannel.emit('error', ctx.err)
          }).to.throw('"app.consumerChannel" unexpectedly errored: ' + ctx.err.message)
          sinon.assert.calledOnce(createAppChannel.errorHandler)
          sinon.assert.calledWith(
            createAppChannel.errorHandler,
            ctx.app, 'consumerChannel', ctx.err)
          expect(ctx.app.consumerChannel).to.not.exist()
          done()
        }).catch(done)
    })
  })
})
