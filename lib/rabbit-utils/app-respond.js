'use strict'

const pick = require('101/pick')
const values = require('object-values')

module.exports = respond

/**
 * Respond utility
 */
function respond () {
  const ctx = this
  const channel = ctx.consumerChannel
  let method
  let args

  if (ctx._channelAction.method) {
    method = ctx._channelAction.method
    args = values(pick(ctx._channelAction.args, ['allUpTo', 'requeue']))
    if (method === 'ack' || method === 'nack') {
      args.unshift(ctx.message)
    }

    return channel[method].apply(channel, args)
  } else {
    return ctx.finalhandler()
  }
}
