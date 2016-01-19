'use strict'

const EventEmitter = require('events').EventEmitter

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

describe('ClusterManager', function () {
  let ctx

  beforeEach(function (done) {
    ctx = {}
    ctx.workersCreated = []
    ctx.cluster = {
      fork: sinon.spy(function () {
        const worker = new EventEmitter()
        sinon.spy(worker, 'once')
        sinon.spy(worker, 'removeListener')
        worker.send = sinon.stub().yieldsAsync()
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
      'ee-first': ctx.first,
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
    describe('worker success', function () {
      beforeEach(function (done) {
        // online success
        ctx.first.yieldsAsync()
        done()
      })

      it('should fork the process', function (done) {
        const queueName = 'queue-name'
        const queueWorkerNum = 1
        const promise = ctx.ClusterManager.fork(queueName)
        expect(promise).to.be.an.instanceOf(Promise)
        promise.then(function () {
          sinon.assert.calledOnce(ctx.cluster.fork)
          sinon.assert.calledWith(ctx.cluster.fork, {
            COWORKERS_QUEUE: queueName,
            COWORKERS_QUEUE_WORKER_NUM: queueWorkerNum
          })
          // assert worker properties and event handlers attached
          const worker = ctx.workersCreated[0]
          expect(worker.__queueName).to.equal(queueName)
          expect(worker.__queueWorkerNum).to.equal(queueWorkerNum)
          sinon.assert.calledOnce(worker.once)
          sinon.assert.calledWith(
            worker.once, 'exit', ctx.ClusterManager.respawnWorker)
          sinon.assert.calledOnce(ctx.first)
          sinon.assert.calledWith(
            ctx.first, [[worker, 'error', 'online']])
          done()
        }).catch(done)
      })

      describe('twice', function () {
        it('should create worker 2', function (done) {
          const queueName = 'queue-name'
          const promise = ctx.ClusterManager.fork(queueName)
          expect(promise).to.be.an.instanceOf(Promise)
          promise.then(function () {
            const promise2 = ctx.ClusterManager.fork(queueName)
            expect(promise2).to.be.an.instanceOf(Promise)
            return promise2.then(function () {
              const queueWorkerNum = 2
              sinon.assert.calledTwice(ctx.cluster.fork)
              sinon.assert.calledWith(ctx.cluster.fork, {
                COWORKERS_QUEUE: queueName,
                COWORKERS_QUEUE_WORKER_NUM: queueWorkerNum
              })
              // assert worker properties and event handlers attached
              const worker = ctx.workersCreated[1]
              expect(worker.__queueName).to.equal(queueName)
              expect(worker.__queueWorkerNum).to.equal(queueWorkerNum)
              sinon.assert.calledOnce(worker.once)
              sinon.assert.calledWith(
                worker.once, 'exit', ctx.ClusterManager.respawnWorker)
              sinon.assert.calledTwice(ctx.first)
              sinon.assert.calledWith(
                ctx.first, [[worker, 'error', 'online']])
              done()
            })
          }).catch(done)
        })
      })
    })

    describe('worker error', function () {
      beforeEach(function (done) {
        // online error
        ctx.err = new Error('boom')
        ctx.first.yieldsAsync(ctx.err)
        done()
      })

      it('should fork the process', function (done) {
        const queueName = 'queue-name'
        const queueWorkerNum = 1
        const promise = ctx.ClusterManager.fork(queueName)
        expect(promise).to.be.an.instanceOf(Promise)
        promise.then(function () {
          done(new Error('expected an error'))
        }).catch(function (err) {
          expect(err).to.equal(ctx.err)
          sinon.assert.calledOnce(ctx.cluster.fork)
          sinon.assert.calledWith(ctx.cluster.fork, {
            COWORKERS_QUEUE: queueName,
            COWORKERS_QUEUE_WORKER_NUM: queueWorkerNum
          })
          // assert worker properties and event handlers attached
          const worker = ctx.workersCreated[0]
          expect(worker.__queueName).to.equal(queueName)
          expect(worker.__queueWorkerNum).to.equal(queueWorkerNum)
          sinon.assert.calledOnce(worker.once)
          sinon.assert.calledWith(
            worker.once, 'exit', ctx.ClusterManager.respawnWorker)
          sinon.assert.calledOnce(ctx.first)
          sinon.assert.calledWith(
            ctx.first, [[worker, 'error', 'online']])
          done()
        })
      })
    })
  })

  describe('#respawnWorker', function () {
    beforeEach(function (done) {
      sinon.stub(ctx.ClusterManager, 'fork')
      ctx.queueName = 'queue-name'
      ctx.worker = {
        __queueName: ctx.queueName,
        __queueWorkerNum: 1
      }
      done()
    })

    it('should re-create the worker', function (done) {
      ctx.ClusterManager.respawnWorker.call(ctx.worker, 1, 'SIGINT')
      sinon.assert.calledOnce(ctx.ClusterManager.fork)
      sinon.assert.calledWith(ctx.ClusterManager.fork, ctx.queueName)
      done()
    })
  })

  describe('#stopWorker', function () {
    beforeEach(function (done) {
      sinon.stub(ctx.ClusterManager, 'fork')
      ctx.queueName = 'queue-name'
      ctx.worker = {
        __queueName: ctx.queueName,
        __queueWorkerNum: 1,
        removeListener: sinon.stub(),
        send: sinon.stub()
      }
      done()
    })

    describe('success', function () {
      beforeEach(function (done) {
        // stop success
        ctx.first.yieldsAsync()
        done()
      })

      it('should stop the worker', function (done) {
        const promise = ctx.ClusterManager.stopWorker(ctx.worker)
        expect(promise).to.be.an.instanceOf(Promise)
        promise.then(function () {
          sinon.assert.calledOnce(ctx.worker.removeListener)
          sinon.assert.calledWith(
            ctx.worker.removeListener, 'exit', ctx.ClusterManager.respawnWorker)
          sinon.assert.calledOnce(ctx.worker.send)
          sinon.assert.calledWith(ctx.worker.send, 'shutdown')
          done()
        }).catch(done)
      })
    })

    describe('error', function () {
      beforeEach(function (done) {
        // stop error
        ctx.err = new Error('boom')
        ctx.first.yieldsAsync(ctx.err)
        done()
      })

      it('should throw the stop error', function (done) {
        const promise = ctx.ClusterManager.stopWorker(ctx.worker)
        expect(promise).to.be.an.instanceOf(Promise)
        promise.then(function () {
          done(new Error('expected an error'))
        }).catch(function (err) {
          expect(err).to.equal(ctx.err)
          sinon.assert.calledOnce(ctx.worker.removeListener)
          sinon.assert.calledWith(
            ctx.worker.removeListener, 'exit', ctx.ClusterManager.respawnWorker)
          sinon.assert.calledOnce(ctx.worker.send)
          sinon.assert.calledWith(ctx.worker.send, 'shutdown')
          done()
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
        describe('numCPUs > numQueues', function () {
          beforeEach(function (done) {
            ctx.os.cpus.returns([{ /* cpu1 */}, { /* cpu2 */}])
            sinon.stub(ctx.ClusterManager, 'fork')
            done()
          })

          it('should fork 2 consumers for "queue-name"', function (done) {
            ctx.clusterManager.start().then(function () {
              sinon.assert.calledTwice(ctx.ClusterManager.fork)
              sinon.assert.calledWith(ctx.ClusterManager.fork, ctx.queueName)
              sinon.assert.calledWith(ctx.ClusterManager.fork, ctx.queueName)
              done()
            }).catch(done)
          })
        })

        describe('numCPUs <= numQueues', function () {
          beforeEach(function (done) {
            ctx.os.cpus.returns([{ /* cpu1 */}])
            sinon.stub(ctx.ClusterManager, 'fork')
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
              expect(err).to.equal(ctx.err)
              expect(ctx.clusterManager.starting).to.not.exist()
              done()
            })
          })
        })
      })
    })

    describe('stop', function () {
      describe('success', function () {
        beforeEach(function (done) {
          ctx.worker = {}
          ctx.cluster.workers = [ ctx.worker ]
          sinon.stub(ctx.ClusterManager, 'stopWorker').resolves()
          done()
        })

        it('should iterate through all workers and stop them', function (done) {
          ctx.clusterManager.stop().then(function () {
            sinon.assert.calledOnce(ctx.ClusterManager.stopWorker)
            sinon.assert.calledWith(ctx.ClusterManager.stopWorker, ctx.worker)
            done()
          }).catch(done)
        })
      })
      describe('error', function () {
        beforeEach(function (done) {
          ctx.worker = {}
          ctx.cluster.workers = [ ctx.worker ]
          ctx.err = new Error('baboom')
          sinon.stub(ctx.ClusterManager, 'stopWorker').rejects(ctx.err)
          done()
        })

        it('should iterate through all workers and stop them', function (done) {
          ctx.clusterManager.stop().then(function () {
            done(new Error('expected an error'))
          }).catch(function (err) {
            sinon.assert.calledOnce(ctx.ClusterManager.stopWorker)
            sinon.assert.calledWith(ctx.ClusterManager.stopWorker, ctx.worker)
            expect(err).to.equal(ctx.err)
            done()
          })
        })
      })
    })
  })
})
