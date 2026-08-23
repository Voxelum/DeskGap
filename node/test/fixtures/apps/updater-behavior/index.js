const assert = require('node:assert/strict')
const { createHash, generateKeyPairSync, sign } = require('node:crypto')
const fs = require('node:fs')
const http = require('node:http')
const os = require('node:os')
const path = require('node:path')
const { app, serializeUpdateManifestForSignature, Updater } = require('deskgap')

function listen(server) {
    return new Promise((resolve, reject) => {
        server.once('error', reject)
        server.listen(0, '127.0.0.1', resolve)
    })
}

app.once('ready', async () => {
    const content = Buffer.from('DeskGap updater fixture')
    const sha256 = createHash('sha256').update(content).digest('hex')
    const { privateKey, publicKey } = generateKeyPairSync('ed25519')
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'deskgap-updater-fixture-'))
    const server = http.createServer((request, response) => {
        if (request.url === '/manifest.json') {
            const unsigned = {
                version: '99.0.0',
                assets: [{
                    arch: process.arch,
                    name: process.platform === 'win32' ? 'fixture.exe' : 'fixture.bin',
                    platform: process.platform,
                    sha256,
                    size: content.length,
                    url: '/fixture',
                }],
            }
            const signature = sign(null, Buffer.from(serializeUpdateManifestForSignature(unsigned)), privateKey).toString('base64')
            response.end(JSON.stringify({ ...unsigned, signature }))
        } else if (request.url === '/fixture') {
            response.setHeader('content-length', content.length)
            response.end(content)
        } else {
            response.statusCode = 404
            response.end()
        }
    })
    const timeout = setTimeout(() => app.exit(1), 15000)
    try {
        await listen(server)
        const updater = new Updater({
            allowLoopback: true,
            trustedPublicKey: publicKey.export({ format: 'pem', type: 'spki' }),
        })
        let progress = 0
        updater.on('download-progress', (_event, value) => { progress = value.transferred })
        const origin = `http://127.0.0.1:${server.address().port}`
        const update = await updater.checkForUpdates(`${origin}/manifest.json`)
        const downloaded = await updater.downloadUpdate(update, { directory })
        assert.deepEqual(fs.readFileSync(downloaded.path), content)
        assert.equal(progress, content.length)
        clearTimeout(timeout)
        await new Promise(resolve => server.close(resolve))
        fs.rmSync(directory, { recursive: true, force: true })
        process.stdout.write('ok')
        app.exit()
    } catch (error) {
        clearTimeout(timeout)
        server.close()
        fs.rmSync(directory, { recursive: true, force: true })
        process.stderr.write(`${error.stack}\n`)
        app.exit(1)
    }
})
