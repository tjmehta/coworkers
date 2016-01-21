'use strict'

const assert = require('assert')
const exists = require('101/exists')
const isNumber = require('101/is-number')
const isString = require('101/is-string')

module.exports = getEnv

function getEnv () {
  let COWORKERS_CLUSTER = process.env.COWORKERS_CLUSTER
  let COWORKERS_QUEUE = process.env.COWORKERS_QUEUE
  let COWORKERS_QUEUE_WORKER_NUM = process.env.COWORKERS_QUEUE_WORKER_NUM
  let COWORKERS_RABBITMQ_URL = process.env.COWORKERS_RABBITMQ_URL
  let COWORKERS_WORKERS_PER_QUEUE = process.env.COWORKERS_WORKERS_PER_QUEUE

  // assert COWORKERS_CLUSTER is a boolean string
  if (exists(COWORKERS_CLUSTER)) {
    assert(/^true|false$/.test(COWORKERS_CLUSTER),
      '"COWORKERS_CLUSTER" must be a boolean string ("true" or "false")')
    // cast string to boolean
    COWORKERS_CLUSTER = COWORKERS_CLUSTER === 'true'
  }
  // assert COWORKERS_QUEUE is a string
  if (exists(COWORKERS_QUEUE)) {
    assert(isString(COWORKERS_QUEUE),
      '"COWORKERS_QUEUE" must be a string')
  }
  // assert COWORKERS_QUEUE_WORKER_NUM is a number
  if (exists(COWORKERS_QUEUE_WORKER_NUM)) {
    COWORKERS_QUEUE_WORKER_NUM = parseInt(COWORKERS_QUEUE_WORKER_NUM, 10)
    assert(isNumber(COWORKERS_QUEUE_WORKER_NUM),
      '"COWORKERS_QUEUE_WORKER_NUM" must be an integer')
  }// assert COWORKERS_WORKERS_PER_QUEUE is a number
  if (exists(COWORKERS_WORKERS_PER_QUEUE)) {
    COWORKERS_WORKERS_PER_QUEUE = parseInt(COWORKERS_WORKERS_PER_QUEUE, 10)
    assert(isNumber(COWORKERS_WORKERS_PER_QUEUE),
      '"COWORKERS_WORKERS_PER_QUEUE" must be an integer')
  }
  // amqplib will validate COWORKERS_RABBITMQ_URL

  return {
    COWORKERS_CLUSTER,
    COWORKERS_QUEUE,
    COWORKERS_QUEUE_WORKER_NUM,
    COWORKERS_RABBITMQ_URL,
    COWORKERS_WORKERS_PER_QUEUE
  }
}
