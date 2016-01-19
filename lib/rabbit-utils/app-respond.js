'use strict'

const pick = require('101/pick')
const values = require('object-values')
const NoAckError = require('../no-ack-error.js')

module.exports = respond

/**
 * Respond utility
 */
function respond () {
  const ctx = this
  const consumeOpts = ctx.consumeOpts
  const channel = ctx.consumerChannel
  let method
  let args
  const methods = ['ack', 'nack', 'ackAll', 'nackAll', 'reject']
  method = methods.find(function (method) {
    if (ctx[method]) {
      args = ctx[method]
      return true
    }
  })
  if (method) {
    args = values(pick(args, ['allUpTo', 'requeue']))
    if (method === 'ack' || method === 'nack') {
      args.unshift(ctx.message)
    }
    channel[method].apply(channel, args)
  } else if (!consumeOpts.noAck) {
    // if queue is expecting an acknowledgement emit err
    let err = new NoAckError('Message completed middlewares w/out any acknowledgement')
    ctx.app.emit('error', err, channel)
  }
}
