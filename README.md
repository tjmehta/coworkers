![coworkers](http://i.imgur.com/WUEcl4e.png)
===

[![Build Status](https://travis-ci.org/tjmehta/coworkers.svg?branch=master)](https://travis-ci.org/tjmehta/coworkers) [![Coverage Status](https://coveralls.io/repos/github/tjmehta/coworkers/badge.svg?branch=master)](https://coveralls.io/github/tjmehta/coworkers?branch=master) [![js-standard-style](https://img.shields.io/badge/code%20style-standard-brightgreen.svg?style=flat)](http://standardjs.com/)

Coworkers is a RabbitMQ microservice framework

Coworkers is a new microservice framework heavily inspired by [Koa](https://github.com/koajs/koa), which aims to be a simple, robust, and scalable foundation for creating RabbitMQ microservices. Through leveraging generators Coworkers allows you to ditch callbacks and greatly increase error-handling. Coworkers also uses [Amqplib](https://github.com/squaremo/amqp.node), a battle-tested AMQP client, under the hood to communicate with RabbitMQ and has best-practices baked in. Finally, Coworkers enables easy scalability by running each queue-consumer in it's own process through node clustering (optional).

# Installation
```bash
npm install --save coworkers
```
Note: `amqplib` is a peer dependency. This give you flexibility in using any compatible version you please. npm@^3 does not install peer dependencies automatically, so you will have to install `amqplib` yourself.

# Usage

## Quick Example
```js
const coworkers = require('coworkers')
const app = coworkers()
// shared middlewares
app.use(function * (next) {
  // all consumers will run this logic...
  yield next
})
// queue consumers w/ middlewares
app.queue('foo-queue', function * () {
  // consumer specific logic
  this.ack = true // acknowledge message later, see `Context` documentation below
})
// middleware error handler
app.on('error', function (err) {
  console.error(err.stack)
})
// connect to rabbitmq and begin consuming
app.connect()
```

# Documentation

## Application

The Coworkers `Application` class is the center of RabbitMQ microservice. It keeps track of which queues to consume and generator middlewares. Coworker's middlewares system should feel familiar as it is similar to that of many other http frameworks such as Ruby's Rack, Connect, and is actually powered by the internals of Koa. This middleware system uses generators to make handling asyncronous behavior a breeze. Coworkers is also powered by `amqplib`, a battle tested RabbitMQ client library, and has many best practices built in.

Methods (documented below):

 * `use`
 * `queue`
 * `connect`
 * `close`

##### Simple consumer example:
```js
const coworkers = require('coworkers')
const app = coworkers()

app.queue('foo-queue', function * () {
  this.ack = true
})
app.on('error', function (err, channel, context) {
  console.error(err)
  if (channel) {
    channel.nack(context.message).catch(function (err) {
      console.error(err)
    })
  }
})

app.connect()
```

### app.use(middleware)
Use the given middleware for all queues consumed by the app.
```js
/**
 * @param  {GeneratorFunction} middleware
 * @return {Application} app
 */
```
See "Cascading middleware" section (below) for a full example

### app.queue(queueName, [queueOpts], [consumeOpts], ...middlewares)
Setup a queue consumer w/ options and middleware. Queues will be asserted and consumed with the given options in `app.connect`.
```js
/**
 * @param  {String} queueName queue name for which the middleware will be used
 * @param  {Object} [queueOpts] assert queue options, don't use w/ schema
 * @param  {Object} [consumeOpts] consume options
 * @param  {GeneratorFunction} ...middlewares one middleware is required
 * @return {Application} app
 */
```
##### app.queue example
```js
const coworkers = require('coworkers')

// using optional schema
const app = coworkers({ schema: schema })
// add required error handler
app.on('error', function (err) {
  console.error(err.stack)
})
// setup a queue
const queueOpts = {/* queue options */}
const consumeOpts = {/* consume options */}
// correct usage: (note that consumeOpts becomes the second arg)
app.queue('queue0', consumeOpts, function * () {})
// errors
app.queue('queue0', queueOpts, consumeOpts, function * () {})
// Error: 'app.queue() cannot use "queueOpts" when using a schema'
app.queue('queue1', queueOpts, consumeOpts, function * () {})
// Error: 'app.queue() requires "queue1" queue to exist in schema'
```

##### app.queue example when using rabbitmq-schema
```js
const coworkers = require('coworkers')
const RabbitSchema = require('rabbitmq-schema')

const schema = new RabbitSchema({
  exchange: 'exchange0',
  type: 'direct',
  options: {}
  bindings: {
    routingPattern: 'foo.bar.key',
    destination: {
      queue: 'queue0',
      messageSchema: {/* message json-schema */},
      options: {/* queue options */}
    },
    args: {}
  }
})

// using optional schema
const app = coworkers(schema)
// add required error handler
app.on('error', function (err) {
  console.error(err.stack)
})
// setup a queue
const consumeOpts = {/* consume options */}
// correct usage: (note that consumeOpts becomes the second arg)
app.queue('queue0', consumeOpts, function * () {})
// errors
const queueOpts = {/* queue options */}
app.queue('queue0', queueOpts, consumeOpts, function * () {})
// Error: 'app.queue() cannot use "queueOpts" when using a schema'
// (It will use the queueOpts from the schema)
app.queue('queue1', consumeOpts, function * () {})
// Error: 'app.queue() requires "queue1" queue to exist in schema'
```

See "Cascading middleware" section (below) for a full example

### Cascading Middleware
Coworker's middleware cascades in a more traditional way as you may be used to with similar tools - this was previously difficult to make user friendly with node's use of callbacks. However with generators we can achieve "true" middleware. Contrasting Connect's implementation which simply passes control through series of functions until one returns, Coworkers yields "downstream", then control flows back "upstream" just like Koa.

The following example `ack`'s all foo-queue messages. First the message flows through `trace` and `parse-content` middleware to mark when the request started, parse content, and then yield control through to the `foo-queue` consumer middleware. When an middleware invokes `yield next` the function suspends and passes control to the next middleware defined. After there are no more middleware to execute "downstream", the stack will unwind and each middleware is resumed to perform "upstream" behavior (post `yield`, in reverse order). Note: "shared middlewares" (use) always run before "consumer middlewares" (consume), regardless of attachment order.

Note: if the message reaches the end of the middlewares without an ack (and consumer is not `noAck`) a special `NoAckError` will be thrown.

##### Cascading example:
```js
const app = require('coworkers')()

/* shared middlewares */

// "trace" middleware
app.use(function * (next) {
  this.id = require('crypto').randomBytes(12)
  // save consumer start time
  const startTime = Date.now()
  // move on to next middleware
  yield next
  // all middlewares have finished
  const elapsed = Date.now() - startTime
  console.log(`coworkers-trace:${this.id}:${elapsed}`)
})

// "parse-content" middleware
app.use(function * (next) {
  this.message.content = JSON.parse(this.message.content)
  yield next
})

/* queue consumers w/ middlewares */

// "foo-queue" consumer middleware
app.queue('foo-queue', function * () {
  this.ack = true // checkout `Context` documentation for ack, nack, and more
})

app.connect()
```
By default, app handles all errors by logging them and nacking messages

### Middleware Error Handling
A coworkers application will not start w/out an error handler. Middleware errors are emitted on the app. To setup error-handling logic such as centralized logging you can add an "error" event listener.

##### Simple error handler example:
```js
app.on('error', function (err, context) {
  log.error(`${context.queueName} consumer error`, err)
})
```
For special error-handling behavior make use of the properties available on `context`. Also, make sure to handle errors that can occur in the error handler (they will not be caught).

##### Robust error handler example:
```js
app.on('error', function (err, context) {
  log.error(`${context.queueName} consumer error`, err)

  // check if the message has not been acked
  // make sure message is not being consumed on a `noAck` queue
  // and check if the exchange is using a dead letter exchange
  const hasDlx = Boolean(context.queueOpts.deadLetterExchange)
  if (!context.messageAcked && hasDlx) {
    let channel = context.consumerChannel // amqplib promise api: http://www.squaremobius.net/amqp.node/channel_api.html#channel
    let message = context.message
    let requeue = false
    // nack the message
    channel.nack(message, requeue)
  }
})
```

### app.context
The recommended namespace to extend with information that's useful throughout the lifetime of your application, as opposed to a per request basis.
```js
app.context.db = db();
```

### app.connect(...)
Connect to RabbitMQ, create channels, and consume queues

 * 1) Creates a connection to rabbitmq
 * 2) Creates a consumer channel and publisher channel
 * 3) Begins consuming queues
 * Note on Clustering:
    If using clustering and isMaster, it will create all workers and wait for them to connect to RabbitMQ. If any of the workers fail to connect to Rabbitmq they will cause master's connect to error.
```
/**
 * @param {String} [url] rabbitmq connection url, default: 'amqp://127.0.0.1:5672'
 * @param {Object} [socketOptions] socket options
 * @param {Function} [cb] callback, not required if using promises
 * @return {Promise} promise, if no callback is supplied
 */
```

##### Successful connect examples:
```js
const app = require('coworkers')()

app.queue('foo-queue', function * () {/*...*/})

// promise api
app.connect() // connects to 'amqp://127.0.0.1:5678' by default, returns promise
  .then(...)
  .catch(...)
// - or -
app.connect('amqp://127.0.0.1:8000') // returns promise
  .then(...)
  .catch(...)
// - or -
const socketOptions = {} // see http://www.squaremobius.net/amqp.node/channel_api.html#connect
app.connect('amqp://127.0.0.1:8000', socketOptions) // returns promise
  .then(...)
  .catch(...)

// callback api
app.connect(callback) // connects to 'amqp://127.0.0.1:5678' by default
// - or -
app.connect('amqp://127.0.0.1:8000', callback)
// - or -
const socketOptions = {} // see http://www.squaremobius.net/amqp.node/channel_api.html#connect
app.connect('amqp://127.0.0.1:8000', socketOptions, callback)
// callback
function callback (err) {
  // ...
}
```

##### Failed connect examples:
```js
const app = require('coworkers')()

app.use(function * () {/*...*/})

app.connect(function (err) {
/*
 Error: App requires consumers, please use "consume" before calling connect
 */
})
```

### app.close(...)
Close channels and disconnect from RabbitMQ
##### Close examples:
```js
// promise api
app.close()
  .then(...)
  .catch(...)

// callback api
app.close(callback)
```

## Context

A Coworkers Context encapsulates a RabbitMQ consumer's `message` and `channel`s into a single object. This provides easy access to methods and accessors to data frequently used w/ RabbitMQ microservice development.

A `Context` is created _per_ message, and is referenced in middleware as the receiver, or the `this` identifier

### Context example:
```js
app.use(function * () {
  this // is the Context
  this.queueName // is the name of the queue where the message originated
  this.message // is the incoming rabbitmq message
  this.consumerChannel // is the channel which recieved the message
  this.publisherChannel // is an extra channel dedicated for publishing messages
})
```

Many of the context's accessors and methods simply delegate to their `this.message`, `this.consumerChannel`, or `this.publisherChannel` equivalents for convenience, and are otherwise identical. For example, `this.deliveryTag` and `this.messageAcked` delegate to the `message`, `this.ack` and `this.nack` delegate to `consumerChannel`, and `this.publish()` and `this.sendToQueue()` delegate to `publisherChannel`.

### Context Models
For the most part context models should not need to be used. Context accessor and methods should be more convenient, and allow the message to properly flow "downstream" and "upstream".
* this.app - the coworkers app
* this.connection - amqplib rabbitmq connection, see "Connection" documentation below
* this.consumerChannel - amqplib* rabbitmq channel dedicated to consuming, see "Channel" documentation below
* this.publisherChannel - amqplib* rabbitmq channel dedicated to publishing, see "Channel" documentation below

### Context Properties
* this.queueName - name of the queue from which the message originated
* this.message - the incoming rabbitmq message
* this.content - message content buffer, `message.content` accessor
* this.fields - message fields, `message.fields` getter
* this.properties - message properties, `message.properties` getter
* this.headers - message headers, `message.properties.headers` getter
* this.exchange - exchange which the message was published to, `message.fields.exchange` accessor
* this.routingKey - routingKey which the message was published with, `message.fields.routingKey` accessor
* this.deliveryTag - delivery tag of the message, `message.fields.deliveryTag` getter
* this.consumerTag - unique identifier of consumer, `message.fields.consumerTag` getter
* this.redelivered - whether message was redelivered, `message.fields.redelivered` getter
* this.queueOpts - queue options used to assert the queue
* this.consumeOpts - queue's consume options
* this.messageAcked - boolean, whether message has been acknowledged (ack, nack, reject)
* this.state - recommended namespace for passing info between middlewares

### Context Ack Properties
These special ack properties should be used in place of channel calls (except in the error handler). These properties allow the message to complete it's flow "downstream" and back "upstream" before acknowledging the message.
* this.ack - set this property to ack the message at the end of the middlewares
* this.nack - set this property to nack the message at the end of the middlewares
* this.reject - set this property to reject the message at the end of the middlewares

##### Ack Example:
```js
app.use(function * () {
  /* ack */
  this.ack = true // will ack w/ default options
  // - or -
  this.ack = { allUpTo: true } // specify custom options
})
```
##### Nack Example:
```js
app.use(function * () {
  /* nack */
  this.nack = true // will nack w/ default options
  // - or -
  this.nack = { requeue: false, allUpTo: false } // specify custom options
})
```

### Context Methods
* this.publish(...) - publish a message to an exchange w/ a routing key on the publisherChannel
* this.sendToQueue(...) - publish a message directly to a queue on the publisherChannel
* this.request(...) - publish an rpc message, and easily recieve it's reply, creates a new channel for publishing and consuming
* this.reply(...) - reply to an rpc message on the publisherChannel
* this.checkQueue(...) - check if a queue exists (creates it's own channel to prevent any unexpected errors)
* this.checkReplyQueue() - check if a reply-queue exists using message.properties.replyTo (creates it's own channel to prevent any unexpected errors)
* this.toJSON() - return json version of context (note: will not jsonify context.state, if it includes non-primitives)

##### Publish example:
```js
// `context.publish` jsdoc:
/**
 * Proxy method to publisherChannel.publish, publish a message to an exchange
 * @param  {String} exchange   exchange name to publish to
 * @param  {String} routingKey message routing key
 * @param  {Buffer|Object|Array|String} content    message content
 * @param  {Object} [options]    publish options
 */
// Example usage in middleware
app.use(function * (next) {
  // Works just like amqplib's channel publish.
  // But context's publish allows publishing of
  // objects and strings in addition to buffers.
  // Non-buffer content will be stringified and casted to a Buffer.
  const content = { foo: 1 }
  const opts = {} // optional
  this.publish('exchange-name', 'routing.key', content, opts)
  // ...
})
```
##### SendToQueue and CheckQueue example:
```js
// `context.sendToQueue` jsdoc:
/**
 * Proxy method to publisherChannel.sendToQueue
 *   publish a message directly to a queue
 * @param  {String} queue   queue name to publish to
 * @param  {Buffer|Object|Array|String} content message content
 * @param  {Object} [options] publish options
 */
// `context.checkQueue` jsdoc:
/**
 * create a channel, check if the queue exists, and close the channel
 * @param  {String}   queue    queue name
 * @param  {Function} [cb]     callback, not required if using promises
 * @return {Promise}  if using promises
 */
// Example usage in middleware
app.use(function * (next) {
  // Works just like amqplib's channel sendToQueue.
  // But context's sendToQueue allows publishing of
  // objects and strings in addition to buffers.
  // Non-buffer content will be stringified and casted to a Buffer.
  const content = 'hello'
  const opts = {} // optional
  // check queue: in some case it may be useful to check existance of a queue before publishing to it
  var exists = yield this.checkQueue('queue-name')
  if (!exists) {
    // handle message: ack, nack, or etc
    return
  }
  // reply
  this.sendToQueue('queue-name', content, opts)
  // ...
})
```
##### RPC ( Request, Reply, CheckReplyQueue) example:
Client.js using `context.request`
```js
// `context.request` jsdoc:
/**
 * Make an rpc request, publish a message to an rpc queue
 * @param  {String}   queue     name of rpc-queue to send the message to
 * @param  {Buffer}   content   message content
 * @param  {Object}   [sendOpts]  sendToQueue options
 * @param  {Object}   [queueOpts] assertQueue options for replyTo queue, queueOpts.exclusive defaults to true
 * @param  {Object}   [consumeOpts] consume options for replyTo queue, consumeOpts.noAck defaults to true
 * @param  {Function} [cb] callback, if using callback api
 * @return {Promise} returns a promise
 */
// Example usage in middleware
app.queue('client-queue', function * () {
  // request makes it easy to make an rpc-request from a queue
  const content = { a: 10, b: 20 }
  // request function signatures has a lot of optional arguments:
  // request(queueName, content, [sendOpts], [queueOpts], [consumeOpts])
  const replyMsg = yield this.request('multiply-queue', content)
  console.log(replyMsg.content.toString()) // 200
  // ...
  this.ack = true
})
```
Server.js using `context.reply`
```js
// `context.reply` jsdoc:
/**
 * Reply to an rpc request, publish a message to replyTo queue
 * @param  {Buffer|Object|Array|String} content message content
 * @param  {Object} options publish options
 */
// `context.checkReplyQueue` jsdoc:
/**
 * create a channel, check if replyTo queue exists, and close the channel
 * @param  {Function} [cb]    not required if using promises
 * @return {Promise}  if using promises
 */
// Example usage in middleware
app.use(function * (next) {
  // convert message body to json
  this.message.content = JSON.stringify(this.message.content.toString())
  yield next
})
app.queue('multiply-queue', function * () {
  // check reply queue: in some case it may be useful to check existance of a queue before doing any work
  const exists = yield this.checkReplyQueue()
  if (!exists) {
    // handle message: ack, nack, or etc
    return
  }
  const content = this.message.content
  const a = content.a
  const b = content.b
  const c = a * b
  const opts = {} // optional
  // reply is sync and does not return a promise,
  //   uses publisherChannel.sendToQueue (see "Channel" documentation below)
  this.reply(new Buffer(c), opts)
  // ...
})
```

## Channel
see amqplib channel documentation
http://www.squaremobius.net/amqp.node/channel_api.html#channel

## Connection
see amqplib connection documentation
http://www.squaremobius.net/amqp.node/channel_api.html#connect

## Clustering / Process management
By default, coworkers will use clustering to give each queue consumer it's own process.
Clustering is optional, you can manage coworker processes manually (see "Manual process management" below).

Clustering is opinionated, it make the processes work as a unit:

 * If a worker fails to startup and connect to rabbitmq, it will kill all the workers
 * If a workers dies it will be attempted to be respawned w/ exponential backoff
    * Use the following ENV variables to adjust behavior: `COWORKERS_RESPAWN_RETRY_ATTEMPTS`, `COWORKERS_RESPAWN_RETRY_MIN_TIMEOUT`, `COWORKERS_RESPAWN_RETRY_FACTOR`
 * If a worker dies and repeatedly fails to create process and connect to rabbitmq it will crash the entire cluster

##### Clustering example:

When clustering is enabled, Coworkers will optimize the number of processes to the number of cpus the server has. The below example will will create four workers in total (to match the number of cpus): two "foo-queue" consumers, and two "bar-queue" consumers. If the number of queues > num cpus, coworkers will only create one consumer per queue. If you want to specify the number of workers per queue you can do this using the environment variable: `COWORKERS_NUM_WORKERS_PER_QUEUE`. If you have any problems w/ a particular worker process you can close it by sending it a `SIGINT` signal, this will gracefully shutdown the process and not respawn a replacement (to restart the worker after stopping it, restart your coworkers app).

```js
// app.js
const app = require('coworkers')()
require('os').cpus().length // 4

app.queue('foo-queue', ...)
app.queue('bar-queue', ...)

app.on('error', ...)

app.connect(function (err) {
  if (err) console.error(err.stack)
})
```

##### Manual process management:

Coworkers forces you to only consume a single queue per process, so that your consumers are decoupled. If you want to manage your own processes w/out using clustering all you have to do is specify three environment variables:

Processes will send process [messages](https://nodejs.org/docs/latest/api/child_process.html#child_process_child_send_message_sendhandle_callback) so that you can determine the state:

 * messages include: 'coworkers:connect', 'coworkers:connect:error', 'coworkers:close', 'coworkers:close:error'

```bash
COWORKERS_CLUSTER="false" # {string-boolean} disabled clustering
COWORKERS_QUEUE="foo-queue" # {string} specify the queue the process will consume
COWORKERS_QUEUE_WORKER_NUM=1 # {number} specify the queue worker number, optional, default: 1
  # if you create multiple processes per queue, this unique id per queue

```
```js
// app.js
// ...
app.use('foo-queue', ...)
app.use('bar-queue', ...)

module.exports = app
```
```js
// process-manager.js
var app = require('app')()

// create one consumer process per queue
app.queueNames.forEach(function (queueName) {
  // create node process w/ env:
  // COWORKERS_CLUSTER="false"
  // COWORKERS_QUEUE=queueName
  // COWORKERS_QUEUE_WORKER_NUM=1
  // ...
})
//...
```

# Testing
Check out [coworkers-test](https://github.com/tjmehta/coworkers-test) it allows you to easily test a coworkers app's message-handling middlewares as a unit w/out requiring rabbitmq.

# Changelog
[CHANGELOG.md](https://github.com/tjmehta/coworkers/blob/master/CHANGELOG.md)

# License
MIT
