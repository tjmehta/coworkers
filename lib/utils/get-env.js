'use strict'

const assert = require('assert')
const exists = require('101/exists')
const isString = require('101/is-string')

module.exports = getEnv

function getEnv () {
  let COWORKERS_CLUSTER = process.env.COWORKERS_CLUSTER
  const COWORKERS_QUEUE = process.env.COWORKERS_QUEUE
  // ensure COWORKERS_CLUSTER is a boolean string
  if (exists(COWORKERS_CLUSTER)) {
    assert(/^true|false$/.test(COWORKERS_CLUSTER),
      '"COWORKERS_CLUSTER" must be a boolean string ("true" or "false")')
    // cast string to boolean
    COWORKERS_CLUSTER = COWORKERS_CLUSTER === 'true'
  }
  // ensure COWORKERS_QUEUE is a string
  if (exists(COWORKERS_QUEUE)) {
    assert(isString(COWORKERS_QUEUE),
      '"COWORKERS_QUEUE" must be a string')
  }

  return {
    COWORKERS_CLUSTER,
    COWORKERS_QUEUE
  }
}
