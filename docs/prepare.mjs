import { copyFile, rm } from 'node:fs/promises';

await rm(new URL('site', import.meta.url), { force: true, recursive: true });
await copyFile(
    new URL('README.md', import.meta.url),
    new URL('api/index.md', import.meta.url)
);