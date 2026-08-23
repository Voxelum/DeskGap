const assert = require('node:assert/strict')
const path = require('node:path')
const { app, BrowserWindow, session } = require('deskgap')

app.once('ready', async () => {
    const window = new BrowserWindow({ show: false, webPreferences: { session: session.createEphemeral() } })
    const timeout = setTimeout(() => {
        process.stderr.write('Timed out waiting for binary channel echo\n')
        app.exit(1)
    }, 15000)

    try {
        const ready = new Promise(resolve => window.webContents.once('transport-ready', resolve))
        window.loadFile(path.join(__dirname, 'index.html'))
        await ready

        const channel = window.webContents.createChannel()
        const writer = channel.writable.getWriter()
        const reader = channel.readable.getReader()
        const payload = new Uint8Array(320 * 1024)
        for (let index = 0; index < payload.length; index++) payload[index] = index % 251

        const echoed = []
        let echoedBytes = 0
        const reading = (async () => {
            while (echoedBytes < payload.byteLength) {
                const { value, done } = await reader.read()
                if (done) throw new Error('Channel closed before echo completed')
                echoed.push(value)
                echoedBytes += value.byteLength
            }
        })()
        await writer.write(payload)
        await reading

        let offset = 0
        for (const chunk of echoed) {
            for (const byte of chunk) {
                assert.equal(byte, payload[offset])
                offset++
            }
        }
        assert.equal(offset, payload.byteLength)
        clearTimeout(timeout)
        process.stdout.write('ok')
        window.destroy()
        app.exit()
    } catch (error) {
        clearTimeout(timeout)
        process.stderr.write(`${error.stack}\n`)
        window.destroy()
        app.exit(1)
    }
})
