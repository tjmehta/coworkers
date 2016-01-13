'use strict'
const EventEmitter = require('events').EventEmitter

const Lab = require('lab')
const Code = require('code')
const sinon = require('sinon')

const Application = require('../../lib/application.js')
const createAppChannel = require('../../lib/rabbit-utils/create-app-channel.js')

const lab = exports.lab = Lab.script()
const describe = lab.describe
const it = lab.it
const beforeEach = lab.beforeEach
const afterEach = lab.afterEach
const expect = Code.expect

describe('createAppChannel', function () {
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
          ctx.consumerChannel.emit('close', ctx.consumerChannel)
          sinon.assert.calledOnce(createAppChannel.closeHandler)
          sinon.assert.calledWith(
            createAppChannel.closeHandler,
            ctx.app, 'consumerChannel', ctx.consumerChannel)
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
          ctx.consumerChannel.emit('error', ctx.err, ctx.consumerChannel)
          sinon.assert.calledOnce(createAppChannel.errorHandler)
          sinon.assert.calledWith(
            createAppChannel.errorHandler,
            ctx.app, 'consumerChannel', ctx.err, ctx.consumerChannel)
          expect(ctx.app.consumerChannel).to.not.exist()
          done()
        }).catch(done)
    })
  })
})
