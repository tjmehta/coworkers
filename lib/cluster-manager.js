'use strict'

const cluster = require('cluster')
const os = require('os')

const co = require('co')
const exists = require('101/exists')
const put = require('101/put')
const first = require('first-event')
const times = require('times-loop')
const values = require('object-values')
const retry = require('promise-retry')

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
      debug(`worker create "${queueName}:${queueWorkerNum}"`)
      const env = put(process.env, {
        COWORKERS_QUEUE: queueName,
        COWORKERS_QUEUE_WORKER_NUM: queueWorkerNum
      })
      const worker = cluster.fork(env)
      // handle worker messages
      worker.on('message', ClusterManager.messageHandler)
      // set custom properties
      worker.__queueName = queueName
      worker.__queueWorkerNum = queueWorkerNum
      // worker created
      debug(`worker created pid=${worker.process.pid} "${queueName}:${queueWorkerNum}"`)
      // wait for successful connection to rabbit, or error
      //   note: waiting for connect will call close if it fails.
      //     if close fails process will exit -> coworkers:close:error
      const events = yield [
        first(worker, [ 'error', 'online' ]).then(function () {
          debug(`worker online "${queueName}:${queueWorkerNum}"`)
        }),
        first(worker, [ 'exit', 'coworkers:close', 'coworkers:close:error', 'coworkers:connect' ])
      ]
      const onlineEvent = events[1]
      const event = onlineEvent.event
      // check if worker exited before connecting (to rabbitmq)
      if (event === 'exit') {
        debug(`worker process exited before connect "${queueName}:${queueWorkerNum}"`)
        throw new Error(`worker process exited before connect "${queueName}:${queueWorkerNum}"`)
      }
      // check if worker failed to connect (connection closed instead of connected)
      if (event.indexOf('coworkers:close') === 0) {
        debug(`worker connect errored "${queueName}:${queueWorkerNum}"`)
        debug(`worker connect errored -> kill worker "${queueName}:${queueWorkerNum}"`)
        // kill the disconnected worker and throw the error
        yield ClusterManager.killWorker(worker)
        throw new Error(`worker connect errored "${queueName}:${queueWorkerNum}"`)
      }
      // worker successfully connected to rabbitmq
      debug(`worker connect success "${queueName}:${queueWorkerNum}"`)
      // respawn worker if it exists
      worker.once('exit', ClusterManager.respawnWorker)
      return worker
    }).catch(function (err) {
      // log err and rethrow
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
    const COWORKERS_RESPAWN_RETRY_ATTEMPTS = process.env.COWORKERS_RESPAWN_RETRY_ATTEMPTS
    const COWORKERS_RESPAWN_RETRY_MIN_TIMEOUT = process.env.COWORKERS_RESPAWN_RETRY_MIN_TIMEOUT
    const COWORKERS_RESPAWN_RETRY_FACTOR = process.env.COWORKERS_RESPAWN_RETRY_FACTOR
    const opts = {
      retries: exists(COWORKERS_RESPAWN_RETRY_ATTEMPTS) ? COWORKERS_RESPAWN_RETRY_ATTEMPTS : 20,
      minTimeout: exists(COWORKERS_RESPAWN_RETRY_MIN_TIMEOUT) ? COWORKERS_RESPAWN_RETRY_MIN_TIMEOUT : 10,
      factor: exists(COWORKERS_RESPAWN_RETRY_FACTOR) ? COWORKERS_RESPAWN_RETRY_FACTOR : 1
    }
    debug(`worker exited with code=${code} signal=${signal} "${queueName}:${queueWorkerNum}"`)
    return retry(opts, function (retry, attempt) {
      return co(function * () {
        // if signal is SIGINT, do not respawn
        if (signal === 'SIGINT') {
          debug(`no respawn. process exited w/ SIGINT "${queueName}:${queueWorkerNum}"`)
          return
        }
        // respawn worker
        const attemptMsg = attempt > 1 ? ` attempt=${attempt}` : ''
        debug(`respawn worker${attemptMsg} "${queueName}:${queueWorkerNum}"`)
        yield ClusterManager.fork(queueName)
      }).catch(function (err) {
        debug(`respawn failed for "${queueName}:${queueWorkerNum}"`, err)
        retry(err)
      })
    }).catch(function (err) {
      debug(`all ${opts.retries} respawn worker attempts failed "${queueName}:${queueWorkerNum}"`, err)
      process.nextTick(function () {
        throw err
      })
    })
  }
  /**
   * stop a worker
   * @param  {Worker} worker cluster worker to stop
   * @return {Promise} stop promise
   */
  static killWorker (worker) {
    const queueName = worker.__queueName
    const queueWorkerNum = worker.__queueWorkerNum
    const COWORKERS_KILL_RETRY_ATTEMPTS = process.env.COWORKERS_KILL_RETRY_ATTEMPTS
    const COWORKERS_KILL_RETRY_MIN_TIMEOUT = process.env.COWORKERS_KILL_RETRY_MIN_TIMEOUT
    const COWORKERS_KILL_RETRY_FACTOR = process.env.COWORKERS_KILL_RETRY_FACTOR
    const opts = {
      retries: exists(COWORKERS_KILL_RETRY_ATTEMPTS) ? COWORKERS_KILL_RETRY_ATTEMPTS : 20,
      minTimeout: exists(COWORKERS_KILL_RETRY_MIN_TIMEOUT) ? COWORKERS_KILL_RETRY_MIN_TIMEOUT : 10,
      factor: exists(COWORKERS_KILL_RETRY_FACTOR) ? COWORKERS_KILL_RETRY_FACTOR : 1
    }

    return retry(opts, function (retry, attempt) {
      return co(function * () {
        const attemptMsg = attempt > 1 ? ` attempt=${attempt}` : ''
        debug(`kill worker${attemptMsg} "${queueName}:${queueWorkerNum}"`)
        // check if worker is already killed
        if (worker.process.killed) {
          debug(`worker already killed "${queueName}:${queueWorkerNum}"`)
          return
        }
        // kill worker
        worker.kill('SIGINT') // handled in application.js
        // wait until worker is exits
        yield first(worker, [ 'error', 'exit' ])
      }).then(function () {
        debug(`worker exit success "${queueName}:${queueWorkerNum}"`)
      }).catch(function (err) {
        debug(`worker exit errorer "${queueName}:${queueWorkerNum}"`, err)
        retry(err)
      })
    }).catch(function (err) {
      debug(`all ${opts.retries} kill worker attempts failed "${queueName}:${queueWorkerNum}"`, err)
      throw err
    })
  }
  /**
   * handler messages and look for coworker events
   * if a coworker event message is recieved emit the event on the worker
   * @param {Object} message object
   */
  static messageHandler (msg) {
    const queueName = this.__queueName
    const queueWorkerNum = this.__queueWorkerNum
    debug(`worker got a message "${queueName}:${queueWorkerNum}"`)
    if (msg.coworkersEvent) {
      debug(`worker got a coworkers message ${msg.coworkersEvent} "${queueName}:${queueWorkerNum}"`)
      this.emit(msg.coworkersEvent)
    }
  }
  /**
   * start cluster manager and create worker processes
   * @return {Promise} start promise
   */
  start () {
    debug(`master pid=${process.pid}`)
    debug('master start')
    const self = this

    if (this.startingPromise) {
      return this.startingPromise
    }

    if (cluster.workers.length) {
      debug('workers exist, stop them before start')
      // not completely stopped, cleanup first
      this.startingPromise = self.stop()
        .catch(function (err) {
          debug('cluster-manager stop (before start) errored', err)
          const startErr = new Error('Start cancelled because pending stop failed (.stopErr)')
          startErr.stopErr = err
          // delete connecting promise, connect cancelled
          delete self.startingPromise
          throw startErr
        })
        .then(function () {
          debug('cluster-manager stop (before start) success')
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
      // wait for all forks to complete even if an error occurs
      const forkErrs = []
      debug('queueNames %o', queueNames)
      yield queueNames.map(function (queueName) {
        return ClusterManager.fork(queueName).catch(function (err) {
          forkErrs.push(err)
        })
      })
      // check if any worker forks failed
      if (forkErrs.length) {
        const err = new Error('Some worker forks failed (.errors)')
        err.errors = forkErrs
        throw err
      }
    }).then(function () {
      delete self.startingPromise
      debug('cluster-manager start success')
    }).catch(function (err) {
      delete self.startingPromise
      debug('cluster-manager start errored', err)
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
      // wait for all kills to complete even if an error occurs
      const killErrs = []
      yield values(cluster.workers).map(function (worker) {
        return ClusterManager.killWorker(worker).catch(function (err) {
          killErrs.push(err)
        })
      })
      // check if any worker kills failed
      if (killErrs.length) {
        const err = new Error('Some worker kills failed (.errors)')
        err.errors = killErrs
        throw err
      }
      debug('cluster-manager stop success')
    }).catch(function (err) {
      debug('cluster-manager stop errored', err)
      throw err
    })
  }
}
