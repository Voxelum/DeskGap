import { cp, mkdir, readdir, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { spawnSync } from 'node:child_process';

const excludedArchiveParts = [
    'benchmark',
    'gtest',
    'icutools',
    'node_text_start',
    'v8_init',
    'v8_nosnapshot'
];

const nodeConfigureFlags = [
    '--without-amaro',
    '--without-inspector'
];

function run(command, args, options = {}) {
    const result = spawnSync(command, args, {
        cwd: options.cwd,
        env: options.env ?? process.env,
        input: options.input,
        shell: false,
        stdio: options.input == null ? 'inherit' : ['pipe', 'inherit', 'inherit'],
        encoding: 'utf8'
    });

    if (result.error != null) throw result.error;
    if (result.status !== 0) {
        throw new Error(`${command} exited with status ${result.status}`);
    }
}

function parseArguments(argv) {
    if (argv.includes('--help')) {
        console.log('Usage: node build.mjs --source <path> --install <path> --arch <x86|x64|arm64>');
        process.exit(0);
    }

    const values = new Map();
    for (let index = 0; index < argv.length; index += 2) {
        const key = argv[index];
        const value = argv[index + 1];
        if (!['--source', '--install', '--arch'].includes(key) || value == null) {
            throw new Error(`Invalid argument: ${key ?? ''}`);
        }
        values.set(key, value);
    }

    const source = values.get('--source');
    const install = values.get('--install');
    const arch = values.get('--arch');
    if (source == null || install == null || !['x86', 'x64', 'arm64'].includes(arch)) {
        throw new Error('Required arguments: --source <path> --install <path> --arch <x86|x64|arm64>');
    }

    return {
        source: path.resolve(source),
        install: path.resolve(install),
        arch
    };
}

function windowsBuildEnvironment() {
    const whereResult = spawnSync('where.exe', ['python.exe'], { encoding: 'utf8' });
    if (whereResult.status !== 0) return process.env;

    const python = whereResult.stdout.split(/\r?\n/).find(candidate => candidate.length > 0);
    if (python == null) return process.env;

    const shortPathResult = spawnSync(
        'cmd.exe',
        ['/d', '/s', '/c', `for %I in ("${python}") do @echo %~sI`],
        { encoding: 'utf8', windowsVerbatimArguments: true }
    );
    if (shortPathResult.status !== 0) return process.env;

    const shortPath = shortPathResult.stdout.trim();
    if (shortPath.length === 0 || shortPath.includes(' ')) return process.env;

    return {
        ...process.env,
        PATH: `${path.dirname(shortPath)};${process.env.PATH ?? ''}`
    };
}

async function walk(directory) {
    const entries = await readdir(directory, { withFileTypes: true });
    const paths = await Promise.all(entries.map(async entry => {
        const entryPath = path.join(directory, entry.name);
        return entry.isDirectory() ? walk(entryPath) : [entryPath];
    }));
    return paths.flat();
}

async function buildNode(source, arch) {
    if (process.platform === 'win32') {
        const env = windowsBuildEnvironment();
        run(
            'cmd.exe',
            ['/d', '/s', '/c', 'vcbuild.bat', 'static', 'without-intl', arch, 'nosign'],
            {
                cwd: source,
                env: {
                    ...env,
                    config_flags: [env.config_flags, ...nodeConfigureFlags].filter(Boolean).join(' ')
                }
            }
        );
        return;
    }

    run('./configure', ['--enable-static', '--without-intl', ...nodeConfigureFlags], { cwd: source });
    run('make', [`-j${Math.min(os.availableParallelism(), 4)}`], { cwd: source });
}

async function copyHeaders(source, install) {
    const destination = path.join(install, 'include', 'node');
    await mkdir(destination, { recursive: true });

    for (const filename of ['config.gypi', 'common.gypi']) {
        await cp(path.join(source, filename), path.join(destination, filename));
    }

    const sourceHeaders = (await readdir(path.join(source, 'src')))
        .filter(filename => filename.endsWith('.h'));
    await Promise.all(sourceHeaders.map(filename =>
        cp(path.join(source, 'src', filename), path.join(destination, filename))
    ));

    const headerTrees = [
        ['deps/v8/include', ''],
        ['deps/uv/include', ''],
        ['deps/openssl/openssl/include/openssl', 'openssl'],
        ['deps/openssl/config', 'openssl']
    ];
    for (const [relativeSource, relativeDestination] of headerTrees) {
        await cp(
            path.join(source, relativeSource),
            path.join(destination, relativeDestination),
            { recursive: true, filter: candidate => !path.extname(candidate) || candidate.endsWith('.h') }
        );
    }

    for (const filename of ['zconf.h', 'zlib.h']) {
        await cp(path.join(source, 'deps', 'zlib', filename), path.join(destination, filename));
    }
}

function shouldIncludeArchive(archivePath) {
    const normalized = archivePath.toLowerCase();
    return !excludedArchiveParts.some(part => normalized.includes(part));
}

async function collectBuildProducts(source) {
    const releaseDirectory = path.join(source, 'out', 'Release');
    const files = await walk(releaseDirectory);
    const archiveExtension = process.platform === 'win32' ? '.lib' : '.a';
    const objectExtension = process.platform === 'win32' ? '.obj' : '.o';

    return {
        archives: files
            .filter(file => path.extname(file) === archiveExtension)
            .filter(file => process.platform !== 'win32' || path.dirname(file) === path.join(releaseDirectory, 'lib'))
            .filter(shouldIncludeArchive)
            .sort(),
        objects: files
            .filter(file => path.extname(file) === objectExtension)
            .filter(file => ['node_snapshot', 'node_text_start'].includes(path.basename(file, objectExtension)))
            .sort()
    };
}

async function mergeArchives(archives, objects, output) {
    await mkdir(path.dirname(output), { recursive: true });
    await rm(output, { force: true });

    if (process.platform === 'win32') {
        const responseFile = output.replace(/\.lib$/, '.rsp');
        await writeFile(responseFile, [...archives, ...objects].map(file => `"${file}"`).join('\n'));
        try {
            run('lib.exe', [`/OUT:${output}`, `@${responseFile}`]);
        }
        finally {
            await rm(responseFile, { force: true });
        }
        return;
    }

    if (process.platform === 'darwin') {
        run('libtool', ['-static', '-o', output, ...archives, ...objects]);
        return;
    }

    const script = [
        `CREATE ${output}`,
        ...archives.map(archive => `ADDLIB ${archive}`),
        ...objects.map(object => `ADDMOD ${object}`),
        'SAVE',
        'END',
        ''
    ].join('\n');
    run('ar', ['-M'], { input: script });
}

async function main() {
    const { source, install, arch } = parseArguments(process.argv.slice(2));
    await rm(install, { force: true, recursive: true });
    await buildNode(source, arch);
    await copyHeaders(source, install);

    const { archives, objects } = await collectBuildProducts(source);
    if (archives.length === 0) throw new Error('Node.js build produced no static libraries');

    const extension = process.platform === 'win32' ? '.lib' : '.a';
    await mergeArchives(archives, objects, path.join(install, 'lib', `libnode${extension}`));
}

await main();