export const invokeServiceName = 'deskgap.invoke';
export const maximumInvokeBodyBytes = 1024 * 1024;

export interface InvokeRequest<Args = unknown> {
    args: Args;
}

export interface InvokeSuccess<Result = unknown> {
    value: Result;
}

export interface InvokeFailure {
    error: {
        code?: string;
        details?: unknown;
        message: string;
        name: string;
    };
}

export function validateInvokeName(name: string): void {
    if (typeof name !== 'string' || !/^[a-z0-9](?:[a-z0-9._:-]*[a-z0-9])?$/i.test(name)) {
        throw new TypeError('Invoke handler name must contain only letters, digits, dots, colons, hyphens, and underscores');
    }
}

export function serializeInvokeValue(value: unknown): string {
    assertJSONCompatible(value, new WeakSet<object>());
    let serialized: string | undefined;
    try { serialized = JSON.stringify(value); }
    catch (_) { throw new TypeError('Invoke values must be JSON-compatible'); }
    if (serialized == null) throw new TypeError('Invoke values must be JSON-compatible');
    const size = new TextEncoder().encode(serialized).byteLength;
    if (size > maximumInvokeBodyBytes) throw new RangeError('Invoke payload exceeds the 1 MiB limit');
    return serialized;
}

function assertJSONCompatible(value: unknown, seen: WeakSet<object>): void {
    if (value === null || typeof value === 'string' || typeof value === 'boolean') return;
    if (typeof value === 'number') {
        if (!Number.isFinite(value)) throw new TypeError('Invoke numbers must be finite');
        return;
    }
    if (typeof value !== 'object') throw new TypeError('Invoke values must be JSON-compatible');
    if (seen.has(value)) throw new TypeError('Invoke values cannot contain cycles');
    seen.add(value);
    if (Array.isArray(value)) {
        for (const item of value) assertJSONCompatible(item, seen);
    }
    else {
        const prototype = Object.getPrototypeOf(value);
        if (prototype !== Object.prototype && prototype !== null) {
            throw new TypeError('Invoke objects must be plain objects');
        }
        for (const item of Object.values(value as Record<string, unknown>)) assertJSONCompatible(item, seen);
    }
    seen.delete(value);
}

export async function readInvokeJSON(message: Request | Response): Promise<any> {
    const contentLength = Number(message.headers.get('content-length'));
    if (Number.isFinite(contentLength) && contentLength > maximumInvokeBodyBytes) {
        throw new Error('Invoke payload exceeds the 1 MiB limit');
    }
    if (message.body == null) throw new Error('Invoke payload has no body');
    const reader = message.body.getReader();
    const chunks: Uint8Array[] = [];
    let size = 0;
    try {
        while (true) {
            const { value, done } = await reader.read();
            if (done) break;
            size += value.byteLength;
            if (size > maximumInvokeBodyBytes) throw new Error('Invoke payload exceeds the 1 MiB limit');
            chunks.push(value);
        }
    }
    finally {
        await reader.cancel().catch(() => {});
    }
    const bytes = new Uint8Array(size);
    let offset = 0;
    for (const chunk of chunks) {
        bytes.set(chunk, offset);
        offset += chunk.byteLength;
    }
    try { return JSON.parse(new TextDecoder().decode(bytes)); }
    catch (_) { throw new Error('Invoke payload is not valid JSON'); }
}
