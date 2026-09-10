import { createHash } from 'node:crypto';
import { createReadStream, createWriteStream } from 'node:fs';
import { lstat, mkdir, open, readdir, rename, rm } from 'node:fs/promises';
import path from 'node:path';
import { Transform } from 'node:stream';
import { finished, pipeline } from 'node:stream/promises';
import { constants, createZstdCompress } from 'node:zlib';
import { pack } from 'tar-stream';
import semver from 'semver';

export function versionedApplicationPackage(packageJSON, version) {
    if (typeof version !== 'string' || semver.valid(version) == null) {
        throw new Error('Application version must be valid semver');
    }
    return {
        data: Buffer.from(`${JSON.stringify({ ...packageJSON, version }, null, 2)}\n`),
        name: 'package.json',
    };
}

export async function collectEntries(rootArgument) {
    const root = path.resolve(rootArgument);
    const result = [];

    async function visit(directory, relativeDirectory) {
        const names = await readdir(directory);
        names.sort((left, right) => left.localeCompare(right, 'en'));
        for (const name of names) {
            const absolutePath = path.join(directory, name);
            const relativePath = relativeDirectory === '' ? name : `${relativeDirectory}/${name}`;
            const metadata = await lstat(absolutePath);
            if (metadata.isSymbolicLink()) throw new Error(`Archive cannot contain symbolic links: ${relativePath}`);
            if (metadata.isDirectory()) {
                await visit(absolutePath, relativePath);
            }
            else if (metadata.isFile()) {
                if (Buffer.byteLength(relativePath) > 255) throw new Error(`Archive path is too long: ${relativePath}`);
                result.push({
                    mode: (metadata.mode & 0o111) !== 0 ? 0o755 : 0o644,
                    name: relativePath,
                    path: absolutePath,
                    size: metadata.size,
                });
            }
            else {
                throw new Error(`Archive contains an unsupported file: ${relativePath}`);
            }
        }
    }

    await visit(root, '');
    return result;
}

export async function createTarZstd(sourceDirectory, outputArgument, compressionLevel = 10, virtualEntries = []) {
    const outputPath = path.resolve(outputArgument);
    const temporaryPath = `${outputPath}.${process.pid}.tmp`;
    const virtualNames = new Set(virtualEntries.map(entry => entry.name));
    if (virtualNames.size !== virtualEntries.length) throw new Error('Archive contains duplicate virtual paths');
    const entries = (await collectEntries(sourceDirectory)).filter(entry => !virtualNames.has(entry.name));
    for (const entry of virtualEntries) {
        if (typeof entry.name !== 'string' || !Buffer.isBuffer(entry.data) || /[\t\r\n]/.test(entry.name)) {
            throw new Error('Archive virtual entry is invalid');
        }
        entries.push({ data: entry.data, mode: entry.mode || 0o644, name: entry.name, size: entry.data.length });
    }
    entries.sort((left, right) => left.name.localeCompare(right.name, 'en'));
    const unpackedSize = entries.reduce((sum, entry) => sum + entry.size, 0);

    await mkdir(path.dirname(outputPath), { recursive: true });
    const archive = pack();
    const compressedOutput = pipeline(
        archive,
        createZstdCompress({ params: { [constants.ZSTD_c_compressionLevel]: compressionLevel } }),
        createWriteStream(temporaryPath, { flags: 'wx' }),
    );

    try {
        for (const entry of entries) {
            const header = {
                gid: 0,
                gname: '',
                mode: entry.mode,
                mtime: new Date(0),
                name: entry.name,
                size: entry.size,
                type: 'file',
                uid: 0,
                uname: '',
            };
            if (entry.data) {
                entry.sha256 = sha256Bytes(entry.data);
                await new Promise((resolve, reject) => {
                    archive.entry(header, entry.data, error => error ? reject(error) : resolve());
                });
            }
            else {
                const hash = createHash('sha256');
                const hashingStream = new Transform({
                    transform(chunk, _encoding, callback) {
                        hash.update(chunk);
                        callback(null, chunk);
                    },
                });
                await pipeline(createReadStream(entry.path), hashingStream, archive.entry(header));
                entry.sha256 = hash.digest('hex');
            }
        }
        archive.finalize();
        await compressedOutput;
        await rm(outputPath, { force: true });
        await rename(temporaryPath, outputPath);
    }
    catch (error) {
        archive.destroy(error instanceof Error ? error : new Error('Archive packaging failed'));
        await compressedOutput.catch(() => {});
        await rm(temporaryPath, { force: true }).catch(() => {});
        throw error;
    }

    return {
        entries,
        outputPath,
        sha256: await sha256File(outputPath),
        size: (await lstat(outputPath)).size,
        unpackedSize,
    };
}

export async function fileManifest(entries, section) {
    const lines = [];
    for (const entry of entries) {
        if (/[\t\r\n]/.test(entry.name)) throw new Error(`Archive path cannot be represented in the manifest: ${entry.name}`);
        if (typeof entry.sha256 !== 'string') throw new Error(`Archive entry was not hashed while packaging: ${entry.name}`);
        lines.push(`${section}\t${entry.sha256}\t${entry.size}\t${entry.name}\n`);
    }
    return lines.join('');
}

export async function appendFile(output, inputPath) {
    const input = await open(inputPath, 'r');
    const buffer = Buffer.allocUnsafe(1024 * 1024);
    try {
        while (true) {
            const { bytesRead } = await input.read(buffer, 0, buffer.length);
            if (bytesRead === 0) break;
            await output.write(buffer, 0, bytesRead);
        }
    }
    finally {
        await input.close();
    }
}

export async function sha256File(filePath) {
    const hash = createHash('sha256');
    const input = createReadStream(filePath);
    input.on('data', chunk => hash.update(chunk));
    await finished(input);
    return hash.digest('hex');
}

export function sha256Bytes(value) {
    return createHash('sha256').update(value).digest('hex');
}
