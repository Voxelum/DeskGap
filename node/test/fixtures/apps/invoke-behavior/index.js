const assert = require('node:assert/strict')
const path = require('node:path')
const { app, BrowserWindow, session } = require('deskgap')

app.once('ready', () => {
    const window = new BrowserWindow({ show: false, webPreferences: { session: session.createEphemeral() } })
    const timeout = setTimeout(() => {
        process.stderr.write('Timed out waiting for invoke behavior\n')
        app.exit(1)
    }, 15000)
    window.webContents.on('console-message', event => {
        process.stderr.write(`Renderer console: ${event.level}: ${event.message}\n`)
    })
    window.webContents.on('page-title-updated', (_event, title) => {
        if (title.startsWith('failed:')) process.stderr.write(`${title}\n`)
    })

    let handlerAborted = false
    let waitHandlerStarted = false
    const removeEcho = window.webContents.handle('test.echo', (context, args) => {
        assert.equal(context.webView, window.webContents)
        assert.equal(context.windowId, window.webContents.id)
        assert.equal(typeof context.navigationGeneration, 'number')
        assert.equal(context.signal.aborted, false)
        return { echoed: args, navigationGeneration: context.navigationGeneration }
    })
    assert.throws(
        () => window.webContents.handle('test.echo', () => null),
        /already registered/,
    )
    window.webContents.handle('test.fail', () => {
        const error = new Error('Expected remote failure')
        error.name = 'FixtureError'
        error.code = 'EXPECTED'
        error.details = { retryable: false }
        throw error
    })
    window.webContents.handle('test.remove', () => {
        removeEcho()
        return null
    })
    window.webContents.handle('test.wait', context => new Promise((_resolve, reject) => {
        waitHandlerStarted = true
        context.signal.addEventListener('abort', () => {
            handlerAborted = true
            reject(context.signal.reason)
        }, { once: true })
    }))
    window.webContents.handle('test.wait-started', () => waitHandlerStarted)
    const removeTemporary = window.webContents.handle('test.temporary', () => null)
    assert.equal(window.webContents.removeHandler('test.temporary'), true)
    assert.equal(window.webContents.removeHandler('test.temporary'), false)
    removeTemporary()

    window.webContents.handle('test.complete', (_context, result) => {
        try {
            assert.deepEqual(result.echoed, { message: 'hello' })
            assert.equal(result.navigationGeneration > 0, true)
            assert.deepEqual(result.failure, {
                code: 'EXPECTED',
                details: { retryable: false },
                message: 'Expected remote failure',
                name: 'InvokeError',
                remoteName: 'FixtureError',
            })
            assert.equal(result.removedRemoteName, 'HandlerNotFoundError')
            assert.equal(result.abortRejected, true)
            assert.equal(handlerAborted, true)
            clearTimeout(timeout)
            process.stdout.write('ok')
            setImmediate(() => {
                window.destroy()
                app.exit()
            })
            return null
        }
        catch (error) {
            clearTimeout(timeout)
            process.stderr.write(`${error.stack}\n`)
            window.destroy()
            app.exit(1)
            return null
        }
    })

    window.loadFile(path.join(__dirname, 'index.html'))
})