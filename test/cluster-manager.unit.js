'use strict'

const EventEmitter = require('events').EventEmitter

const Code = require('code')
const co = require('co')
const Lab = require('lab')
const last = require('101/last')
const put = require('101/put')
const proxyquire = require('proxyquire')
const sinon = require('sinon')
require('sinon-as-promised')

const lab = exports.lab = Lab.script()
const describe = lab.describe
const it = lab.it
const beforeEach = lab.beforeEach
const afterEach = lab.afterEach
const expect = Code.expect

describe('ClusterManager', function () {
  let ctx

  beforeEach(function (done) {
    ctx = {}
    ctx.workersCreated = []
    ctx.cluster = {
      fork: sinon.spy(function () {
        const worker = new EventEmitter()
        sinon.spy(worker, 'on')
        sinon.spy(worker, 'once')
        sinon.spy(worker, 'removeListener')
        worker.send = sinon.stub().yieldsAsync()
        worker.process = { pid: 1 }
        ctx.workersCreated.push(worker)
        return worker
      })
    }
    ctx.os = {
      cpus: sinon.stub()
    }
    ctx.first = sinon.stub()
    ctx.ClusterManager = proxyquire('../lib/cluster-manager.js', {
      cluster: ctx.cluster,
      'first-event': ctx.first,
      os: ctx.os
    })
    done()
  })

  describe('constructor', function () {
    it('should create a clusterManager', function (done) {
      const app = {}
      const clusterManager = new ctx.ClusterManager(app)
      expect(clusterManager).to.be.an.instanceOf(ctx.ClusterManager)
      expect(clusterManager.app).to.equal(app)
      done()
    })
  })

  describe('#fork', function () {
    describe('worker online success', function () {
      beforeEach(function (done) {
        // online success
        ctx.first.onFirstCall().resolves({
          ee: ctx.workersCreated[0],
          event: 'online'
        })
        done()
      })

      describe('worker exited before connect', function () {
        beforeEach(function (done) {
          ctx.first.onSecondCall().resolves({
            event: 'exit'
          })
          done()
        })

        it('should throw an error', function (done) {
          const queueName = 'queue-name'
          const queueWorkerNum = 1

          ctx.ClusterManager.fork(queueName)
            .then(function () {
              done(new Error('expected an error'))
            }).catch(function (err) {
              sinon.assert.calledOnce(ctx.cluster.fork)
              sinon.assert.calledWith(ctx.cluster.fork, put(process.env, {
                COWORKERS_QUEUE: queueName,
                COWORKERS_QUEUE_WORKER_NUM: queueWorkerNum
              }))
              expect(err).to.exist()
              expect(err.message).to.match(/worker process exited/)
              done()
            }).catch(done)
        })
      })

      describe('worker closed (connect errored)', function () {
        beforeEach(function (done) {
          ctx.first.onSecondCall().resolves({
            event: 'coworkers:close'
          })
          sinon.stub(ctx.ClusterManager, 'killWorker').resolves()
          done()
        })

        it('should throw an error', function (done) {
          const queueName = 'queue-name'
          const queueWorkerNum = 1

          ctx.ClusterManager.fork(queueName)
            .then(function () {
              done(new Error('expected an error'))
            }).catch(function (err) {
              const worker = ctx.workersCreated[0]
              sinon.assert.calledOnce(ctx.cluster.fork)
              sinon.assert.calledWith(ctx.cluster.fork, put(process.env, {
                COWORKERS_QUEUE: queueName,
                COWORKERS_QUEUE_WORKER_NUM: queueWorkerNum
              }))
              sinon.assert.calledOnce(ctx.ClusterManager.killWorker)
              sinon.assert.calledWith(ctx.ClusterManager.killWorker, worker)
              expect(err).to.exist()
              expect(err.message).to.match(/worker connect errored/)
              done()
            }).catch(done)
        })
      })

      describe('worker connect success', function () {
        beforeEach(function (done) {
          ctx.first.onSecondCall().resolves({
            event: 'coworkers:connect'
          })
          done()
        })

        it('should fork the process successfully', function (done) {
          const queueName = 'queue-name'
          const queueWorkerNum = 1

          ctx.ClusterManager.fork(queueName)
            .then(function (worker) {
              expect(worker).to.equal(ctx.workersCreated[0])
              sinon.assert.calledOnce(ctx.cluster.fork)
              sinon.assert.calledWith(ctx.cluster.fork, put(process.env, {
                COWORKERS_QUEUE: queueName,
                COWORKERS_QUEUE_WORKER_NUM: queueWorkerNum
              }))
              expect(worker.__queueName).to.equal(queueName)
              expect(worker.__queueWorkerNum).to.equal(queueWorkerNum)
              sinon.assert.calledOnce(worker.once)
              sinon.assert.calledWith(worker.once, 'exit', ctx.ClusterManager.respawnWorker)
              done()
            }).catch(done)
        })

        describe('twice, using real events', function () {
          beforeEach(function (done) {
            ctx.ClusterManager = proxyquire('../lib/cluster-manager.js', {
              cluster: ctx.cluster,
              os: ctx.os
            })
            const fork = ctx.cluster.fork
            ctx.cluster.fork = sinon.spy(function (env) {
              const worker = fork(env)
              process.nextTick(function () {
                worker.emit('online')
                process.nextTick(function () {
                  // noise
                  worker.emit('message', {
                    foo: 'foobar'
                  })
                  // real message
                  worker.emit('message', {
                    coworkersEvent: 'coworkers:connect'
                  })
                })
              })
              return worker
            })
            done()
          })

          it('should create worker 2', function (done) {
            const queueName = 'queue-name'
            let queueWorkerNum = 1
            co(function * () {
              // once
              const worker = yield ctx.ClusterManager.fork(queueName)
              expect(worker).to.equal(ctx.workersCreated[0])
              sinon.assert.calledOnce(ctx.cluster.fork)
              sinon.assert.calledWith(ctx.cluster.fork, put(process.env, {
                COWORKERS_QUEUE: queueName,
                COWORKERS_QUEUE_WORKER_NUM: queueWorkerNum // 1
              }))
              expect(worker.__queueName).to.equal(queueName)
              expect(worker.__queueWorkerNum).to.equal(queueWorkerNum)
              // twice
              const worker2 = yield ctx.ClusterManager.fork(queueName)
              queueWorkerNum++
              expect(worker2).to.equal(ctx.workersCreated[1])
              sinon.assert.calledTwice(ctx.cluster.fork)
              sinon.assert.calledWith(ctx.cluster.fork, put(process.env, {
                COWORKERS_QUEUE: queueName,
                COWORKERS_QUEUE_WORKER_NUM: queueWorkerNum // 2
              }))
              expect(worker2.__queueName).to.equal(queueName)
              expect(worker2.__queueWorkerNum).to.equal(queueWorkerNum)
              done()
            }).catch(done)
          })
        })
      })
    })

    describe('worker online error', function () {
      beforeEach(function (done) {
        // online error
        ctx.err = new Error('boom')
        ctx.first.onFirstCall().rejects(ctx.err)
        done()
      })

      it('should fork the process successfully', function (done) {
        const queueName = 'queue-name'
        const queueWorkerNum = 1

        ctx.ClusterManager.fork(queueName)
          .then(function () {
            done(new Error('expected an error'))
          }).catch(function (err) {
            sinon.assert.calledOnce(ctx.cluster.fork)
            sinon.assert.calledWith(ctx.cluster.fork, put(process.env, {
              COWORKERS_QUEUE: queueName,
              COWORKERS_QUEUE_WORKER_NUM: queueWorkerNum
            }))
            expect(err).to.equal(ctx.err)
            done()
          }).catch(done)
      })
    })
  })

  describe('#respawnWorker', function () {
    beforeEach(function (done) {
      sinon.stub(ctx.ClusterManager, 'fork')
      ctx.queueName = 'queue-name'
      ctx.worker = {
        __queueName: ctx.queueName,
        __queueWorkerNum: 1,
        removeListener: sinon.stub(),
        once: sinon.stub()
      }
      done()
    })

    it('should re-create the worker if not killed by SIGINT', function (done) {
      ctx.ClusterManager.fork.resolves(ctx.worker)
      ctx.ClusterManager.respawnWorker.call(ctx.worker, 1)
        .then(function () {
          sinon.assert.calledOnce(ctx.ClusterManager.fork)
          sinon.assert.calledWith(ctx.ClusterManager.fork, ctx.queueName)
          done()
        }).catch(done)
    })

    it('should NOT re-create the worker if killed by SIGINT', function (done) {
      ctx.ClusterManager.fork.resolves(ctx.worker)
      ctx.ClusterManager.respawnWorker.call(ctx.worker, 1, 'SIGINT')
        .then(function () {
          sinon.assert.notCalled(ctx.ClusterManager.fork)
          done()
        }).catch(done)
    })

    describe('retries', function () {
      it('should retry to create the worker if it fails', function (done) {
        ctx.ClusterManager.fork
          .onFirstCall().rejects(new Error())
          .onSecondCall().resolves(ctx.worker)
        ctx.ClusterManager.respawnWorker.call(ctx.worker, 1)
          .then(function () {
            sinon.assert.calledTwice(ctx.ClusterManager.fork)
            done()
          }).catch(done)
      })
      describe('all fail', function () {
        beforeEach(function (done) {
          process.env.COWORKERS_RESPAWN_RETRY_ATTEMPTS = 0
          process.env.COWORKERS_RESPAWN_RETRY_MIN_TIMEOUT = 1
          process.env.COWORKERS_RESPAWN_RETRY_FACTOR = 1
          ctx.err = new Error('boom')
          ctx.ClusterManager.fork.rejects(ctx.err)
          done()
        })
        afterEach(function (done) {
          delete process.env.COWORKERS_RESPAWN_RETRY_ATTEMPTS
          delete process.env.COWORKERS_RESPAWN_RETRY_MIN_TIMEOUT
          delete process.env.COWORKERS_RESPAWN_RETRY_FACTOR
          process.nextTick.restore && process.nextTick.restore()
          done()
        })

        it('should error if all retries fail', function (done) {
          sinon.stub(process, 'nextTick')
          ctx.ClusterManager.respawnWorker.call(ctx.worker, 1)
            .then(function () {
              const throwFn = last(process.nextTick.args)[0]
              process.nextTick.restore()
              expect(throwFn).to.throw(ctx.err.message)
              done()
            }).catch(done)
        })
      })
    })
  })

  describe('#killWorker', function () {
    beforeEach(function (done) {
      sinon.stub(ctx.ClusterManager, 'fork')
      ctx.queueName = 'queue-name'
      ctx.worker = {
        __queueName: ctx.queueName,
        __queueWorkerNum: 1,
        removeListener: sinon.stub(),
        kill: sinon.stub(),
        process: {}
      }
      done()
    })

    describe('already killed', function () {
      beforeEach(function (done) {
        ctx.worker.process.killed = true
        done()
      })

      it('should just return', function (done) {
        ctx.ClusterManager.killWorker(ctx.worker)
          .then(function () {
            sinon.assert.notCalled(ctx.worker.kill)
            done()
          }).catch(done)
      })
    })

    describe('success', function () {
      beforeEach(function (done) {
        // stop success
        ctx.first.resolves()
        done()
      })

      it('should stop the worker', function (done) {
        ctx.ClusterManager.killWorker(ctx.worker)
          .then(function () {
            sinon.assert.calledOnce(ctx.worker.kill)
            sinon.assert.calledWith(ctx.worker.kill, 'SIGINT')
            done()
          }).catch(done)
      })
    })

    describe('errors', function () {
      describe('one failure', function () {
        beforeEach(function (done) {
          ctx.err = new Error('boom')
          ctx.first
            .onFirstCall().rejects(ctx.err)
            .onSecondCall().resolves()
          done()
        })

        it('should retry and succeed', function (done) {
          ctx.ClusterManager.killWorker(ctx.worker)
            .then(function () {
              sinon.assert.calledTwice(ctx.worker.kill)
              sinon.assert.calledWith(ctx.worker.kill, 'SIGINT')
              done()
            }).catch(done)
        })
      })

      describe('max retries', function () {
        beforeEach(function (done) {
          process.env.COWORKERS_KILL_RETRY_ATTEMPTS = 0
          process.env.COWORKERS_KILL_RETRY_MIN_TIMEOUT = 1
          process.env.COWORKERS_KILL_RETRY_FACTOR = 1
          ctx.err = new Error('boom')
          ctx.first.rejects(ctx.err)
          done()
        })
        afterEach(function (done) {
          delete process.env.COWORKERS_KILL_RETRY_ATTEMPTS
          delete process.env.COWORKERS_KILL_RETRY_MIN_TIMEOUT
          delete process.env.COWORKERS_KILL_RETRY_FACTOR
          done()
        })

        it('should error if all retries fail', function (done) {
          ctx.ClusterManager.killWorker(ctx.worker)
            .then(function () {
              done(new Error('expected an error'))
            }).catch(function (err) {
              expect(err).to.equal(ctx.err)
              sinon.assert.calledOnce(ctx.worker.kill)
              sinon.assert.calledWith(ctx.worker.kill, 'SIGINT')
              done()
            }).catch(done)
        })
      })
    })
  })

  describe('instance methods', function () {
    beforeEach(function (done) {
      ctx.queueName = 'queue-name'
      ctx.app = {
        queueNames: [ctx.queueName]
      }
      ctx.clusterManager = new ctx.ClusterManager(ctx.app)
      done()
    })

    describe('start', function () {
      describe('starting', function () {
        beforeEach(function (done) {
          ctx.clusterManager.startingPromise = new Promise(function () {})
          done()
        })

        it('should return same starting promise', function (done) {
          const promise = ctx.clusterManager.start()
          expect(promise).to.equal(ctx.clusterManager.startingPromise)
          done()
        })
      })

      describe('not completely stopped', function () {
        beforeEach(function (done) {
          ctx.cluster.workers = [ { /* worker1 */} ]
          sinon.stub(ctx.clusterManager, 'stop')
          done()
        })

        it('should error if stop errors', function (done) {
          // stop error
          ctx.err = new Error('boom')
          ctx.clusterManager.stop.rejects(ctx.err)
          // invoke start
          const promise = ctx.clusterManager.start()
          expect(promise).to.equal(ctx.clusterManager.startingPromise)
          promise.then(function () {
            done(new Error('expected an error'))
          }).catch(function (err) {
            expect(err).to.be.an.instanceOf(Error)
            expect(err.message).to.match(/Start cancelled/)
            expect(err.stopErr).to.equal(ctx.err)
            expect(ctx.clusterManager.startingPromise).to.not.exist()
            done()
          })
        })

        it('should start if stop is successful', function (done) {
          // stop success
          ctx.clusterManager.stop.resolves()
          // invoke start
          const promise = ctx.clusterManager.start()
          sinon.stub(ctx.clusterManager, 'start')
          expect(promise).to.equal(ctx.clusterManager.startingPromise)
          promise.then(function () {
            expect(ctx.clusterManager.startingPromise).to.not.exist()
            sinon.assert.calledOnce(ctx.clusterManager.start)
            done()
          }).catch(done)
        })
      })

      describe('stopped', function () {
        describe('COWORKERS_WORKERS_PER_QUEUE exists', function () {
          beforeEach(function (done) {
            ctx.os.cpus.returns([{ /* cpu1 */}, { /* cpu2 */}])
            process.env.COWORKERS_WORKERS_PER_QUEUE = 1
            sinon.stub(ctx.ClusterManager, 'fork').resolves()
            done()
          })
          afterEach(function (done) {
            delete process.env.COWORKERS_WORKERS_PER_QUEUE
            done()
          })

          it('should fork 1 consumer for "queue-name"', function (done) {
            ctx.clusterManager.start().then(function () {
              sinon.assert.calledOnce(ctx.ClusterManager.fork)
              sinon.assert.calledWith(ctx.ClusterManager.fork, ctx.queueName)
              done()
            }).catch(done)
          })
        })

        describe('numCPUs > numQueues', function () {
          beforeEach(function (done) {
            ctx.os.cpus.returns([{ /* cpu1 */}, { /* cpu2 */}])
            sinon.stub(ctx.ClusterManager, 'fork').resolves()
            done()
          })

          it('should fork 2 consumers for "queue-name"', function (done) {
            ctx.clusterManager.start().then(function () {
              sinon.assert.calledTwice(ctx.ClusterManager.fork)
              sinon.assert.calledWith(ctx.ClusterManager.fork, ctx.queueName)
              done()
            }).catch(done)
          })
        })

        describe('numCPUs <= numQueues', function () {
          beforeEach(function (done) {
            ctx.os.cpus.returns([{ /* cpu1 */}])
            sinon.stub(ctx.ClusterManager, 'fork').resolves()
            done()
          })

          it('should fork 1 consumer for "queue-name"', function (done) {
            ctx.clusterManager.start().then(function () {
              sinon.assert.calledOnce(ctx.ClusterManager.fork)
              sinon.assert.calledWith(ctx.ClusterManager.fork, ctx.queueName)
              done()
            }).catch(done)
          })
        })

        describe('fork error', function () {
          beforeEach(function (done) {
            ctx.os.cpus.returns([{ /* cpu1 */}])
            ctx.err = new Error('boom')
            sinon.stub(ctx.ClusterManager, 'fork').rejects(ctx.err)
            done()
          })

          it('should throw the error', function (done) {
            ctx.clusterManager.start().then(function () {
              throw new Error('expected an error')
            }).catch(function (err) {
              sinon.assert.calledOnce(ctx.ClusterManager.fork)
              expect(err.message).to.match(/Some worker forks failed/)
              expect(err.errors).to.deep.equal([ctx.err])
              expect(ctx.ClusterManager.startingPromise).to.not.exist()
              done()
            }).catch(done)
          })
        })
      })
    })

    describe('stop', function () {
      describe('success', function () {
        beforeEach(function (done) {
          ctx.worker = {}
          ctx.cluster.workers = [ ctx.worker ]
          sinon.stub(ctx.ClusterManager, 'killWorker').resolves()
          done()
        })

        it('should iterate through all workers and stop them', function (done) {
          ctx.clusterManager.stop().then(function () {
            sinon.assert.calledOnce(ctx.ClusterManager.killWorker)
            sinon.assert.calledWith(ctx.ClusterManager.killWorker, ctx.worker)
            done()
          }).catch(done)
        })
      })

      describe('error', function () {
        beforeEach(function (done) {
          ctx.worker = {}
          ctx.cluster.workers = [ ctx.worker ]
          ctx.err = new Error('baboom')
          sinon.stub(ctx.ClusterManager, 'killWorker').rejects(ctx.err)
          done()
        })

        it('should iterate through all workers and stop them', function (done) {
          ctx.clusterManager.stop().then(function () {
            done(new Error('expected an error'))
          }).catch(function (err) {
            sinon.assert.calledOnce(ctx.ClusterManager.killWorker)
            sinon.assert.calledWith(ctx.ClusterManager.killWorker, ctx.worker)
            expect(err.message).to.match(/Some worker kills failed/)
            expect(err.errors).to.deep.equal([ctx.err])
            done()
          }).catch(done)
        })
      })
    })
  })
})
