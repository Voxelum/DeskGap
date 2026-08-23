const fs = require('fs');
const path = require('path');

const testDir = path.join(__dirname, 'api-tests');

const testFiles = fs.readdirSync(testDir)
    .filter(filename => filename.endsWith('.js'))
    .map(filename => path.join(testDir, filename));

for (const file of testFiles) {
    require(file);
}
