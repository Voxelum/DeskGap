import { maximumChannelChunkBytes, UnversionedTransportFrame } from './transport-protocol';

export const initialChannelCreditBytes = 256 * 1024;

export interface TransportChannelHooks {
    sendBinary(channelId: number, data: Uint8Array): Promise<void> | void;
    sendControl(frame: UnversionedTransportFrame): void;
}

export class TransportChannel extends EventTarget {
    readonly readable: ReadableStream<Uint8Array>;
    readonly writable: WritableStream<ArrayBuffer | ArrayBufferView>;
    private readableController_: ReadableStreamDefaultController<Uint8Array> | null = null;
    private readonly pendingReads_: Uint8Array[] = [];
    private pendingReadBytes_ = 0;
    private readDemand_ = false;
    private availableSendCredit_ = 0;
    private readonly creditWaiters_: Array<{ resolve(): void; reject(error: Error): void }> = [];
    private closed_ = false;
    private closeError_: Error | null = null;

    constructor(readonly id: number, private readonly hooks_: TransportChannelHooks) {
        super();
        this.readable = new ReadableStream<Uint8Array>({
            start: controller => { this.readableController_ = controller; },
            pull: controller => {
                this.readDemand_ = true;
                this.flushOne_(controller);
            },
            cancel: reason => this.close(1000, String(reason || 'Readable stream cancelled')),
        }, { highWaterMark: 0 });
        this.writable = new WritableStream<ArrayBuffer | ArrayBufferView>({
            write: data => this.write_(toUint8Array(data)),
            close: () => this.close(),
            abort: reason => this.close(1011, String(reason || 'Writable stream aborted')),
        });
        this.sendCredit_(initialChannelCreditBytes);
    }

    close(code = 1000, reason = ''): void {
        if (this.closed_) return;
        this.closed_ = true;
        this.closeError_ = new Error(reason || 'Channel closed');
        this.finishClose_(this.closeError_);
        try {
            this.hooks_.sendControl({ type: 'channel-close', channelId: this.id, code, reason: reason.substring(0, 120) });
        }
        catch (_) { }
    }

    /** @internal */
    receive(data: Uint8Array): void {
        if (this.closed_) return;
        if (data.byteLength === 0 || data.byteLength > maximumChannelChunkBytes ||
            this.pendingReadBytes_ + data.byteLength > initialChannelCreditBytes) {
            this.close(1009, 'Channel receive window exceeded');
            return;
        }
        const copy = data.slice();
        this.pendingReads_.push(copy);
        this.pendingReadBytes_ += copy.byteLength;
        if (this.readDemand_ && this.readableController_ != null) this.flushOne_(this.readableController_);
    }

    /** @internal */
    grantCredit(bytes: number): void {
        if (this.closed_ || !Number.isSafeInteger(bytes) || bytes <= 0) return;
        this.availableSendCredit_ = Math.min(Number.MAX_SAFE_INTEGER, this.availableSendCredit_ + bytes);
        while (this.creditWaiters_.length > 0 && this.availableSendCredit_ > 0) this.creditWaiters_.shift()!.resolve();
    }

    /** @internal */
    remoteClose(code: number, reason: string): void {
        if (this.closed_) return;
        this.closed_ = true;
        this.closeError_ = new Error(reason || 'Channel closed by peer');
        this.finishClose_(this.closeError_);
        this.dispatchEvent(new CustomEvent('close', { detail: { code, reason } }));
    }

    private async write_(data: Uint8Array): Promise<void> {
        if (this.closed_) throw this.closeError_ || new Error('Channel is closed');
        let offset = 0;
        while (offset < data.byteLength) {
            await this.waitForCredit_();
            if (this.closed_) throw this.closeError_ || new Error('Channel is closed');
            const size = Math.min(data.byteLength - offset, this.availableSendCredit_, maximumChannelChunkBytes);
            const chunk = data.slice(offset, offset + size);
            this.availableSendCredit_ -= size;
            await this.hooks_.sendBinary(this.id, chunk);
            offset += size;
        }
    }

    private waitForCredit_(): Promise<void> {
        if (this.availableSendCredit_ > 0) return Promise.resolve();
        return new Promise((resolve, reject) => this.creditWaiters_.push({ resolve, reject }));
    }

    private flushOne_(controller: ReadableStreamDefaultController<Uint8Array>): void {
        if (this.pendingReads_.length === 0 || this.closed_) return;
        const chunk = this.pendingReads_.shift()!;
        this.readDemand_ = false;
        this.pendingReadBytes_ -= chunk.byteLength;
        controller.enqueue(chunk);
        this.sendCredit_(chunk.byteLength);
    }

    private sendCredit_(bytes: number): void {
        this.hooks_.sendControl({ type: 'channel-credit', channelId: this.id, bytes });
    }

    private finishClose_(error: Error): void {
        while (this.creditWaiters_.length > 0) this.creditWaiters_.shift()!.reject(error);
        this.pendingReads_.length = 0;
        this.pendingReadBytes_ = 0;
        try { this.readableController_?.close(); }
        catch (_) { }
    }
}

function toUint8Array(data: ArrayBuffer | ArrayBufferView): Uint8Array {
    if (data instanceof ArrayBuffer) return new Uint8Array(data);
    return new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
}

export function bridgeChannels(first: TransportChannel, second: TransportChannel): () => void {
    const abortController = new AbortController();
    let stopped = false;
    const stop = () => {
        if (stopped) return;
        stopped = true;
        abortController.abort();
        first.close(1000, 'Channel bridge closed');
        second.close(1000, 'Channel bridge closed');
    };
    void Promise.allSettled([
        first.readable.pipeTo(second.writable, { signal: abortController.signal }),
        second.readable.pipeTo(first.writable, { signal: abortController.signal }),
    ]).then(stop);
    return stop;
}
