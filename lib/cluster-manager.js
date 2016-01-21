'use strict'

const cluster = require('cluster')
const os = require('os')

const co = require('co')
const exists = require('101/exists')
const first = require('ee-first')
const times = require('times-loop')

const debug = require('./utils/debug.js')()
const getEnv = require('./utils/get-env.js')

class QueueWorkerCounter {
  constructor () {
    this.reset()
  }
  inc (queueName) {
    const countsByQueue = this.countsByQueue

    countsByQueue[queueName] = countsByQueue[queueName] || 0
    countsByQueue[queueName]++

    return countsByQueue[queueName]
  }
  reset () {
    this.countsByQueue = {}
  }
}
// Singleton queue worker counter helper
const queueWorkerCounter = new QueueWorkerCounter()

// Cluster Manager Class

module.exports = class ClusterManager {
  constructor (app) {
    this.app = app
  }
  /**
   * fork process and create a worker
   * @param  {String} queueName name of queue which worker will consume
   * @param  {Number} queueWorkerNum
   * @return {Promise} worker promise
   */
  static fork (queueName) {
    const queueWorkerNum = queueWorkerCounter.inc(queueName)

    return co(function * () {
      // fork process
      debug(`fork process "${queueName}:${queueWorkerNum}"`)
      const worker = cluster.fork({
        COWORKERS_QUEUE: queueName,
        COWORKERS_QUEUE_WORKER_NUM: queueWorkerNum
      })
      // set custom properties
      worker.__queueName = queueName
      worker.__queueWorkerNum = queueWorkerNum
      // attach exit/error handlers
      worker.once('exit', ClusterManager.respawnWorker)
      // wait until worker is online or errors
      yield first.bind(null, [ [worker, 'error', 'online'] ])
      debug(`worker created pid=${worker.process.pid} "${queueName}:${queueWorkerNum}"`)
    }).catch(function (err) {
      debug(`worker create error "${queueName}:${queueWorkerNum}"`, err)
      throw err
    })
  }
  /**
   * worker exit handler
   * @param  {Number} code   exit code of worker process
   * @param  {String} signal signal that caused worker process exit
   */
  static respawnWorker (code, signal) {
    const worker = this
    const queueName = worker.__queueName
    const queueWorkerNum = worker.__queueWorkerNum

    debug(`worker exited with code=${code} signal=${signal} "${queueName}:${queueWorkerNum}"`)

    if (signal === 'SIGINT') {
      // donot respawn worker if killed w/ SIGINT
      worker.removeListener('exit', ClusterManager.respawnWorker)
    } else {
      // respawn worker
      debug(`spawn replacement for "${queueName}:${queueWorkerNum}"`)
      ClusterManager.fork(queueName)
    }
  }
  /**
   * stop a worker
   * @param  {Worker} worker cluster worker to stop
   * @return {Promise} stop promise
   */
  static stopWorker (worker) {
    const queueName = worker.__queueName
    const queueWorkerNum = worker.__queueWorkerNum

    return co(function * () {
      // exit worker
      worker.kill('SIGINT') // handled in application.js
      // wait until worker is exits
      yield first.bind(null, [ worker, 'error', 'exit' ])
      debug(`worker exited "${queueName}:${queueWorkerNum}"`)
    }).catch(function (err) {
      debug(`worker exit error "${queueName}:${queueWorkerNum}"`, err)
      throw err
    })
  }
  /**
   * start cluster manager and create worker processes
   * @return {Promise} start promise
   */
  start () {
    debug(`master pid=${process.pid}`)
    debug('master start')
    const self = this

    if (cluster.workers.length) {
      // not completely stopped, cleanup first
      this.startingPromise = self.stop()
        .catch(function (err) {
          const startErr = new Error('Start cancelled because pending stop failed (stopErr)')
          startErr.stopErr = err
          // delete connecting promise, connect cancelled
          delete self.startingPromise
          throw startErr
        })
        .then(function () {
          delete self.startingPromise
          return self.start()
        })

      return self.startingPromise
    }

    this.startingPromise = co(function * () {
      const COWORKERS_WORKERS_PER_QUEUE = getEnv().COWORKERS_WORKERS_PER_QUEUE
      const numQueues = self.app.queueNames.length
      const numCpus = os.cpus().length
      let queueNames

      debug('num cpus %s', numCpus)
      debug('num queues %s', numQueues)
      debug('queue names %o', self.app.queueNames)

      if (exists(COWORKERS_WORKERS_PER_QUEUE) || numCpus > numQueues) {
        // The number of cpus is greater than the number of consumers (processes).
        // To optimize cpu-usage, the number of processes should be greater.
        // Create "n" clones of each consumer, so that n * queues >= cpus.
        let workersPerQueue = exists(COWORKERS_WORKERS_PER_QUEUE)
          ? COWORKERS_WORKERS_PER_QUEUE
          : Math.ceil(numCpus / numQueues)
        debug('workers / queue %s', workersPerQueue)

        queueNames = []
        times(workersPerQueue, function () {
          queueNames = queueNames.concat(self.app.queueNames)
        })
      } else {
        debug('workers / queue %s', 1)
        // numCpus < numQueues, so create one consumer per queue
        queueNames = self.app.queueNames
      }

      yield queueNames.map((queueName) => ClusterManager.fork(queueName))
    }).then(function () {
      delete self.startingPromise
      debug('master: start success')
    }).catch(function (err) {
      delete self.startingPromise
      debug('master: start errored', err)
      throw err
    })

    return this.startingPromise
  }
  /**
   * stop cluster manager, exit all worker processes, and allow master process to stop
   * @param  {String} signal signal to cause
   * @return {Promise} stop promise
   */
  stop (signal) {
    debug('master stop')
    return co(function * () {
      yield cluster.workers.map((worker) => ClusterManager.stopWorker(worker))
      debug('master: stop success')
    }).catch(function (err) {
      debug('master: stop errored', err)
      throw err
    })
  }
}
