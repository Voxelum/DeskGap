const { spawnSync } = require('node:child_process')
const path = require('node:path')

const [distPath, ...fixtures] = process.argv.slice(2)
if (distPath == null || fixtures.length === 0) {
    process.stderr.write('Usage: node run-fixtures.js <dist-path> <fixture>...\n')
    process.exit(1)
}

const executable = process.platform === 'darwin'
    ? path.join(distPath, 'DeskGap.app', 'Contents', 'MacOS', 'DeskGap')
    : process.platform === 'win32'
        ? path.join(distPath, 'DeskGap', 'DeskGap.exe')
        : path.join(distPath, 'DeskGap', 'DeskGap')

for (const fixture of fixtures) {
    process.stdout.write(`Running ${fixture}... `)
    const result = spawnSync(path.resolve(executable), [], {
        env: {
            ...process.env,
            DESKGAP_ENTRY: path.resolve(__dirname, 'fixtures', 'apps', fixture),
        },
        stdio: 'inherit',
        windowsHide: false,
    })
    if (result.error != null) throw result.error
    if (result.status !== 0) process.exit(result.status == null ? 1 : result.status)
    process.stdout.write('\n')
}
