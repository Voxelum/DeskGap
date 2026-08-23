export const transportProtocolVersion = 1;
export const maximumTransportFrameBytes = 1024 * 1024;
const binaryHeaderBytes = 8;
export const maximumChannelChunkBytes = maximumTransportFrameBytes - binaryHeaderBytes;

export interface AuthenticateFrame {
    version: typeof transportProtocolVersion;
    type: 'authenticate';
    token: string;
}

export interface AuthenticatedFrame {
    version: typeof transportProtocolVersion;
    type: 'authenticated';
    navigationGeneration: number;
    windowId: number;
}

export interface NativeFileDropFrame {
    version: typeof transportProtocolVersion;
    type: 'native-file-drop';
    entries: unknown[];
}

export interface ChannelOpenFrame {
    version: typeof transportProtocolVersion;
    type: 'channel-open';
    channelId: number;
}

export interface ChannelCreditFrame {
    version?: typeof transportProtocolVersion;
    type: 'channel-credit';
    channelId: number;
    bytes: number;
}

export interface ChannelCloseFrame {
    version?: typeof transportProtocolVersion;
    type: 'channel-close';
    channelId: number;
    code: number;
    reason: string;
}

export type TransportFrame = AuthenticateFrame | AuthenticatedFrame | NativeFileDropFrame |
    ChannelOpenFrame | (ChannelCreditFrame & { version: typeof transportProtocolVersion }) |
    (ChannelCloseFrame & { version: typeof transportProtocolVersion });
type WithoutVersion<Frame> = Frame extends any ? Omit<Frame, 'version'> : never;
export type UnversionedTransportFrame = WithoutVersion<TransportFrame>;

export function encodeTransportFrame(frame: UnversionedTransportFrame): string {
    return JSON.stringify({ version: transportProtocolVersion, ...frame });
}

export function decodeTransportFrame(serialized: string): TransportFrame {
    let value: any;
    try {
        value = JSON.parse(serialized);
    }
    catch (_) {
        throw new Error('Transport frame is not valid JSON');
    }
    if (value == null || typeof value !== 'object' || Array.isArray(value)) {
        throw new Error('Transport frame must be an object');
    }
    if (value.version !== transportProtocolVersion) {
        throw new Error(`Unsupported transport protocol version: ${value.version}`);
    }
    switch (value.type) {
    case 'authenticate':
        if (typeof value.token !== 'string') throw new Error('Authentication frame requires a token');
        return value;
    case 'authenticated':
        if (!Number.isSafeInteger(value.windowId) || !Number.isSafeInteger(value.navigationGeneration)) {
            throw new Error('Authenticated frame has invalid window identity');
        }
        return value;
    case 'native-file-drop':
        if (!Array.isArray(value.entries)) throw new Error('Native file drop frame requires entries');
        return value;
    case 'channel-open':
        validateChannelId(value.channelId);
        return value;
    case 'channel-credit':
        validateChannelId(value.channelId);
        if (!Number.isSafeInteger(value.bytes) || value.bytes <= 0 || value.bytes > maximumTransportFrameBytes) {
            throw new Error('Channel credit is invalid');
        }
        return value;
    case 'channel-close':
        validateChannelId(value.channelId);
        if (!Number.isInteger(value.code) || value.code < 0 || value.code > 4999 || typeof value.reason !== 'string' || value.reason.length > 120) {
            throw new Error('Channel close frame is invalid');
        }
        return value;
    default:
        throw new Error(`Unsupported transport frame type: ${value.type}`);
    }
}

export function encodeChannelDataFrame(channelId: number, payload: Uint8Array): ArrayBuffer {
    validateChannelId(channelId);
    if (payload.byteLength === 0 || payload.byteLength > maximumChannelChunkBytes) {
        throw new Error('Channel payload size is invalid');
    }
    const frame = new Uint8Array(binaryHeaderBytes + payload.byteLength);
    frame[0] = 0x44;
    frame[1] = 0x47;
    frame[2] = transportProtocolVersion;
    frame[3] = 1;
    new DataView(frame.buffer).setUint32(4, channelId, true);
    frame.set(payload, binaryHeaderBytes);
    return frame.buffer;
}

export function decodeChannelDataFrame(frame: ArrayBuffer | ArrayBufferView): { channelId: number; payload: Uint8Array } {
    const bytes = frame instanceof ArrayBuffer
        ? new Uint8Array(frame)
        : new Uint8Array(frame.buffer, frame.byteOffset, frame.byteLength);
    if (bytes.byteLength <= binaryHeaderBytes || bytes.byteLength > maximumTransportFrameBytes ||
        bytes[0] !== 0x44 || bytes[1] !== 0x47 || bytes[2] !== transportProtocolVersion || bytes[3] !== 1) {
        throw new Error('Invalid binary channel frame');
    }
    const channelId = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint32(4, true);
    validateChannelId(channelId);
    return { channelId, payload: bytes.slice(binaryHeaderBytes) };
}

function validateChannelId(channelId: unknown): asserts channelId is number {
    if (!Number.isSafeInteger(channelId) || (channelId as number) <= 0 || (channelId as number) > 0xffffffff) {
        throw new Error('Channel id is invalid');
    }
}
