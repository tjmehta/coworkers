'use strict'

const assertArgs = require('assert-args')
const isObject = require('101/is-object')
const toJSON = function (val) {
  return (val && val.toJSON) ? val.toJSON() : val
}

module.exports = castToBuffer
/**
 * cast value to buffer
 * @param  {Buffer|Object|Array|String} val value to be casted
 * @return {Buffer}     value as a Buffer
 */
function castToBuffer (val) {
  if (Buffer.isBuffer(val)) {
    return val
  }

  val = toJSON(val)
  const args = assertArgs([val], {
    val: ['string', 'array', 'object']
  })
  val = args.val

  let str

  if (Array.isArray(val)) {
    val = val.map(toJSON)
    str = JSON.stringify(val)
  } else if (isObject(val)) {
    val = toJSON(val)
    str = JSON.stringify(val)
  } else { // val is a string
    str = val
  }

  return new Buffer(str)
}
