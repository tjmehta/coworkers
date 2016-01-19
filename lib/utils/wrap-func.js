'use strict'

const assert = require('assert')

const isFunction = require('101/is-function')

module.exports = wrap

function wrap (obj, methods, proxyFn) {
  methods.forEach(function (method) {
    const orig = obj[method]
    assert(isFunction(orig), `"${method}" must be a function`)
    obj[method] = function () {
      return proxyFn.call(this, orig, arguments)
    }
  })
}
