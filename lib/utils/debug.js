'use strict'

const path = require('path')

const debug = require('debug')
const exists = require('101/exists')
const stack = require('callsite')

const debugMap = {}

module.exports = createDebug

function createDebug () {
  const filepath = stack()[1].getFileName()
  const libpath = filepath + '/../'
  let namespace = 'coworkers:' +
    path.relative(libpath, filepath)
      .replace(/\//g, ':')
      .replace(/.js$/, '')
  const consumerName = process.env.COWORKERS_QUEUE || 'master'
  let queueWorkerNum = process.env.COWORKERS_QUEUE_WORKER_NUM
  queueWorkerNum = exists(queueWorkerNum)
    ? ':' + queueWorkerNum
    : ''

  namespace += ':' + consumerName + queueWorkerNum

  debugMap[namespace] = debugMap[namespace] || debug(namespace)

  return debugMap[namespace]
}
