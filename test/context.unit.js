'use strict'
const Code = require('code')
const Lab = require('lab')
const put = require('101/put')
const sinon = require('sinon')
require('sinon-as-promised')

const lab = exports.lab = Lab.script()
const describe = lab.describe
const it = lab.it
const beforeEach = lab.beforeEach
const expect = Code.expect

const Application = require('../lib/application.js')
const Context = require('../lib/context.js')

describe('Context', function () {
  let ctx

  // tests
  beforeEach(function (done) {
    ctx = {}
    done()
  })

  describe('constructor', function () {
    beforeEach(function (done) {
      ctx.queueName = 'queue-name'
      ctx.message = {
        fields: {
          deliveryTag: 1
        }
      }
      ctx.app = new Application()
      ctx.app.connection = {}
      ctx.app.consumerChannel = {}
      ctx.app.publisherChannel = {}
      ctx.app.context = { appFoo: 1, app: 'no' }
      ctx.queueOpts = { exclusive: true }
      ctx.consumeOpts = { noAck: true }
      ctx.app.queue(ctx.queueName, ctx.queueOpts, ctx.consumeOpts, function * () {})
      done()
    })

    it('should create a context', function (done) {
      const app = ctx.app
      const context = new Context(ctx.app, ctx.queueName, ctx.message)
      // expect context to be added on the message
      expect(ctx.message.context).to.equal(context)
      // expect context to copy app properties
      expect(context.appFoo).to.equal(ctx.app.context.appFoo)
      expect(context.app).to.equal(app)
      expect(context.connection).to.equal(app.connection)
      expect(context.consumerChannel).to.equal(app.consumerChannel)
      expect(context.publisherChannel).to.equal(app.publisherChannel)
      // expect context properties
      expect(context.queueName).to.equal(ctx.queueName)
      expect(context.message).to.equal(ctx.message)
      expect(context.deliveryTag).to.equal(ctx.message.fields.deliveryTag)
      expect(context.queueOpts).to.contain(ctx.queueOpts)
      expect(context.consumeOpts).to.contain(ctx.consumeOpts)
      expect(context.state).to.deep.equal({})
      // ack, nack, ackAll, nackAll tested below
      done()
    })
  })

  describe('instance methods', function () {
    beforeEach(function (done) {
      ctx.queueName = 'queue-name'
      ctx.message = {
        fields: {
          deliveryTag: 1
        }
      }
      ctx.app = new Application()
      ctx.app.connection = {}
      ctx.app.consumerChannel = {}
      ctx.app.publisherChannel = {}
      ctx.app.context = { appFoo: 1, app: 'no' }
      ctx.queueOpts = { exclusive: true }
      ctx.consumeOpts = { noAck: true }
      ctx.app.queue(ctx.queueName, ctx.queueOpts, ctx.consumeOpts, function * () {})
      // create context
      ctx.context = new Context(ctx.app, ctx.queueName, ctx.message)
      done()
    })

    describe('ack, nack, ackAll, nackAll', function () {
      describe('set and get', function (done) {
        it('should set hidden method and args', function (done) {
          let val
          val = {
            allUpTo: true
          }
          ctx.context.ack = val
          expect(ctx.context.ack).to.deep.equal(val)
          expect(ctx.context.nack).to.not.exist()
          expect(ctx.context.ackAll).to.not.exist()
          expect(ctx.context.nackAll).to.not.exist()
          val = {
            allUpTo: true,
            requeue: true
          }
          ctx.context.nack = val
          expect(ctx.context.nack).to.deep.equal(val)
          expect(ctx.context.ack).to.not.exist()
          expect(ctx.context.ackAll).to.not.exist()
          expect(ctx.context.nackAll).to.not.exist()
          val = true
          ctx.context.ackAll = val
          expect(ctx.context.ackAll).to.deep.equal({})
          expect(ctx.context.ack).to.not.exist()
          expect(ctx.context.nack).to.not.exist()
          expect(ctx.context.nackAll).to.not.exist()
          val = {
            requeue: true
          }
          ctx.context.nackAll = val
          expect(ctx.context.nackAll).to.deep.equal(val)
          expect(ctx.context.ack).to.not.exist()
          expect(ctx.context.ackAll).to.not.exist()
          expect(ctx.context.nack).to.not.exist()
          // unset w/ falsey
          ctx.context.nackAll = false
          expect(ctx.context.nackAll).to.not.exist()
          ctx.context.ack = false // coverage
          expect(ctx.context.ack).to.not.exist()
          done()
        })
      })
    })

    describe('publish', function () {
      beforeEach(function (done) {
        ctx.exchange = 'exchange'
        ctx.routingKey = 'routingKey'
        ctx.content = 'content'
        ctx.options = {}
        ctx.context.publisherChannel.publish = sinon.stub()
        done()
      })

      it('should publish on publisherChannel', function (done) {
        ctx.context.publish(ctx.exchange, ctx.routingKey, ctx.content, ctx.options)
        sinon.assert.calledOnce(ctx.context.publisherChannel.publish)
        sinon.assert.calledWith(
          ctx.context.publisherChannel.publish,
          ctx.exchange, ctx.routingKey, new Buffer(ctx.content), ctx.options)
        done()
      })
    })

    describe('sendToQueue', function () {
      beforeEach(function (done) {
        ctx.content = {foo: 1}
        ctx.options = {}
        ctx.context.publisherChannel.sendToQueue = sinon.stub()
        done()
      })

      it('should sendToQueue on publisherChannel', function (done) {
        ctx.context.sendToQueue(ctx.queueName, ctx.content, ctx.options)
        sinon.assert.calledOnce(ctx.context.publisherChannel.sendToQueue)
        sinon.assert.calledWith(
          ctx.context.publisherChannel.sendToQueue,
          ctx.queueName, new Buffer(JSON.stringify(ctx.content)), ctx.options)
        done()
      })
    })

    describe('reply', function () {
      beforeEach(function (done) {
        ctx.content = 'content'
        ctx.options = {}
        ctx.replyTo = 'reply-queue'
        ctx.correlationId = '12345'
        ctx.context.message.properties = {
          replyTo: ctx.replyTo,
          correlationId: ctx.correlationId
        }
        // replies must be made on same channel which message was recieved
        ctx.context.consumerChannel.sendToQueue = sinon.stub()
        done()
      })

      it('should reply to an rpc request message', function (done) {
        ctx.context.reply(ctx.content, ctx.options)
        sinon.assert.calledOnce(ctx.context.consumerChannel.sendToQueue)
        const expectedOptions = put(ctx.options, {
          correlationId: ctx.correlationId
        })
        sinon.assert.calledWith(
          ctx.context.consumerChannel.sendToQueue,
          ctx.replyTo, new Buffer(ctx.content), expectedOptions)
        done()
      })
    })

    describe('request', function () {
      beforeEach(function (done) {
        ctx.content = 'content'
        ctx.sendOpts = {}
        ctx.queueOpts = {}
        ctx.consumeOpts = {}
        done()
      })
      beforeEach(function (done) {
        ctx.replyQueue = 'reply-queue'
        ctx.replyContent = 'reply-content'
        ctx.replyChannel = {
          assertQueue: sinon.stub().resolves({
            queue: ctx.replyQueue
          }),
          consume: mockConsume,
          sendToQueue: mockSendToQueue,
          close: sinon.stub()
        }
        ctx.context.connection.createChannel = sinon.stub().resolves(ctx.replyChannel)
        ctx.consumeSpy = sinon.spy(ctx.replyChannel, 'consume')
        ctx.sendToQueueSpy = sinon.spy(ctx.replyChannel, 'sendToQueue')
        // mockConsume and mockSend
        function mockConsume (replyQueue, handler) {
          ctx.consumeMsgHandler = handler
          return new Promise(function (r) { r() })
        }
        function mockSendToQueue (queue, content, opts) {
          process.nextTick(function () {
            const noiseMessage = {
              content: 'hai', properties: {}
            }
            ctx.consumeMsgHandler(noiseMessage)
            const replyMessage = {
              content: ctx.replyContent,
              properties: {
                correlationId: opts.correlationId
              }
            }
            ctx.consumeMsgHandler(replyMessage)
          })
        }
        done()
      })

      describe('success req and reply', function () {
        beforeEach(function (done) {
          ctx.replyChannel.close.resolves()
          done()
        })

        it('should make a request to an rpc queue', function (done) {
          var channelCreatedHandler = sinon.stub()
          var channelClosedHandler = sinon.stub()
          ctx.app.once('channel:create', channelCreatedHandler)
          ctx.app.once('channel:close', channelClosedHandler)
          ctx.context.request(
            ctx.queueName, ctx.content,
            ctx.sendOpts, ctx.queueOpts, ctx.consumeOpts
          ).then(success).catch(done)
          function success () {
            // assert connection creation
            sinon.assert.calledOnce(ctx.context.connection.createChannel)
            sinon.assert.calledOnce(channelCreatedHandler)
            sinon.assert.calledWith(
              channelCreatedHandler, ctx.replyChannel, 'rpc')
            // assert channel creation
            sinon.assert.calledOnce(ctx.replyChannel.assertQueue)
            sinon.assert.calledWith(
              ctx.replyChannel.assertQueue, '', ctx.queueOpts)
            // setup reply consumer
            sinon.assert.calledOnce(ctx.consumeSpy)
            sinon.assert.calledWith(
              ctx.consumeSpy, ctx.replyQueue, sinon.match.func, ctx.consumeOpts)
            // assert message send
            sinon.assert.calledOnce(ctx.sendToQueueSpy)
            sinon.assert.calledWith(
              ctx.sendToQueueSpy,
              ctx.queueName, new Buffer(ctx.content), ctx.sendOpts)
            // channel close
            sinon.assert.calledOnce(ctx.replyChannel.close)
            sinon.assert.calledOnce(channelClosedHandler)
            sinon.assert.calledWith(channelClosedHandler, ctx.replyChannel, 'rpc')
            done()
          }
        })
      })

      describe('channel close error', function () {
        beforeEach(function (done) {
          ctx.closeErr = new Error('close error')
          ctx.replyChannel.close.rejects(ctx.closeErr)
          done()
        })

        it('should emit "channel:close:error"', function (done) {
          var channelCloseErroredHandler = sinon.stub()
          ctx.app.once('channel:close:error', channelCloseErroredHandler)
          ctx.context.request(
            ctx.queueName, ctx.content,
            ctx.sendOpts, ctx.queueOpts, ctx.consumeOpts
          ).then(success).catch(done)
          function success () {
            sinon.assert.calledOnce(ctx.replyChannel.close)
            process.nextTick(function () {
              sinon.assert.calledOnce(ctx.replyChannel.close)
              sinon.assert.calledOnce(channelCloseErroredHandler)
              sinon.assert.calledWith(
                channelCloseErroredHandler,
                ctx.closeErr, ctx.replyChannel, 'rpc')
              done()
            })
          }
        })
      })

      describe('create channel err', function () {
        beforeEach(function (done) {
          ctx.channelErr = new Error('channel create err')
          ctx.replyChannel.assertQueue = sinon.stub().rejects(ctx.channelErr)
          ctx.replyChannel.close.resolves()
          done()
        })

        it('should callback the error', function (done) {
          ctx.context.request(
            ctx.queueName, ctx.content,
            ctx.sendOpts, ctx.queueOpts, ctx.consumeOpts
          ).then(function () {
            done(new Error('expected an error'))
          }).catch(function (err) {
            expect(err).to.equal(ctx.channelErr)
            done()
          })
        })
      })
    })
  })
})
