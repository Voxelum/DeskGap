const path = require('path');
const fs = require('fs');
const { downloadFile, sha256OfPath } = require('./util');
const decompress = require('decompress');
const fse = require('fs-extra');

process.on('unhandledRejection', (error) => {
    throw error;
});

let deskGapPlatform = null;
if (
    (process.platform === 'darwin' || process.platform === 'win32' || process.platform === 'linux') &&
    process.arch === 'x64'
) {
    deskGapPlatform = `${process.platform}-${process.arch}`;
}

if (deskGapPlatform == null) {
    console.error(`DeskGap doesn't support your platform: ${process.platform}-${process.arch}`);
    process.exit(1);
}

const distInfoPath = path.join(__dirname, 'dist_files', `${deskGapPlatform}.json`);
if (!fs.existsSync(distInfoPath)) {
    console.error(`This DeskGap package does not include a runtime for ${deskGapPlatform}.`);
    process.exit(1);
}
const distZipFile = require(distInfoPath);
const distZipFilePath = path.join(__dirname, distZipFile.filename);

(async () => {
    try {
        fs.unlinkSync(distZipFilePath);
    } catch (e) { }

    await downloadFile(distZipFile.filename, distZipFilePath);
    const sha256 = await sha256OfPath(distZipFilePath);
    if (sha256 !== distZipFile.sha256) {
        console.error(`SHA256 mismatch (${sha256} !== ${distZipFile.sha256})`);
        process.exit(1);
    }

    try {
        await fse.remove('dist');
    }
    catch (e) { }

    await decompress(distZipFilePath, 'dist');
    fs.unlinkSync(distZipFilePath);
})().catch(e => {
    console.error(e.stack || e.toString());
    process.exit(1);
});
