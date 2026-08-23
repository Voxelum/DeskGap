const assert = require('node:assert/strict')
const path = require('node:path')
const { app, BrowserWindow, session } = require('deskgap')

app.once('ready', () => {
    const browserSession = session.createEphemeral()
    let protocolRequestCount = 0
    browserSession.protocol.handle('launcher-assets', (request, context) => {
        protocolRequestCount++
        assert.equal(context.session, browserSession)
        assert.equal(context.signal.aborted, false)
        const url = new URL(request.url)
        if (url.pathname === '/config.json') {
            return Response.json({ enabled: true }, {
                status: 201,
                statusText: 'Created',
                headers: {
                    'Access-Control-Expose-Headers': 'X-DeskGap-Protocol',
                    'Access-Control-Allow-Origin': '*',
                    'X-DeskGap-Protocol': 'handled',
                },
            })
        }
        if (url.pathname === '/loaded.js') {
            const script = 'window.customProtocolScriptLoaded = true'
            return new Response(script, { headers: {
                'Access-Control-Allow-Origin': '*',
                'Content-Length': String(Buffer.byteLength(script)),
                'Content-Type': 'text/javascript',
            } })
        }
        return new Response('missing', { status: 404 })
    })

    const window = new BrowserWindow({
        show: false,
        webPreferences: { session: browserSession },
    })
    const timeout = setTimeout(() => {
        process.stderr.write(`Timed out waiting for custom protocol behavior; requests=${protocolRequestCount}\n`)
        window.destroy()
        app.exit(1)
    }, 15000)

    window.webContents.on('console-message', event => {
        process.stderr.write(`Renderer console: ${event.level}: ${event.message}\n`)
    })
    window.webContents.handle('test.complete', (_context, result) => {
        try {
            assert.deepEqual(result, {
                body: { enabled: true },
                header: 'handled',
                scriptLoaded: true,
                status: 201,
                statusText: 'Created',
            })
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