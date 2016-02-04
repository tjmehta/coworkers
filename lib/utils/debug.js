'use strict'

const path = require('path')

const debug = require('debug')
const exists = require('101/exists')

const debugMap = {}

module.exports = createDebug

function createDebug () {
  const filepath = new Error().stack.replace(/^[^\n]+\n[^\n]+\n[^(]+[(]([^):]+)[^\n]+/, '$1').split('\n').shift()
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
