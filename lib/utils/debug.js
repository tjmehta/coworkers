'use strict'

const path = require('path')

const debug = require('debug')
const stack = require('callsite')

module.exports = createDebug

function createDebug () {
  const filepath = stack()[1].getFileName()
  const libpath = '../'
  let namespace = 'coworkers:' +
    path.relative(libpath, filepath)
      .replace(/\//g, ':')
      .replace(/.js$/, '')

  return debug(namespace)
}
