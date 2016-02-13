'use strict'

const cluster = require('cluster')

const Code = require('code')
const Lab = require('lab')
const last = require('101/last')
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

describe('Application', function () {
  let ctx
  // utils
  function sinonPromiseStub () {
    let _resolve
    let _reject
    const promise = new Promise(function (resolve, reject) {
      _resolve = resolve
      _reject = reject
    })
    const stub = sinon.stub().returns(promise)
    stub.resolve = _resolve
    stub.reject = _reject

    return stub
  }

  // tests
  beforeEach(function (done) {
    ctx = {}
    sinon.stub(process, 'on')
    sinon.stub(process, 'removeListener')
    done()
  })
  afterEach(function (done) {
    process.on.restore()
    process.removeListener.restore()
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

    describe('options', function () {
      describe('options.cluster', function () {
        beforeEach(function (done) {
          ctx.mockClusterManager = {}
          ctx.MockClusterManager = sinon.stub().returns(ctx.mockClusterManager)
          ctx.Application = proxyquire('../lib/application.js', {
            './cluster-manager.js': ctx.MockClusterManager
          })
          done()
        })

        it('should default init cluster manager if true', function (done) {
          const app = new ctx.Application({ cluster: true })
          sinon.assert.calledOnce(ctx.MockClusterManager)
          sinon.assert.calledWith(ctx.MockClusterManager, app)
          expect(app.clusterManager).to.equal(ctx.mockClusterManager)
          done()
        })

        describe('w/ options.queueName', function () {
          beforeEach(function (done) {
            process.env.COWORKERS_CLUSTER = 'true'
            sinon.stub(console, 'warn')
            done()
          })
          afterEach(function (done) {
            delete process.env.COWORKERS_CLUSTER
            console.warn.restore()
            done()
          })

          it('should warn if cluster:true, and queueName exists', function (done) {
            const app = new ctx.Application({ queueName: 'queue-name' })
            sinon.assert.calledOnce(ctx.MockClusterManager)
            sinon.assert.calledWith(ctx.MockClusterManager, app)
            expect(app.clusterManager).to.equal(ctx.mockClusterManager)
            // assert warning
            sinon.assert.calledOnce(console.warn)
            sinon.assert.calledWith(console.warn, 'warn: "queueName" is not required when clustering is enabled')
            done()
          })
        })
      })

      describe('options.queueName', function () {
        it('should require queueName if clustering is disabled', function (done) {
          expect(function () {
            Application({ cluster: false })
          }).to.throw(/queueName.*is required/)
          done()
        })

        describe('COWORKERS_QUEUE', function () {
          beforeEach(function (done) {
            process.env.COWORKERS_QUEUE = 'queue-name'
            // use proxyquire to cover debug.js
            ctx.Application = proxyquire('../lib/application.js', {
              'co': require('co')
            })
            done()
          })
          afterEach(function (done) {
            // restore value
            delete process.env.COWORKERS_QUEUE
            done()
          })

          it('should default to process.env.COWORKERS_QUEUE', function (done) {
            const app = new ctx.Application({ cluster: false })
            expect(app.queueName).to.equal(process.env.COWORKERS_QUEUE)
            done()
          })
        })
      })
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
        ctx.app.use(function * foo () {})
        done()
      })
    })

    describe('queue', function () {
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
            ctx.app.queue('queue-foo', {}, function * () {})
          }).to.throw(/queue-foo.*exist/)
          done()
        })
        it('should error if the passed queueOpts', function (done) {
          expect(function () {
            ctx.app.queue('queue-name', {}, {}, function * () {})
          }).to.throw(/queueOpts.*schema/)
          done()
        })
        it('should not error if the queue with queueName exists in schema', function (done) {
          ctx.app.queue('queue-name', {}, function * () {})
          // test queueNames for coverage
          expect(ctx.app.queueNames).deep.equal(['queue-name'])
          done()
        })
      })

      describe('app w/out schema', function () {
        it('should error if not passed a string queueName', function (done) {
          expect(function () {
            ctx.app.queue(1)
          }).to.throw(/queueName.*string/)
          done()
        })
        it('should error if not passed an object queueOpts', function (done) {
          expect(function () {
            ctx.app.queue('queue', 1, function * () {})
          }).to.throw(/queueOpts.*object/)
          done()
        })
        it('should error if not passed an object consumeOpts', function (done) {
          expect(function () {
            ctx.app.queue('queue', {}, 1, function * () {})
          }).to.throw(/consumeOpts.*object/)
          done()
        })
        it('should error if not passed any middlewares', function (done) {
          expect(function () {
            ctx.app.queue('queue', {})
          }).to.throw(/middlewares.*required/)
          done()
        })
        it('should error if pass non-generator middleware', function (done) {
          expect(function () {
            ctx.app.queue('queue', {}, function () {})
          }).to.throw(/middlewares.*generator/)
          done()
        })
        it('should error if pass non-generator middleware 2', function (done) {
          expect(function () {
            ctx.app.queue('queue', {}, function * () {}, function () {})
          }).to.throw(/middlewares.*generator/)
          done()
        })
        it('should error if called w/ same queue more than once', function (done) {
          expect(function () {
            ctx.app.queue('queue', function * () {})
            ctx.app.queue('queue', {}, function * () {})
          }).to.throw(/queue.*already exists/)
          done()
        })
        it('should setup queue for consumption w/ no opts', function (done) {
          ctx.app.queue('queue-name', function * foo () {})
          // test queueNames for coverage
          expect(ctx.app.queueNames).deep.equal(['queue-name'])
          done()
        })
        it('should setup queue for consumption w/ queueOpts', function (done) {
          ctx.app.queue('queue-name', {}, function * () {})
          // test queueNames for coverage
          expect(ctx.app.queueNames).deep.equal(['queue-name'])
          done()
        })
        it('should setup queue for consumption w/ queueOpts and consumeOpts', function (done) {
          ctx.app.queue('queue-name', {}, {}, function * () {})
          // test queueNames for coverage
          expect(ctx.app.queueNames).deep.equal(['queue-name'])
          done()
        })
        it('should setup queue for consumption w/ multiple middlewares', function (done) {
          ctx.app.queue('queue-name', function * () {}, function * () {})
          // test queueNames for coverage
          expect(ctx.app.queueNames).deep.equal(['queue-name'])
          done()
        })
      })
    })

    describe('messageHandler', function () {
      beforeEach(function (done) {
        ctx.context = { state: {} }
        ctx.Context = sinon.stub().returns(ctx.context)
        ctx.queueName = 'queue-name'
        ctx.message = {
          content: new Buffer('message'),
          fields: {}
        }
        done()
      })

      describe('middleware order', function () {
        beforeEach(function (done) {
          ctx.mockRespond = sinon.spy(function () {
            this.state.order.push('respond')
          })
          var Application = proxyquire('../lib/application.js', {
            // mock respond
            './rabbit-utils/app-respond.js': ctx.mockRespond,
            './context.js': ctx.Context
          })
          ctx.app = new Application()
          ctx.context.app = ctx.app
          // setup middlewares
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
          ctx.app.queue(ctx.queueName,
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
          expect(handler.length).to.equal(2)
          handler(ctx.message)
            .then(function () {
              sinon.assert.calledOnce(ctx.Context)
              sinon.assert.calledWith(
                ctx.Context, ctx.app, ctx.queueName, ctx.message)
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
              sinon.assert.calledOnce(ctx.mockRespond)
              sinon.assert.calledOn(ctx.mockRespond, ctx.context)
              done()
            })
            .catch(done)
        })

        it('allow for easing Context stubbing, to aid easy testing', function (done) {
          var handler = ctx.app.messageHandler(ctx.queueName)
          expect(handler).to.be.a.function()
          expect(handler.length).to.equal(2)
          const mockContextFactory = require('./mock-context-factory')
          handler(ctx.message, mockContextFactory)
            .then(function (context) {
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
              expect(context.state.order).to.equal(ctx.invokeOrder)
              sinon.assert.calledOnce(ctx.mockRespond)
              sinon.assert.calledOn(ctx.mockRespond, ctx.context)
              done()
            })
            .catch(done)
        })
      })

      describe('middleware error', function () {
        beforeEach(function (done) {
          ctx.err = new Error('boom')
          ctx.mwPromise = sinon.stub().rejects(ctx.err)
          var Application = proxyquire('../lib/application.js', {
            './context.js': ctx.Context,
            'co': {
              wrap: sinon.stub().returns(ctx.mwPromise)
            }
          })
          ctx.app = new Application()
          ctx.context.app = ctx.app
          sinon.stub(ctx.app, 'emit')
          done()
        })
        afterEach(function (done) {
          ctx.app.emit.restore()
          done()
        })

        it('should app.emit mw errors', function (done) {
          const handler = ctx.app.messageHandler(ctx.queueName)
          handler(ctx.message)
            .then(function () {
              sinon.assert.calledOnce(ctx.mwPromise)
              sinon.assert.calledOnce(ctx.app.emit)
              sinon.assert.calledWith(ctx.app.emit, 'error', ctx.err, ctx.context)
              done()
            })
            .catch(done)
        })
      })
    })

    describe('connect', function () {
      beforeEach(function (done) {
        ctx.queueName = 'queue-name'
        ctx.url = 'localhost:5672'
        ctx.socketOptions = {}
        ctx.clusterManager = {
          start: sinon.stub().resolves()
        }
        ctx.ClusterManager = sinon.stub().returns(ctx.clusterManager)
        done()
      })

      describe('clustering enabled', function () {
        beforeEach(function (done) {
          const Application = proxyquire('../lib/application.js', {
            './cluster-manager.js': ctx.ClusterManager
          })
          ctx.app = new Application()
          ctx.app.on('error', function () {})
          ctx.app.queue(ctx.queueName, function * () {})

          done()
        })

        describe('cluster.isMaster', function () {
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
                expect(err.message).to.equal('Connect cancelled because pending close failed (.closeErr)')
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
              ctx.app.connect(ctx.url, ctx.socketOptions, function (err) {
                // test callback style
                if (err) { return done(err) }
                sinon.assert.calledOnce(ctx.clusterManager.start)
                done()
              })
            })
          })
        })

        describe('cluster.isWorker', function () {
          beforeEach(function (done) {
            ctx.app.queueName = ctx.queueName
            cluster.isMaster = false
            cluster.isWorker = true
            ctx.createAppConnectionStub = sinonPromiseStub().resolves()
            ctx.createAppChannelStub = sinonPromiseStub().resolves()
            ctx.assertAndConsumeAppQueue = sinonPromiseStub().resolves()
            const Application = proxyquire('../lib/application.js', {
              './cluster-manager.js': ctx.ClusterManager,
              './rabbit-utils/create-app-connection.js': ctx.createAppConnectionStub,
              './rabbit-utils/create-app-channel.js': ctx.createAppChannelStub,
              './rabbit-utils/assert-and-consume-app-queue.js': ctx.assertAndConsumeAppQueue
            })
            ctx.app = new Application({ cluster: true, queueName: ctx.queueName })
            ctx.app.on('error', function () {})
            ctx.app.queue(ctx.queueName, function * () {})
            process.send = sinon.stub()
            done()
          })
          afterEach(function (done) {
            cluster.isMaster = true
            cluster.isWorker = false
            delete process.send
            done()
          })

          describe('while closed', function () {
            describe('success and test sigint', function () {
              beforeEach(function (done) {
                ctx.err = new Error('boom')
                sinon.stub(ctx.app, 'close').rejects(ctx.err)
                done()
              })
              afterEach(function (done) {
                process.nextTick.restore && process.nextTick.restore()
                done()
              })

              it('should connect, create channels, and consume queues', function (done) {
                const promise = ctx.app.connect(ctx.url, ctx.socketOptions)
                expect(ctx.app.connectingPromise).to.equal(promise)
                promise.then(function () {
                  expect(ctx.app.connectingPromise).to.not.exist()
                  sinon.assert.calledOnce(ctx.createAppConnectionStub)
                  sinon.assert.calledWith(ctx.createAppConnectionStub, ctx.app, ctx.url, ctx.socketOptions)
                  sinon.assert.calledTwice(ctx.createAppChannelStub)
                  sinon.assert.calledWith(ctx.createAppChannelStub, ctx.app, 'consumerChannel')
                  sinon.assert.calledWith(ctx.createAppChannelStub, ctx.app, 'publisherChannel')
                  sinon.assert.calledOnce(ctx.assertAndConsumeAppQueue)
                  sinon.assert.calledWith(ctx.assertAndConsumeAppQueue, ctx.app, ctx.queueName)
                  sinon.assert.calledOnce(process.on)
                  sinon.assert.calledWith(process.on, 'SIGINT', ctx.app.sigintHandler)
                  sinon.assert.notCalled(ctx.app.close)
                  sinon.assert.calledOnce(process.send)
                  sinon.assert.calledWith(process.send, {
                    coworkersEvent: 'coworkers:connect'
                  })
                  // test siginthandler
                  sinon.stub(process, 'nextTick')
                  ctx.app.sigintHandler()
                    .then(function () {
                      sinon.assert.calledOnce(ctx.app.close)
                      const nextTickCb = last(process.nextTick.args)[0]
                      expect(nextTickCb).to.throw(ctx.err.message)
                      done()
                    }).catch(done)
                }).catch(done)
              })
            })

            describe('COWORKERS_RABBITMQ_URL', function () {
              beforeEach(function (done) {
                sinon.stub(ctx.app, 'close').resolves()
                ctx.url = process.env.COWORKERS_RABBITMQ_URL = 'amqp://foobar:8080'
                process.env.COWORKERS_QUEUE_WORKER_NUM = 100
                // coverage
                proxyquire('../lib/application.js', {
                  './cluster-manager.js': ctx.ClusterManager
                })({ queueName: 'foo' })
                done()
              })
              afterEach(function (done) {
                delete process.env.COWORKERS_RABBITMQ_URL
                delete process.env.COWORKERS_QUEUE_WORKER_NUM
                done()
              })

              it('should default to env', function (done) {
                const promise = ctx.app.connect(ctx.socketOptions)
                expect(ctx.app.connectingPromise).to.equal(promise)
                promise.then(function () {
                  expect(ctx.app.connectingPromise).to.not.exist()
                  sinon.assert.calledOnce(ctx.createAppConnectionStub)
                  sinon.assert.calledWith(ctx.createAppConnectionStub, ctx.app, ctx.url, ctx.socketOptions)
                  // ...
                  done()
                }).catch(done)
              })
            })
          })

          describe('while already connected', function () {
            beforeEach(function (done) {
              sinon.stub(ctx.app, 'close').resolves()
              ctx.app.connection = {}
              ctx.app.consumerChannel = {}
              ctx.app.publisherChannel = {}
              ctx.app.consumerTag = 0 // consumeTag can be user specified to be falsy
              ctx.app.sigintHandler = function () {}
              done()
            })

            it('should just callback', function (done) {
              ctx.app.connect(ctx.url, ctx.socketOptions, done)
            })
          })
        })
      })

      describe('clustering disabled', function () {
        beforeEach(function (done) {
          ctx.createAppConnectionStub = sinonPromiseStub()
          ctx.createAppChannelStub = sinonPromiseStub()
          ctx.assertAndConsumeAppQueue = sinonPromiseStub()
          const Application = proxyquire('../lib/application.js', {
            './cluster-manager.js': ctx.ClusterManager,
            './rabbit-utils/create-app-connection.js': ctx.createAppConnectionStub,
            './rabbit-utils/create-app-channel.js': ctx.createAppChannelStub,
            './rabbit-utils/assert-and-consume-app-queue.js': ctx.assertAndConsumeAppQueue
          })
          ctx.app = new Application({ cluster: false, queueName: ctx.queueName })
          ctx.app.on('error', function () {})
          ctx.app.queue(ctx.queueName, function * () {})
          done()
        })

        describe('while closed', function () {
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
            ctx.assertAndConsumeAppQueue.resolve()
          })

          describe('connect errors', function () {
            describe('has process.send', function () {
              beforeEach(function (done) {
                process.send = sinon.stub()
                done()
              })
              afterEach(function (done) {
                delete process.send
                done()
              })

              it('should call close if connect fails', function (done) {
                const err = new Error('boom')
                const promise = ctx.app.connect(ctx.url, ctx.socketOptions)
                expect(ctx.app.connectingPromise).to.equal(promise)
                sinon.stub(ctx.app, 'close').resolves()
                promise.catch(function (connErr) {
                  expect(ctx.app.connectingPromise).to.not.exist()
                  sinon.assert.calledOnce(ctx.app.close)
                  expect(connErr).to.equal(err)
                  sinon.assert.calledOnce(process.send)
                  sinon.assert.calledWith(process.send, { coworkersEvent: 'coworkers:connect:error' })
                  done()
                })
                // cause connect error
                ctx.createAppConnectionStub.reject(err)
              })
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
    })

    describe('close', function () {
      beforeEach(function (done) {
        ctx.queueName = 'queue-name'
        ctx.url = 'localhost:5672'
        ctx.socketOptions = {}
        ctx.clusterManager = {
          stop: sinon.stub().resolves()
        }
        ctx.ClusterManager = sinon.stub().returns(ctx.clusterManager)
        done()
      })

      describe('clustering enabled, cluster.isMaster', function () {
        beforeEach(function (done) {
          const Application = proxyquire('../lib/application.js', {
            './cluster-manager.js': ctx.ClusterManager
          })
          ctx.app = new Application()
          ctx.app.on('error', function () {})
          ctx.app.queue(ctx.queueName, function * () {})
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
              expect(err.message).to.equal('Close cancelled because pending connect failed (.closeErr)')
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
          // beforeEach(function () {})
          it('should just callback', function (done) {
            // testing callback style
            ctx.app.close(function (err) {
              if (err) { return done(err) }
              sinon.assert.calledOnce(ctx.clusterManager.stop)
              done()
            })
          })
        })
      })

      describe('clustering disabled', function () {
        beforeEach(function (done) {
          const Application = proxyquire('../lib/application.js', {
            './cluster-manager.js': ctx.ClusterManager
          })
          ctx.app = new Application({ cluster: false, queueName: ctx.queueName })
          ctx.app.on('error', function () {})
          ctx.app.queue(ctx.queueName, function * () {})
          done()
        })

        describe('while already closed', function () {
          // beforeEach(function () {})
          it('should just callback', function (done) {
            // testing callback style
            ctx.app.close(function (err) {
              if (err) { return done(err) }
              done()
            })
          })
        })

        describe('while connected', function () {
          beforeEach(function (done) {
            ctx.consumerCloseHandler = function () {}
            ctx.consumerErrorHandler = function () {}
            ctx.producerCloseHandler = function () {}
            ctx.producerErrorHandler = function () {}
            ctx.connCloseHandler = function () {}
            ctx.connErrorHandler = function () {}
            ctx.app.consumerChannel = {
              removeListener: sinon.stub(),
              close: sinon.stub(),
              __coworkersCloseHandler: ctx.consumerCloseHandler,
              __coworkersErrorHandler: ctx.consumerErrorHandler
            }
            ctx.app.consumerTag = 0
            ctx.app.producerChannel = {
              removeListener: sinon.stub(),
              close: sinon.stub(),
              __coworkersCloseHandler: ctx.producerCloseHandler,
              __coworkersErrorHandler: ctx.producerErrorHandler
            }
            ctx.app.connection = {
              removeListener: sinon.stub(),
              close: sinon.stub(),
              __coworkersCloseHandler: ctx.connCloseHandler,
              __coworkersErrorHandler: ctx.connErrorHandler
            }
            ctx.sigintHandler = function () {}
            ctx.app.sigintHandler = ctx.sigintHandler
            process.send = sinon.stub()
            done()
          })
          afterEach(function (done) {
            delete process.send
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
              sinon.assert.calledTwice(ctx.app.consumerChannel.removeListener)
              sinon.assert.calledWith(ctx.app.consumerChannel.removeListener, 'close', ctx.consumerCloseHandler)
              sinon.assert.calledWith(ctx.app.consumerChannel.removeListener, 'error', ctx.consumerErrorHandler)
              sinon.assert.calledOnce(ctx.app.consumerChannel.close)
              sinon.assert.calledTwice(ctx.app.producerChannel.removeListener)
              sinon.assert.calledWith(ctx.app.producerChannel.removeListener, 'close', ctx.producerCloseHandler)
              sinon.assert.calledWith(ctx.app.producerChannel.removeListener, 'error', ctx.producerErrorHandler)
              sinon.assert.calledOnce(ctx.app.producerChannel.close)
              sinon.assert.calledOnce(ctx.app.connection.close)
              sinon.assert.calledTwice(ctx.app.connection.removeListener)
              sinon.assert.calledWith(ctx.app.connection.removeListener, 'close', ctx.connCloseHandler)
              sinon.assert.calledWith(ctx.app.connection.removeListener, 'error', ctx.connErrorHandler)
              sinon.assert.calledOnce(process.removeListener)
              sinon.assert.calledWith(process.removeListener, 'SIGINT', ctx.sigintHandler)
              sinon.assert.calledOnce(process.send)
              sinon.assert.calledWith(process.send, { coworkersEvent: 'coworkers:close' })
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

          describe('without process.send', function () {
            // gotta love coverage...
            beforeEach(function (done) {
              delete process.send
              done()
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
      })
    })
  })
})
