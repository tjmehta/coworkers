'use strict'

const nodeify = require('nodeify')

module.exports = callbackOrPromise

function callbackOrPromise (promise, cb) {
  return cb
    ? nodeify(promise, cb) // has cb, use callback and return null
    : promise // no cb, return promise
}
