const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

exports.downloadFile = async (filename, target) => {
    const distFolder = process.env.DESKGAP_DIST_FOLDER;
    if (distFolder != null) {
        await fs.promises.copyFile(path.join(distFolder, filename), target);
        return;
    }

    const version = require('./package.json').version;
    const baseUrl = process.env.DESKGAP_DIST_BASE_URL ||
        `https://github.com/Voxelum/DeskGap/releases/download/v${version}`;
    const response = await fetch(`${baseUrl}/${encodeURIComponent(filename)}`);
    if (!response.ok) {
        throw new Error(`Cannot download ${filename}: HTTP ${response.status}`);
    }

    await fs.promises.writeFile(target, Buffer.from(await response.arrayBuffer()));
};

exports.sha256OfPath = (path) => {
    return new Promise((resolve, reject) => {
        fs.createReadStream(path)
            .once('error', reject)
            .pipe(crypto.createHash('sha256'))
            .on('readable', function () {
                const data = this.read();
                if (data) {
                    resolve(data.toString('hex'));
                }
            });
    });
};
