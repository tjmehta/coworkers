'use strict'

const Code = require('code')
const Lab = require('lab')
const proxyquire = require('proxyquire')
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
          consumerTag: 'foo',
          deliveryTag: 1,
          redelivered: false,
          exchange: '',
          routingKey: 'routing.key'
        },
        properties: {
          headers: {}
        },
        content: new Buffer('foo')
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
      // expect context to copy app properties
      expect(context.appFoo).to.equal(ctx.app.context.appFoo)
      expect(context.app).to.equal(app)
      expect(context.connection).to.equal(app.connection)
      expect(context.consumerChannel).to.equal(app.consumerChannel)
      expect(context.publisherChannel).to.equal(app.publisherChannel)
      // expect context properties
      expect(context.queueName).to.equal(ctx.queueName)
      expect(context.message).to.equal(ctx.message)
      expect(context.consumerTag).to.equal(ctx.message.fields.consumerTag)
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
          consumerTag: 'foo',
          deliveryTag: 1,
          redelivered: false,
          exchange: '',
          routingKey: 'routing.key'
        },
        properties: {
          headers: {}
        },
        content: new Buffer('foo')
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
      ctx.amqplibRpc = {
        request: sinon.stub(),
        reply: sinon.stub()
      }
      ctx.Context = proxyquire('../lib/context.js', {
        'amqplib-rpc': ctx.amqplibRpc
      })
      ctx.context = new ctx.Context(ctx.app, ctx.queueName, ctx.message)
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

      describe('after onerror', function () {
        beforeEach(function (done) {
          sinon.stub(ctx.app, 'emit')
          ctx.Context.onerror(ctx.context)
          done()
        })

        it('should throw a special error when get/set ack,nack,..', function (done) {
          expect(function () {
            ctx.context.ack
          }).to.throw(/Ack.*not available/)
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
        done()
      })

      it('should reply to an rpc request message', function (done) {
        ctx.context.reply(ctx.content, ctx.options)
        sinon.assert.calledOnce(ctx.amqplibRpc.reply)
        sinon.assert.calledWith(ctx.amqplibRpc.reply,
          ctx.context.publisherChannel,
          ctx.message,
          ctx.content,
          ctx.options)
        done()
      })
    })

    describe('request', function () {
      beforeEach(function (done) {
        ctx.content = 'content'
        ctx.sendOpts = {}
        ctx.queueOpts = {}
        ctx.consumeOpts = {}
        ctx.replyQueue = 'reply-queue'
        ctx.replyMessage = {
          properties: { correlationId: 1 },
          content: 'reply-content'
        }
        ctx.amqplibRpc.request.resolves(ctx.replyMessage)
        done()
      })

      it('should make a rpc request', function (done) {
        ctx.context.request(
          ctx.queueName,
          ctx.content,
          ctx.sendOpts,
          ctx.queueOpts,
          ctx.consumeOpts).then(function (replyMessage) {
            expect(replyMessage).to.equal(ctx.replyMessage)
            sinon.assert.calledOnce(ctx.amqplibRpc.request)
            sinon.assert.calledWith(ctx.amqplibRpc.request,
              ctx.app.connection,
              ctx.queueName,
              new Buffer(ctx.content),
              {
                sendOpts: {},
                queueOpts: {},
                consumeOpts: {}
              })
            done()
          }).catch(done)
      })
    })

    describe('checkQueue', function () {
      beforeEach(function (done) {
        ctx.ret = {}
        ctx.amqplibRpc = {
          checkQueue: sinon.stub().returns(ctx.ret)
        }
        ctx.Context = proxyquire('../lib/context.js', {
          'amqplib-rpc': ctx.amqplibRpc
        })
        ctx.connection = {}
        ctx.app = {
          connection: ctx.connection,
          queueMiddlewares: {}
        }
        ctx.app.queueMiddlewares[ctx.queueName] = {}
        ctx.queueName = 'queue-name'
        ctx.message = {}
        ctx.context = new ctx.Context(ctx.app, ctx.queueName, ctx.message)
        done()
      })

      it('should call amqplib-rpc checkQueue', function (done) {
        var checkQueueName = 'check-queue-name'
        var cb = function () {}
        var ret = ctx.context.checkQueue(checkQueueName, cb)
        sinon.assert.calledOnce(ctx.amqplibRpc.checkQueue)
        sinon.assert.calledWith(ctx.amqplibRpc.checkQueue,
          ctx.connection, checkQueueName, cb)
        expect(ret).to.equal(ctx.ret)
        done()
      })
    })

    describe('checkReplyQueue', function () {
      beforeEach(function (done) {
        ctx.ret = {}
        ctx.amqplibRpc = {
          checkReplyQueue: sinon.stub().returns(ctx.ret)
        }
        ctx.Context = proxyquire('../lib/context.js', {
          'amqplib-rpc': ctx.amqplibRpc
        })
        ctx.connection = {}
        ctx.app = {
          connection: ctx.connection,
          queueMiddlewares: {}
        }
        ctx.app.queueMiddlewares[ctx.queueName] = {}
        ctx.queueName = 'queue-name'
        ctx.message = {}
        ctx.context = new ctx.Context(ctx.app, ctx.queueName, ctx.message)
        done()
      })

      it('should call amqplib-rpc checkReplyQueue', function (done) {
        var cb = function () {}
        var ret = ctx.context.checkReplyQueue(cb)
        sinon.assert.calledOnce(ctx.amqplibRpc.checkReplyQueue)
        sinon.assert.calledWith(ctx.amqplibRpc.checkReplyQueue,
          ctx.connection, ctx.message, cb)
        expect(ret).to.equal(ctx.ret)
        done()
      })
    })

    describe('toJSON', function () {
      it('should return json version of context', function (done) {
        expect(
          Object.keys(ctx.context.toJSON()).sort()
        ).to.deep.equal([
          'queueName',
          'message',
          'content',
          'properties', // props
          'headers',
          'messageAcked',
          'fields', // fields
          'consumerTag',
          'deliveryTag',
          'redelivered',
          'exchange',
          'routingKey',
          // other
          'queueOpts',
          'consumeOpts',
          'state',
          'ack',
          'nack',
          'ackAll',
          'nackAll',
          'reject',
          'appFoo'
        ].sort())
        done()
      })
    })

    describe('accessors', function () {
      it('should allow both getting and settings accessors', function (done) {
        // message
        ctx.context.content = 'foobar'
        expect(ctx.context.content)
          .to.equal(ctx.context.message.content)
          .to.equal('foobar')
        ctx.context.messageAcked = true
        expect(ctx.context.messageAcked)
          .to.equal(ctx.context.message.messageAcked)
          .to.equal(true)
        // fields
        ctx.context.redelivered = true
        expect(ctx.context.redelivered)
          .to.equal(ctx.context.fields.redelivered)
          .to.equal(ctx.context.message.fields.redelivered)
          .to.equal(true)
        ctx.context.exchange = 'foobar'
        expect(ctx.context.exchange)
          .to.equal(ctx.context.message.fields.exchange)
          .to.equal('foobar')
        ctx.context.routingKey = 'foobar'
        expect(ctx.context.routingKey)
          .to.equal(ctx.context.fields.routingKey)
          .to.equal(ctx.context.message.fields.routingKey)
          .to.equal('foobar')
        done()
      })
    })

    describe('getters', function () {
      it('should only allow getting accessors', function (done) {
        // message
        expect(function () {
          ctx.context.fields = 'foobar'
        }).to.throw(/Cannot set/)
        expect(ctx.context.fields)
          .to.equal(ctx.context.message.fields)
          .to.not.equal('foobar')
        expect(function () {
          ctx.context.properties = 'foobar'
        }).to.throw(/Cannot set/)
        expect(ctx.context.properties)
          .to.equal(ctx.context.message.properties)
          .to.not.equal('foobar')
        // properties
        expect(function () {
          ctx.context.headers = 'foobar'
        }).to.throw(/Cannot set/)
        expect(ctx.context.headers)
          .to.equal(ctx.context.properties.headers)
          .to.equal(ctx.context.message.properties.headers)
          .to.not.equal('foobar')
        // fields
        expect(function () {
          ctx.context.consumerTag = 'foobar'
        }).to.throw(/Cannot set/)
        expect(ctx.context.consumerTag)
          .to.equal(ctx.context.fields.consumerTag)
          .to.equal(ctx.context.message.fields.consumerTag)
          .to.not.equal('foobar')
        expect(function () {
          ctx.context.deliveryTag = 'foobar'
        }).to.throw(/Cannot set/)
        expect(ctx.context.deliveryTag)
          .to.equal(ctx.context.fields.deliveryTag)
          .to.equal(ctx.context.message.fields.deliveryTag)
          .to.not.equal('foobar')
        done()
      })
    })
  })
})
