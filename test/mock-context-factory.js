'use strict'

const EventEmitter = require('events').EventEmitter

const assign = require('101/assign')
const defaults = require('101/defaults')
const sinon = require('sinon')

const Context = require('../lib/context.js')

module.exports = mockContextFactory

function mockContextFactory (app, queueName, message) {
  defaults(app, {
    connection: new EventEmitter(),
    consumerChannel: mockChannelFactory(),
    producerChannel: mockChannelFactory()
  })

  return new Context(app, queueName, message)
}

function mockChannelFactory () {
  return assign(new EventEmitter(), {
    ack: sinon.stub(),
    nack: sinon.stub(),
    ackAll: sinon.stub(),
    nackAll: sinon.stub(),
    reject: sinon.stub()
  })
}
