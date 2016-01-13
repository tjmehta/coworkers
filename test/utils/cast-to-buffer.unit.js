'use strict'
const Lab = require('lab')
const Code = require('code')

const castToBuffer = require('../../lib/utils/cast-to-buffer.js')

const lab = exports.lab = Lab.script()
const describe = lab.describe
const it = lab.it
const expect = Code.expect

describe('castToBuffer', function () {
  it('should return if val is a buffer', function (done) {
    var val = new Buffer('hello')
    expect(castToBuffer(val)).to.equal(val)
    done()
  })

  it('should cast an array to a buffer', function (done) {
    var val = []
    var expected = new Buffer('[]')
    expect(castToBuffer(val)).to.deep.equal(expected)
    done()
  })

  it('should cast an object to a buffer', function (done) {
    var val = {}
    var expected = new Buffer('{}')
    expect(castToBuffer(val)).to.deep.equal(expected)
    done()
  })

  it('should cast a string to a buffer', function (done) {
    var val = 'hello'
    var expected = new Buffer(val)
    expect(castToBuffer(val)).to.deep.equal(expected)
    done()
  })

  it('should toJSON if value has it', function (done) {
    var val = {
      toJSON: function () {
        return {}
      }
    }
    var expected = new Buffer('{}')
    expect(castToBuffer(val)).to.deep.equal(expected)
    done()
  })

  it('should throw an error for null', function (done) {
    var val = null
    expect(castToBuffer.bind(null, val)).to.throw()
    done()
  })
})
