// function createMockChannel () {
//   return assign(new EventEmitter(), {
//     consume: sinon.stub().resolves(ctx.consumerTag),
//     cancel: sinon.stub().resolves(),
//     close: sinon.stub().resolves(),
//     ack: sinon.stub().resolves(),
//     nack: sinon.stub().resolves(),
//     reply: sinon.stub().resolves(),
//     request: sinon.stub().resolves()
//   })
// }
// function appConnect (done) {
//   ctx.url = 'url'
//   ctx.socketOptions = {}
//   ctx.app.connect(ctx.url, ctx.socketOptions, done)
// }
// function appConsume (done) {
//   ctx.queueName = 'queue-name'
//   ctx.queueOpts = {}
//   ctx.app.consume(ctx.queueName, ctx.queueOpts, function * () {})
//   done()
// }
// function stubAmqplib (done) {
//   ctx.consumerTag = 1
//   ctx.mockChannel = createMockChannel()
//   ctx.mockConnection = assign(new EventEmitter(), {
//     createChannel: sinon.stub().resolves(ctx.mockChannel),
//     close: sinon.stub().resolves()
//   })
//   sinon.stub(amqplib, 'connect').resolves(ctx.mockConnection)
//   done()
// }
// function restoreAmqplib (done) {
//   amqplib.connect.restore()
//   done()
// }

// describe('connect', function () {
//   beforeEach(appConsume)
//   beforeEach(stubAmqplib)
//   afterEach(restoreAmqplib)

//   it('should connect to rabbitmq and consume queue', function (done) {
//     const url = 'url'
//     const socketOptions = {}

//     ctx.app.connect(url, socketOptions, function (err) {
//       if (err) { return done(err) }
//       sinon.assert.calledOnce(amqplib.connect)
//       sinon.assert.calledWith(
//         amqplib.connect, url, socketOptions)
//       sinon.assert.calledTwice(
//         ctx.mockConnection.createChannel)
//       sinon.assert.calledWith(
//         ctx.mockChannel.consume, ctx.queueName, sinon.match.func, ctx.queueOpts)
//       done()
//     })
//   })

//   describe('connecting already', function () {
//     beforeEach(function (done) {
//       ctx.app.connectingPromise = new Promise(function () {})
//       done()
//     })

//     it('should return existing connecting promise', function (done) {
//       const url = 'url'
//       const socketOptions = {}

//       expect(ctx.app.connect(url, socketOptions)).to.equal(ctx.app.connectingPromise)
//       done()
//     })
//   })

//   describe('closing in-progress', function () {
//     beforeEach(function (done) {
//       ctx.connectSpy = sinon.spy(ctx.app, 'connect')
//       ctx.app.closingPromise = new Promise(function (resolve, reject) {
//         ctx.resolveClose = resolve
//         ctx.rejectClose = reject
//       })
//       done()
//     })
//     afterEach(function (done) {
//       ctx.connectSpy.restore()
//       done()
//     })

//     it('should connect after close finishes', function (done) {
//       const url = 'url'
//       const socketOptions = {}
//       const connectPromise = ctx.app.connect(url, socketOptions)

//       expect(connectPromise).to.be.an.instanceOf(Promise)
//       sinon.assert.calledOnce(ctx.connectSpy)
//       connectPromise.then(function () {
//         sinon.assert.calledTwice(ctx.connectSpy)
//       })
//       ctx.resolveClose()
//       done()
//     })
//   })

//   describe('connected to rabbitmq', function () {
//     beforeEach(appConnect)

//     it('should just callback', function (done) {
//       const url = 'url2'
//       const socketOptions = {}

//       ctx.app.connect(url, socketOptions, function (err) {
//         if (err) { return done(err) }
//         // ensure connect methods are called _once_.. not twice.
//         sinon.assert.calledOnce(
//           amqplib.connect)
//         sinon.assert.calledWith(
//           amqplib.connect, ctx.url, ctx.socketOptions)
//         sinon.assert.calledTwice(
//           ctx.mockConnection.createChannel)
//         sinon.assert.calledOnce(
//           ctx.mockChannel.consume)
//         done()
//       })
//     })
//   })
// })

// describe('close', function () {
//   beforeEach(stubAmqplib)
//   afterEach(restoreAmqplib)

//   it('should just callback', function (done) {
//     ctx.app.close(function (err) {
//       if (err) { return done(err) }
//       sinon.assert.notCalled(ctx.mockChannel.cancel)
//       sinon.assert.notCalled(ctx.mockChannel.close)
//       sinon.assert.notCalled(ctx.mockConnection.close)
//       done()
//     })
//   })

//   describe('closing', function () {
//     beforeEach(function (done) {
//       ctx.app.closingPromise = new Promise(function () {})
//       done()
//     })

//     it('should return existing closing promise', function (done) {
//       expect(ctx.app.close()).to.equal(ctx.app.closingPromise)
//       done()
//     })
//   })

//   describe('connecting', function () {
//     beforeEach(function (done) {
//       ctx.closeSpy = sinon.spy(ctx.app, 'close')
//       ctx.app.connectingPromise = new Promise(function (resolve, reject) {
//         ctx.resolveConnect = resolve
//         ctx.rejectConnect = reject
//       })
//       done()
//     })

//     it('should close after connect finishes', function (done) {
//       const closePromise = ctx.app.close()
//       sinon.assert.calledOnce(ctx.closeSpy)
//       closePromise.then(function () {
//         sinon.assert.calledTwice(ctx.closeSpy)
//       })
//       ctx.resolveConnect()
//       done()
//     })
//   })

//   describe('connected to rabbitmq', function () {
//     beforeEach(appConsume)
//     beforeEach(appConnect)

//     it('should disconnect from rabbitmq', function (done) {
//       ctx.app.close(function (err) {
//         if (err) { return done(err) }
//         sinon.assert.calledOnce(ctx.mockChannel.close)
//         sinon.assert.calledOnce(ctx.mockConnection.close)
//         done()
//       })
//     })
//   })
// })
