'use strict'
const EventEmitter = require('events').EventEmitter
const domain = require('domain')

const Code = require('code')
const Lab = require('lab')
const proxyquire = require('proxyquire')
const RabbitSchema = require('rabbitmq-schema')
const sinon = require('sinon')
require('sinon-as-promised')

const lab = exports.lab = Lab.script()
const describe = lab.describe
const it = lab.it
const beforeEach = lab.beforeEach
const afterEach = lab.afterEach
const expect = Code.expect

const Application = require('../lib/application.js')
const Context = require('../lib/context.js')

describe('Application', function () {
  let ctx
  // utils
  function sinonPromiseStub () {
    let resolve
    let reject
    const promise = new Promise(function (res, rej) {
      resolve = res
      reject = rej
    })
    const stub = sinon.stub().returns(promise)
    stub.resolve = resolve
    stub.reject = reject

    return stub
  }

  // tests
  beforeEach(function (done) {
    ctx = {}
    done()
  })

  describe('constructor', function () {
    it('should create an application', function (done) {
      const app = new Application()
      expect(app).to.be.an.instanceOf(Application)
      done()
    })

    it('should create an application w/out new', function (done) {
      const app = Application()
      expect(app).to.be.an.instanceOf(Application)
      done()
    })
  })

  describe('instance methods', function () {
    beforeEach(function (done) {
      ctx.app = new Application()
      done()
    })

    describe('use', function () {
      it('should error if not passed a generator', function (done) {
        expect(function () {
          ctx.app.use(1)
        }).to.throw(/generator/)
        done()
      })

      it('should accept a generator', function (done) {
        ctx.app.use(function * () {})
        done()
      })
    })

    describe('consume', function () {
      it('should error if not passed a string queueName', function (done) {
        expect(function () {
          ctx.app.consume(1)
        }).to.throw(/queueName.*string/)
        done()
      })
      it('should error if not passed an object options', function (done) {
        expect(function () {
          ctx.app.consume('queue', 1, function * () {})
        }).to.throw(/options.*object/)
        done()
      })
      it('should error if not passed any middlewares', function (done) {
        expect(function () {
          ctx.app.consume('queue', {})
        }).to.throw(/middlewares.*required/)
        done()
      })
      it('should error if pass non-generator middleware', function (done) {
        expect(function () {
          ctx.app.consume('queue', {}, function () {})
        }).to.throw(/middlewares.*generator/)
        done()
      })
      it('should error if pass non-generator middleware 2', function (done) {
        expect(function () {
          ctx.app.consume('queue', {}, function * () {}, function () {})
        }).to.throw(/middlewares.*generator/)
        done()
      })
      it('should accept a generator', function (done) {
        ctx.app.consume('queue', function * () {})
        ctx.app.consume('queue', {}, function * () {})
        ctx.app.consume('queue', {}, function * () {}, function * () {}, function * () {})
        expect(ctx.app.queueMiddlewares['queue'].length).to.equal(5)
        done()
      })

      describe('app w/ schema', function () {
        beforeEach(function (done) {
          const schema = new RabbitSchema({
            queue: 'queue-name',
            messageSchema: {}
          })
          ctx.app = new Application(schema)
          done()
        })

        it('should error if the queue with queueName does not exist in schema', function (done) {
          expect(function () {
            ctx.app.consume('queue-foo', {}, function * () {})
          }).to.throw(/queueName.*exist/)
          done()
        })

        it('should not error if the queue with queueName exists in schema', function (done) {
          ctx.app.consume('queue-name', {}, function * () {})
          done()
        })
      })
    })

    describe('messageHandler', function () {
      beforeEach(function (done) {
        ctx.dispatch = new EventEmitter()
        var Application = proxyquire('../lib/application.js', {
          // mock respond
          './rabbit-utils/app-respond.js': function () {
            this.state.order.push('respond')
            ctx.dispatch.emit('respond:called')
          }
        })
        ctx.app = new Application()
        ctx.queueName = 'queue-name'
        ctx.message = new Buffer('message')
        done()
      })

      describe('middleware order', function () {
        beforeEach(function (done) {
          ctx.queueName = 'queue-name'
          ctx.message = new Buffer('message')
          ctx.invokeOrder = []

          ctx.app.use(function * (next) {
            ctx.context = this
            this.state.order = ctx.invokeOrder
            this.state.order.push(1)
            yield next
            this.state.order.push(10)
          })
          ctx.app.use(function * (next) {
            this.state.order.push(2)
            yield next
            this.state.order.push(20)
          })
          ctx.app.consume(ctx.queueName,
            function * (next) {
              this.state.order.push(3)
              yield next
              this.state.order.push(30)
            },
            function * (next) {
              this.state.order.push(4)
              yield next
              this.state.order.push(40)
            })
          done()
        })

        it('should create a handler that calls all middlewares and queueMiddlewares in order', function (done) {
          var handler = ctx.app.messageHandler(ctx.queueName)
          expect(handler).to.be.a.function()
          expect(handler.length).to.equal(1)
          handler(ctx.message)
          ctx.dispatch.once('respond:called', function () {
            expect(ctx.invokeOrder).to.deep.equal([
              1,
              2,
              3,
              4,
              40,
              30,
              20,
              10,
              'respond'
            ])
            done()
          })
        })
      })

      describe('middleware error', function () {
        beforeEach(function (done) {
          ctx.dispatch = new EventEmitter()
          ctx.err = new Error('boom')
          ctx.onerrorMock = function (err) {
            ctx.dispatch.emit('onerror:called', err)
          }
          ctx.app.onerror = ctx.onerrorMock
          done()
        })

        it('should call onerror for throw errors', function (done) {
          ctx.app.consume(ctx.queueName, function * () {
            throw ctx.err
          })
          const handler = ctx.app.messageHandler(ctx.queueName)
          handler(ctx.message)
          ctx.dispatch.once('onerror:called', function (err) {
            expect(err).to.equal(ctx.err)
            done()
          })
        })
        it('should call onerror for promise errors', function (done) {
          const promiseErr = new Promise(function (r, reject) {
            reject(ctx.err)
          })
          ctx.app.consume(ctx.queueName, function * () {
            yield promiseErr
          })
          const handler = ctx.app.messageHandler(ctx.queueName)
          handler(ctx.message)
          ctx.dispatch.once('onerror:called', function (err) {
            expect(err).to.equal(ctx.err)
            done()
          })
        })
        it('should call onerror for cb errors', function (done) {
          const cbErr = function (cb) {
            cb(ctx.err)
          }
          ctx.app.consume(ctx.queueName, function * () {
            yield cbErr
          })
          const handler = ctx.app.messageHandler(ctx.queueName)
          handler(ctx.message)
          ctx.dispatch.once('onerror:called', function (err) {
            expect(err).to.equal(ctx.err)
            done()
          })
        })

        describe('onerror error', function () {
          beforeEach(function (done) {
            ctx.cbErr = new Error('callbackErr')
            ctx.domain = domain.create()
            ctx.app.onerror = function () {
              ctx.domain.enter() // lab is doing something strange w/ domains
              ctx.onerrorErr = new Error('onerrorErr')
              throw ctx.onerrorErr
            }
            done()
          })

          it('should nextTick and throw error', function (done) {
            process.nextTick(function () {
              const cbErr = function (cb) {
                cb(ctx.err)
              }
              ctx.app.consume(ctx.queueName, function * () {
                yield cbErr
              })
              const handler = ctx.app.messageHandler(ctx.queueName)
              const d = ctx.domain
              d.setMaxListeners(100) // avoid warning
              d.on('error', function (err) {
                try {
                  expect(err).to.equal(ctx.onerrorErr)
                  done()
                } catch (e) {
                  done(e)
                }
              })
              d.run(function () {
                handler(ctx.message)
              })
            })
          })
        })
      })
    })

    describe('connect', function () {
      beforeEach(function (done) {
        ctx.queueName = 'queue-name'
        ctx.url = 'rabbitmq:5672'
        ctx.socketOptions = {}
        ctx.app = new Application()
        ctx.app.consume(ctx.queueName, function * () {})
        done()
      })

      describe('while already connecting', function () {
        beforeEach(function (done) {
          ctx.app.connectingPromise = new Promise(function () {})
          done()
        })

        it('should return existing connecting-promise', function (done) {
          const ret = ctx.app.connect(ctx.url, ctx.socketOptions)
          expect(ret).to.equal(ctx.app.connectingPromise)
          done()
        })
      })

      describe('while closing', function () {
        beforeEach(function (done) {
          ctx.app.closingPromise = new Promise(function (resolve, reject) {
            ctx.resolveClose = resolve
            ctx.rejectClose = reject
          }).then(function () {
            delete ctx.app.closingPromise
          }).catch(function (err) {
            delete ctx.app.closingPromise
            throw err
          })
          done()
        })

        it('should connect after close finishes', function (done) {
          const promise = ctx.app.connect(ctx.url, ctx.socketOptions)
          sinon.stub(ctx.app, 'connect').resolves()
          promise.then(function () {
            expect(ctx.app.closingPromise).to.not.exist() // deleted by mock closing promise
            expect(ctx.app.connectingPromise).to.not.exist()
            sinon.assert.calledOnce(ctx.app.connect, ctx.url, ctx.socketOptions)
            done()
          }).catch(done)
          // resolve close
          ctx.resolveClose()
        })
        it('should cancel connect if close fails', function (done) {
          const promise = ctx.app.connect(ctx.url, ctx.socketOptions)
          sinon.spy(ctx.app, 'connect')
          promise.catch(function (err) {
            expect(ctx.app.closingPromise).to.not.exist() // deleted by closing promise mock
            expect(ctx.app.connectingPromise).to.not.exist()
            sinon.assert.notCalled(ctx.app.connect)
            expect(err.message).to.equal('Connect cancelled because pending close failed (closeErr)')
            expect(err.closeErr).to.equal(ctx.err)
            done()
          }).catch(done)
          // reject close w/ err
          ctx.err = new Error('close error')
          ctx.rejectClose(ctx.err)
        })
      })

      describe('while already connected', function () {
        beforeEach(function (done) {
          ctx.app.connection = {}
          ctx.app.consumerChannel = {}
          ctx.app.publisherChannel = {}
          ctx.app.consumerTags = []
          done()
        })

        it('should just callback', function (done) {
          ctx.app.connect(ctx.url, ctx.socketOptions, done)
        })
      })

      describe('while closed', function () {
        beforeEach(function (done) {
          ctx.createAppConnectionStub = sinonPromiseStub()
          ctx.createAppChannelStub = sinonPromiseStub()
          ctx.consumeAppQueuesStub = sinonPromiseStub()
          const Application = proxyquire('../lib/application.js', {
            './rabbit-utils/create-app-connection.js': ctx.createAppConnectionStub,
            './rabbit-utils/create-app-channel.js': ctx.createAppChannelStub,
            './rabbit-utils/consume-app-queues.js': ctx.consumeAppQueuesStub
          })
          ctx.app = new Application()
          ctx.app.consume(ctx.queueName, function * () {})
          done()
        })

        it('should connect, create channels, and consume queues', function (done) {
          const promise = ctx.app.connect(ctx.url, ctx.socketOptions)
          expect(ctx.app.connectingPromise).to.equal(promise)
          promise.then(function () {
            expect(ctx.app.connectingPromise).to.not.exist()
            done()
          }).catch(done)
          // resolve all connect's promises
          ctx.createAppConnectionStub.resolve()
          ctx.createAppChannelStub.resolve()
          ctx.consumeAppQueuesStub.resolve()
        })

        describe('connect errors', function () {
          it('should call close if connect fails', function (done) {
            const err = new Error('boom')
            const promise = ctx.app.connect(ctx.url, ctx.socketOptions)
            expect(ctx.app.connectingPromise).to.equal(promise)
            sinon.stub(ctx.app, 'close').resolves()
            promise.catch(function (connErr) {
              expect(ctx.app.connectingPromise).to.not.exist()
              sinon.assert.calledOnce(ctx.app.close)
              expect(connErr).to.equal(err)
              done()
            })
            // cause connect error
            ctx.createAppConnectionStub.reject(err)
          })

          it('should ignore close err if connect fails and close fails', function (done) {
            const connectErr = new Error('connect failed')
            const closeErr = new Error('close failed')
            const promise = ctx.app.connect(ctx.url, ctx.socketOptions)
            expect(ctx.app.connectingPromise).to.equal(promise)
            sinon.stub(ctx.app, 'close').rejects(closeErr)
            promise.catch(function (err) {
              expect(ctx.app.connectingPromise).to.not.exist()
              sinon.assert.calledOnce(ctx.app.close)
              expect(err).to.equal(connectErr)
              done()
            })
            // cause connect error
            ctx.createAppConnectionStub.reject(connectErr)
          })
        })
      })
    })

    describe('close', function () {
      beforeEach(function (done) {
        ctx.queueName = 'queue-name'
        ctx.url = 'rabbitmq:5672'
        ctx.socketOptions = {}
        ctx.app = new Application()
        ctx.app.consume(ctx.queueName, function * () {})
        done()
      })

      describe('while already closing', function () {
        beforeEach(function (done) {
          ctx.app.closingPromise = new Promise(function () {})
          done()
        })

        it('should return existing closing-promise', function (done) {
          const ret = ctx.app.close()
          expect(ret).to.equal(ctx.app.closingPromise)
          done()
        })
      })

      describe('while connecting', function () {
        beforeEach(function (done) {
          ctx.app.connectingPromise = new Promise(function (resolve, reject) {
            ctx.resolveConnect = resolve
            ctx.rejectConnect = reject
          }).then(function () {
            delete ctx.app.connectingPromise
          }).catch(function (err) {
            delete ctx.app.connectingPromise
            throw err
          })
          done()
        })

        it('should close after connect finishes', function (done) {
          const promise = ctx.app.close()
          sinon.stub(ctx.app, 'close').resolves()
          promise.then(function () {
            expect(ctx.app.connectingPromise).to.not.exist() // deleted by mock connecting promise
            expect(ctx.app.closingPromise).to.not.exist()
            sinon.assert.calledOnce(ctx.app.close)
            done()
          }).catch(done)
          // resolve connect
          ctx.resolveConnect()
        })
        it('should cancel close if connect fails', function (done) {
          const promise = ctx.app.close()
          sinon.stub(ctx.app, 'close').resolves()
          promise.catch(function (err) {
            expect(ctx.app.connectingPromise).to.not.exist() // deleted by mock connecting promise
            expect(ctx.app.closingPromise).to.not.exist()
            expect(err.message).to.equal('Close cancelled because pending connect failed (closeErr)')
            expect(err.connectErr).to.equal(ctx.err)
            sinon.assert.notCalled(ctx.app.close)
            done()
          }).catch(done)
          // resolve connect
          ctx.err = new Error('connect err')
          ctx.rejectConnect(ctx.err)
        })
      })

      describe('while already closed', function () {
        it('should just callback', function (done) {
          ctx.app.close(done)
        })
      })

      describe('while connected', function () {
        beforeEach(function (done) {
          ctx.app.consumerChannel = { close: sinon.stub() }
          ctx.app.consumerTags = []
          ctx.app.producerChannel = { close: sinon.stub() }
          ctx.app.connection = { close: sinon.stub() }
          done()
        })

        it('should close connection and channels', function (done) {
          ctx.app.consumerChannel.close.resolves()
          ctx.app.producerChannel.close.resolves()
          ctx.app.connection.close.resolves()
          const promise = ctx.app.close()
          expect(promise).to.equal(ctx.app.closingPromise)
          promise.then(function () {
            expect(ctx.app.closingPromise).to.not.exist()
            sinon.assert.calledOnce(ctx.app.consumerChannel.close)
            sinon.assert.calledOnce(ctx.app.producerChannel.close)
            sinon.assert.calledOnce(ctx.app.connection.close)
            done()
          }).catch(done)
        })

        it('should throw error if close fails', function (done) {
          ctx.err = new Error('boom')
          ctx.app.consumerChannel.close.rejects(ctx.err)
          const promise = ctx.app.close()
          expect(promise).to.equal(ctx.app.closingPromise)
          promise.catch(function (err) {
            expect(ctx.app.closingPromise).to.not.exist()
            expect(err).to.equal(ctx.err)
            done()
          }).catch(done)
        })
      })
    })

    describe('onerror', function () {
      beforeEach(function (done) {
        ctx.app.consumerChannel = { nack: sinon.stub() }
        ctx.context = new Context(ctx.app, 'queue-name', {})
        sinon.stub(console, 'error')
        done()
      })
      afterEach(function (done) {
        console.error.restore()
        done()
      })

      it('it should throw an error if it recieves a non-error', function (done) {
        ctx.app.onerror.call(ctx.context, 10)
          .then(function () {
            done(new Error('expected an error'))
          })
          .catch(function (err) {
            expect(err).to.be.an.instanceOf(Error)
            expect(err.message).to.equal('non-error thrown: 10')
            done()
          })
      })

      it('should log error.stack', function (done) {
        const err = new Error('boom')
        ctx.app.consumerChannel.nack.resolves()
        ctx.app.onerror.call(ctx.context, err)
        sinon.assert.calledThrice(console.error)
        sinon.assert.calledWith(console.error.firstCall)
        sinon.assert.calledWith(console.error.secondCall, err.stack.replace(/^/gm, '  '))
        sinon.assert.calledWith(console.error.thirdCall)
        done()
      })

      it('should log error.toString() if stack does not exist', function (done) {
        const err = new Error('boom')
        ctx.app.consumerChannel.nack.resolves()
        delete err.stack
        ctx.app.onerror.call(ctx.context, err)
        sinon.assert.calledThrice(console.error)
        sinon.assert.calledWith(console.error.firstCall)
        sinon.assert.calledWith(console.error.secondCall, err.toString().replace(/^/gm, '  '))
        sinon.assert.calledWith(console.error.thirdCall)
        done()
      })

      it('should log runtime error if onerror errors', function (done) {
        const err = new Error('boom')
        ctx.app.consumerChannel.nack.resolves()
        delete err.stack
        err.toString = function () {
          return null
        }
        ctx.app.onerror.call(ctx.context, err)
          .catch(function (err) {
            var errMessageRE = /Cannot read property.*replace.*of/
            const replaceErr = sinon.match(function (str) {
              return errMessageRE.test(str)
            }, 'Cannot read property "replace"')
            expect(err.message).to.match(errMessageRE)
            sinon.assert.calledThrice(console.error)
            sinon.assert.calledWith(console.error.firstCall)
            sinon.assert.calledWith(console.error.secondCall, replaceErr)
            sinon.assert.calledWith(console.error.thirdCall)
            done()
          })
      })

      describe('silent', function () {
        beforeEach(function (done) {
          ctx.app.silent = true
          done()
        })

        it('it should throw an error if it recieves a non-error', function (done) {
          ctx.app.onerror.call(ctx.context, 10)
            .catch(function (err) {
              expect(err).to.be.an.instanceOf(Error)
              expect(err.message).to.equal('non-error thrown: 10')
              done()
            })
        })

        it('should NOT log error', function (done) {
          const err = new Error('boom')
          ctx.app.onerror.call(ctx.context, err)
          sinon.assert.notCalled(console.error)
          done()
        })
      })
    })

    describe('finalhandler', function () {
      beforeEach(function (done) {
        ctx.onerror = ctx.app.onerror = sinon.stub()
        ctx.context = new Context(ctx.app, 'queue-name', {})
        done()
      })

      it('should call onerror', function (done) {
        const matchErr = sinon.match(function (err) {
          return err.message === 'Message reached final handler w/out any ack'
        })
        ctx.app.finalhandler()
        sinon.assert.calledOnce(ctx.onerror)
        sinon.assert.calledWith(ctx.onerror, matchErr)
        done()
      })
    })
  })
})
