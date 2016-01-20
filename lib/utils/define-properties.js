'use strict'

module.exports = defineProperties

function defineProperties (obj, props, definition) {
  props.forEach(function (prop) {
    Object.defineProperty(obj, prop, definition)
  })
}
