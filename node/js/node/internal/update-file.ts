import { createHash } from 'crypto';
import { createReadStream } from 'fs';
import { lstat, realpath } from 'fs/promises';
import path = require('path');

export async function fileVerificationFailure(filePath: string, size: number | undefined, sha256: string): Promise<string | null> {
    const metadata = await lstat(filePath);
    if (!metadata.isFile() || metadata.isSymbolicLink()) return 'artifact is not a regular file';
    if (size !== undefined && metadata.size !== size) return `expected ${size} bytes, received ${metadata.size}`;
    const canonicalParent = await realpath(path.dirname(filePath));
    const canonicalPath = path.join(canonicalParent, path.basename(filePath));
    const normalize = (value: string) => process.platform === 'win32' ? value.toLowerCase() : value;
    if (normalize(await realpath(filePath)) !== normalize(canonicalPath)) return 'artifact path resolves outside its download location';
    const hash = createHash('sha256');
    for await (const chunk of createReadStream(filePath)) hash.update(chunk);
    return hash.digest('hex') === sha256.toLowerCase() ? null : 'SHA-256 mismatch';
}
