'use strict'

const assert = require('assert')

const isGeneratorFunction = require('is-generator').fn

module.exports = assertGeneratorFunctions

function assertGeneratorFunctions (fn) {
  assert(isGeneratorFunction(fn), 'must be generator functions')
}
