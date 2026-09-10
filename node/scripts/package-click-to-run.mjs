import { chmod, mkdir, open, readFile, rename, rm } from 'node:fs/promises';
import path from 'node:path';
import { appendFile, createTarZstd, fileManifest, versionedApplicationPackage } from './archive.mjs';

const [bootstrapArgument, runtimeDirectoryArgument, applicationDirectoryArgument, outputArgument, versionArgument, entryArgument = 'DeskGap.exe'] = process.argv.slice(2);
if (!bootstrapArgument || !runtimeDirectoryArgument || !applicationDirectoryArgument || !outputArgument || !versionArgument) {
    throw new Error('Usage: node package-click-to-run.mjs <bootstrap.exe> <runtime-directory> <application-directory> <output.exe> <version> [runtime-entry]');
}

const bootstrapPath = path.resolve(bootstrapArgument);
const runtimeDirectory = path.resolve(runtimeDirectoryArgument);
const applicationDirectory = path.resolve(applicationDirectoryArgument);
const outputPath = path.resolve(outputArgument);
await assertUnsignedBootstrap(bootstrapPath);
const packageJSON = JSON.parse(await readFile(path.join(applicationDirectory, 'package.json'), 'utf8'));
const appName = packageJSON.productName || packageJSON.name;
if (!safeComponent(appName)) throw new Error('Application productName or name is not safe for local installation');
if (!safeRelativePath(entryArgument)) throw new Error('Runtime entry path is unsafe');
if (!/^[0-9A-Za-z.+_-]+$/.test(versionArgument)) throw new Error('Application version contains unsupported characters');
const applicationPackage = versionedApplicationPackage(packageJSON, versionArgument);

await mkdir(path.dirname(outputPath), { recursive: true });
const runtimeArchivePath = `${outputPath}.${process.pid}.runtime.tar.zst`;
const applicationArchivePath = `${outputPath}.${process.pid}.application.tar.zst`;
const temporaryOutputPath = `${outputPath}.${process.pid}.tmp`;

try {
    const identity = Buffer.from(`${JSON.stringify({ name: packageJSON.name, productName: appName, version: versionArgument })}\n`);
    const runtime = await createTarZstd(runtimeDirectory, runtimeArchivePath, 10, [{
        data: identity,
        name: 'resources/app-identity.json',
    }]);
    const application = await createTarZstd(applicationDirectory, applicationArchivePath, 10, [applicationPackage]);
    if (application.entries.some(entry => entry.name.toLowerCase() === '.deskgap-payload.json')) {
        throw new Error('Application payload cannot contain the reserved .deskgap-payload.json marker');
    }
    const unsafeEntry = [...runtime.entries, ...application.entries].find(entry => !safeRelativePath(entry.name));
    if (unsafeEntry) throw new Error(`Click-to-run payload contains a Windows-unsafe path: ${unsafeEntry.name}`);
    if (!runtime.entries.some(entry => entry.name === entryArgument)) {
        throw new Error(`Runtime archive does not contain entry executable: ${entryArgument}`);
    }

    const manifest = Buffer.from(
        await fileManifest(runtime.entries, 'R') + await fileManifest(application.entries, 'A'),
        'utf8',
    );
    const appNameBytes = Buffer.from(appName, 'utf8');
    const entryBytes = Buffer.from(entryArgument, 'utf8');
    const versionBytes = Buffer.from(versionArgument, 'utf8');
    for (const [label, value] of [['application name', appNameBytes], ['runtime entry', entryBytes], ['version', versionBytes], ['manifest', manifest]]) {
        if (value.length > 0xffffffff) throw new Error(`Click-to-run ${label} is too large`);
    }

    const footer = Buffer.alloc(108);
    footer.write('DGCLK001', 0, 'ascii');
    footer.writeUInt32LE(1, 8);
    footer.writeUInt32LE(appNameBytes.length, 12);
    footer.writeUInt32LE(entryBytes.length, 16);
    footer.writeUInt32LE(versionBytes.length, 20);
    footer.writeUInt32LE(manifest.length, 24);
    footer.writeBigUInt64LE(BigInt(runtime.size), 28);
    footer.writeBigUInt64LE(BigInt(application.size), 36);
    Buffer.from(runtime.sha256, 'hex').copy(footer, 44);
    Buffer.from(application.sha256, 'hex').copy(footer, 76);

    const output = await open(temporaryOutputPath, 'wx', 0o755);
    try {
        await appendFile(output, bootstrapPath);
        await appendFile(output, runtimeArchivePath);
        await appendFile(output, applicationArchivePath);
        await output.write(appNameBytes);
        await output.write(entryBytes);
        await output.write(versionBytes);
        await output.write(manifest);
        await output.write(footer);
        await output.sync();
    }
    finally {
        await output.close();
    }

    await rm(outputPath, { force: true });
    await rename(temporaryOutputPath, outputPath);
    await chmod(outputPath, 0o755);
    console.log(JSON.stringify({
        application: { sha256: application.sha256, size: application.size, unpackedSize: application.unpackedSize },
        output: outputPath,
        runtime: { sha256: runtime.sha256, size: runtime.size, unpackedSize: runtime.unpackedSize },
        size: (await open(outputPath, 'r').then(async file => {
            try { return (await file.stat()).size; }
            finally { await file.close(); }
        })),
    }));
}
catch (error) {
    await rm(temporaryOutputPath, { force: true }).catch(() => {});
    throw error;
}
finally {
    await Promise.all([
        rm(runtimeArchivePath, { force: true }),
        rm(applicationArchivePath, { force: true }),
    ]);
}

function safeComponent(value) {
    if (typeof value !== 'string' || value === '' || value === '.' || value === '..' ||
        /[\\/:*?"<>|\x00-\x1f]/.test(value) || /[. ]$/.test(value)) return false;
    const stem = value.split('.')[0].toLowerCase();
    return !/^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/.test(stem);
}

function safeRelativePath(value) {
    if (typeof value !== 'string' || value === '' || value.includes('\\') || value.startsWith('/')) return false;
    return value.split('/').every(safeComponent);
}

async function assertUnsignedBootstrap(filePath) {
    const file = await open(filePath, 'r');
    try {
        const dos = Buffer.alloc(64);
        const { bytesRead } = await file.read(dos, 0, dos.length, 0);
        if (bytesRead < 2 || dos.readUInt16LE(0) !== 0x5a4d) return;
        if (bytesRead !== dos.length) throw new Error('Bootstrap PE header is truncated');
        const peOffset = dos.readUInt32LE(0x3c);
        const pe = Buffer.alloc(24);
        if (peOffset < 64 || (await file.read(pe, 0, pe.length, peOffset)).bytesRead !== pe.length ||
            pe.readUInt32LE(0) !== 0x4550) {
            throw new Error('Bootstrap PE header is invalid');
        }
        const optional = Buffer.alloc(pe.readUInt16LE(20));
        if (optional.length < 2 ||
            (await file.read(optional, 0, optional.length, peOffset + pe.length)).bytesRead !== optional.length) {
            throw new Error('Bootstrap optional PE header is truncated');
        }
        const magic = optional.readUInt16LE(0);
        const directories = magic === 0x20b ? 112 : magic === 0x10b ? 96 : 0;
        if (directories === 0 || optional.length < directories) throw new Error('Bootstrap optional PE header is invalid');
        if (optional.readUInt32LE(directories - 4) <= 4) return;
        const security = directories + 4 * 8;
        if (optional.length < security + 8) throw new Error('Bootstrap SECURITY directory is truncated');
        if (optional.readUInt32LE(security) !== 0 || optional.readUInt32LE(security + 4) !== 0) {
            throw new Error('Bootstrap must be unsigned; assemble the complete click-to-run EXE before Authenticode signing');
        }
    }
    finally {
        await file.close();
    }
}
