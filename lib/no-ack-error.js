'use strict'

module.exports = class NoAckError extends Error {
  constructor (message) {
    super(message)
  }
}
