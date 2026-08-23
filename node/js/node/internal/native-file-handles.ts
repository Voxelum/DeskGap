import { randomBytes } from 'crypto';
import { lstatSync } from 'fs';
import path = require('path');

const defaultLifetimeMs = 5 * 60 * 1000;
const maximumHandles = 256;

export interface NativeFileDropEntry {
    handle: string;
    kind: 'file' | 'directory';
    name: string;
    size: number | null;
}

interface NativeFileCapability {
    device: number;
    expiresAt: number;
    inode: number;
    kind: 'file' | 'directory';
    navigationGeneration: number;
    path: string;
}

export class NativeFileHandleRegistry {
    private readonly capabilities_ = new Map<string, NativeFileCapability>();

    constructor(
        private readonly lifetimeMs_ = defaultLifetimeMs,
        private readonly now_: () => number = Date.now,
    ) {}

    issue(paths: string[], navigationGeneration: number): NativeFileDropEntry[] {
        this.prune_();
        const entries: NativeFileDropEntry[] = [];
        for (const nativePath of paths.slice(0, maximumHandles)) {
            let stat;
            try {
                stat = lstatSync(nativePath);
            }
            catch (_) {
                continue;
            }
            if (!stat.isFile() && !stat.isDirectory()) continue;

            while (this.capabilities_.size >= maximumHandles) {
                const oldestHandle = this.capabilities_.keys().next().value;
                if (oldestHandle == null) break;
                this.capabilities_.delete(oldestHandle);
            }
            const handle = `dgfile_${randomBytes(32).toString('base64url')}`;
            this.capabilities_.set(handle, {
                device: stat.dev,
                expiresAt: this.now_() + this.lifetimeMs_,
                inode: stat.ino,
                kind: stat.isDirectory() ? 'directory' : 'file',
                navigationGeneration,
                path: path.resolve(nativePath),
            });
            entries.push({
                handle,
                kind: stat.isDirectory() ? 'directory' : 'file',
                name: path.basename(nativePath),
                size: stat.isFile() ? stat.size : null,
            });
        }
        return entries;
    }

    resolve(handle: string, navigationGeneration: number): string {
        const capability = this.capabilities_.get(handle);
        if (capability == null || capability.navigationGeneration !== navigationGeneration) {
            throw new Error('Native file handle is invalid for this window navigation');
        }
        if (capability.expiresAt < this.now_()) {
            this.capabilities_.delete(handle);
            throw new Error('Native file handle has expired');
        }
        let stat;
        try {
            stat = lstatSync(capability.path);
        }
        catch (_) {
            this.capabilities_.delete(handle);
            throw new Error('Native file handle target no longer exists');
        }
        const kind = stat.isDirectory() ? 'directory' : stat.isFile() ? 'file' : null;
        if (kind !== capability.kind || stat.dev !== capability.device || stat.ino !== capability.inode) {
            this.capabilities_.delete(handle);
            throw new Error('Native file handle target has been replaced');
        }
        return capability.path;
    }

    revokeAll(): void {
        this.capabilities_.clear();
    }

    private prune_(): void {
        const now = this.now_();
        for (const [handle, capability] of this.capabilities_) {
            if (capability.expiresAt < now) this.capabilities_.delete(handle);
        }
    }
}
