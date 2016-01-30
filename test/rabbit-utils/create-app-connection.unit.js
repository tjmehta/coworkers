'use strict'
const EventEmitter = require('events').EventEmitter

const Lab = require('lab')
const Code = require('code')
const proxyquire = require('proxyquire')
const sinon = require('sinon')
require('sinon-as-promised')

const Application = require('../../lib/application.js')

const lab = exports.lab = Lab.script()
const describe = lab.describe
const it = lab.it
const beforeEach = lab.beforeEach
const afterEach = lab.afterEach
const expect = Code.expect

describe('RabbitUtils - createAppConnection', function () {
  let ctx

  beforeEach(function (done) {
    ctx = {}
    // connect args
    ctx.url = 'localhost:5672'
    ctx.socketOptions = {}
    // mock connection
    ctx.mockConnection = new EventEmitter()
    sinon.spy(ctx.mockConnection, 'once')
    // mock amqplib
    ctx.mockAmqplib = {
      connect: sinon.stub().resolves(ctx.mockConnection)
    }
    // create app connection w/ amqplib stubbed
    ctx.createAppConnection = proxyquire('../../lib/rabbit-utils/create-app-connection.js', {
      amqplib: ctx.mockAmqplib
    })
    // create app
    ctx.app = new Application()
    done()
  })

  it('should create a connection for app', function (done) {
    sinon.spy(ctx.app, 'emit')
    ctx.createAppConnection(ctx.app, ctx.url, ctx.socketOptions)
      .then(function () {
        // assert connect called
        sinon.assert.calledOnce(ctx.mockAmqplib.connect)
        sinon.assert.calledWith(ctx.mockAmqplib.connect, ctx.url, ctx.socketOptions)
        // assert connection created
        expect(ctx.app.connection).to.exist()
        expect(ctx.app.connection).to.equal(ctx.mockConnection)
        // assert connection error close channel handlers
        sinon.assert.calledTwice(ctx.mockConnection.once)
        sinon.assert.calledWith(
          ctx.mockConnection.once, 'close', sinon.match.func)
        sinon.assert.calledWith(
          ctx.mockConnection.once, 'error', sinon.match.func)
        // assert app emits connection:create
        sinon.assert.calledWith(
          ctx.app.emit, 'connection:create', ctx.mockConnection)
        done()
      }).catch(done)
  })

  describe('closeHandler', function () {
    beforeEach(function (done) {
      sinon.spy(ctx.createAppConnection, 'closeHandler')
      ctx.closeHandler = ctx.createAppConnection.closeHandler
      done()
    })
    afterEach(function (done) {
      ctx.createAppConnection.closeHandler.restore()
      done()
    })

    it('should delete connection and emit connection:close', function (done) {
      ctx.createAppConnection(ctx.app, ctx.url, ctx.socketOptions)
        .then(function () {
          sinon.spy(ctx.app, 'emit')
          expect(ctx.app.connection).to.exist(ctx.mockConnection)
          expect(function () {
            ctx.mockConnection.emit('close')
          }).to.throw('"app.connection" unexpectedly closed')
          // assert closeHandler called
          sinon.assert.calledOnce(ctx.closeHandler)
          sinon.assert.calledWith(ctx.closeHandler, ctx.app)
          // assert connection deleted
          expect(ctx.app.connection).to.not.exist()
          done()
        }).catch(done)
    })
  })

  describe('errorHandler', function () {
    beforeEach(function (done) {
      sinon.spy(ctx.createAppConnection, 'errorHandler')
      ctx.errorHandler = ctx.createAppConnection.errorHandler
      done()
    })
    afterEach(function (done) {
      ctx.createAppConnection.errorHandler.restore()
      done()
    })

    it('should delete connection and emit connection:close', function (done) {
      ctx.createAppConnection(ctx.app, ctx.url, ctx.socketOptions)
        .then(function () {
          sinon.spy(ctx.app, 'emit')
          expect(ctx.app.connection).to.exist(ctx.mockConnection)
          ctx.err = new Error('boom')
          expect(function () {
            ctx.mockConnection.emit('error', ctx.err)
          }).to.throw('"app.connection" unexpectedly errored: ' + ctx.err.message)
          // assert errorHandler called
          sinon.assert.calledOnce(ctx.errorHandler)
          sinon.assert.calledWith(ctx.errorHandler, ctx.app, ctx.err)
          // assert connection deleted
          expect(ctx.app.connection).to.not.exist()
          done()
        }).catch(done)
    })
  })
})
