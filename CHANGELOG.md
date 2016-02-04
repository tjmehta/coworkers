# 0.3.0
Application
  * Added optional `Context` arg to `messageHandler` for easier testing
NoAckErr
  * Improved stack
Debug
  * Fixed issues w/ filepaths logged
Readme:
  * Added link to coworkers-test
Package.json
  * Removed callsite dependency

# 0.2.3
Application:
  * Fix broken `new Application(schema)` constructor now accepts `schema` or `options`

# 0.2.2
Application:
  * Remove close/exit handlers before closing rabbit connection and channels in `close`

# 0.2.1
ClusterManager:
  * Propagate process.env to workers

# 0.2.0
Application:
  * Sends process messages for connect and close states (useful for process management)
    * 'coworkers:connect', 'coworkers:connect:error', 'coworkers:close', 'coworkers:close:error'
  * SIGINT handler now throws uncaught exception if graceful shutdown fails
  * When using clustering master process `connect` will wait for all workers to connect to rabbitmq
    * if any fail, it will yield an error and shutdown all other workers
  * Unexpected `connection` 'close' events now throws an error to kill the process
  * Unexpected `consumerChannel` 'close' events now throws an error to kill the process
  * Unexpected `producerChannel` 'close' events now throws an error to kill the process
  * Unexpected `connection` 'error' events now throws the error to kill the process
  * Unexpected `consumerChannel` 'error' events now throws the error to kill the process
  * Unexpected `producerChannel` 'error' events now throws the error to kill the process

ClusterManager:
  `start` waits for all worker forks to finish, if any errors it will throw a special error
  Added retries w/ exponential backoff to `killWorker` and `spawnWorker`
  If spawning a worker fails repeatedly it will throw an uncaught exception to crash the master

# 0.1.1
Fix require in index.js
Readme updates

# 0.1.0
Initial release
Application:
  * use, queue, connect, close, error handler
Context:
  * connection, consumerChannel, publisherChannel,
  * queueName, message, deliveryTag, messageAcked, state
  * queueOpts, messageOpts,
  * ack, nack, ackAll, nackAll, rejectAll,
  * publish, sendToQueue, request, reply
