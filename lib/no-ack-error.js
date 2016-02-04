'use strict'

module.exports = class NoAckError extends Error {
  constructor (message) {
    super(message)
    Error.captureStackTrace(this, this.constructor)
  }
}
