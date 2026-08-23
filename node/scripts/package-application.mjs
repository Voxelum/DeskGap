import { readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { createTarZstd } from './archive.mjs';

const [sourceArgument, outputArgument, versionArgument] = process.argv.slice(2);
if (!sourceArgument || !outputArgument) {
    throw new Error('Usage: node package-application.mjs <source-directory> <output.tar.zst> [version]');
}

const sourceDirectory = path.resolve(sourceArgument);
const outputPath = path.resolve(outputArgument);
const packageJSON = JSON.parse(await readFile(path.join(sourceDirectory, 'package.json'), 'utf8'));
const version = versionArgument || packageJSON.version;
if (typeof version !== 'string' || version === '') {
    throw new Error('Application version must be provided or declared in package.json');
}

const archive = await createTarZstd(sourceDirectory, outputPath);
if (archive.entries.some(entry => entry.name.toLowerCase() === '.deskgap-payload.json')) {
    await rm(outputPath, { force: true });
    throw new Error('Application payload cannot contain the reserved .deskgap-payload.json marker');
}
const metadata = {
    arch: process.arch,
    format: 'tar.zst',
    name: path.basename(outputPath),
    platform: process.platform,
    requiredRuntimeApi: 1,
    sha256: archive.sha256,
    size: archive.size,
    type: 'application',
    unpackedSize: archive.unpackedSize,
};
await writeFile(`${outputPath}.metadata.json`, `${JSON.stringify({ version, asset: metadata }, null, 2)}\n`);
console.log(JSON.stringify({ version, asset: metadata }));
