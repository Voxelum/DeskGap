import { externalWindowNative } from './internal/native';

export interface ExternalWindowBounds {
    height: number;
    width: number;
    x: number;
    y: number;
}

export interface MoveExternalWindowOptions {
    coordinateSpace?: 'dip' | 'screen';
    signal?: AbortSignal;
    timeout?: number;
}

function validateBounds(bounds: ExternalWindowBounds): void {
    if (bounds == null || !Number.isFinite(bounds.x) || !Number.isFinite(bounds.y)
        || !Number.isFinite(bounds.width) || !Number.isFinite(bounds.height)
        || bounds.width <= 0 || bounds.height <= 0) {
        throw new TypeError('External window bounds must contain finite coordinates and positive dimensions');
    }
}

function unsupportedError(): Error & { code: string } {
    return Object.assign(new Error('External window management is not supported in this environment'), {
        code: 'ERR_EXTERNAL_WINDOW_UNSUPPORTED',
    });
}

export const externalWindow = {
    isSupported(): boolean {
        return externalWindowNative.isSupported();
    },

    async moveAndResize(processId: number, bounds: ExternalWindowBounds, options: MoveExternalWindowOptions = {}): Promise<void> {
        if (!this.isSupported()) throw unsupportedError();
        const { app } = require('./app') as typeof import('./app');
        if (!app.isReady()) throw new Error('External window operations require app readiness');
        if (!Number.isInteger(processId) || processId <= 0 || processId > 0xffffffff) {
            throw new TypeError('External window processId must be a positive 32-bit integer');
        }
        validateBounds(bounds);
        const timeout = options.timeout == null ? 15000 : options.timeout;
        if (!Number.isFinite(timeout) || timeout < 0 || timeout > 300000) {
            throw new RangeError('External window timeout must be between 0 and 300000 milliseconds');
        }
        const coordinateSpace = options.coordinateSpace || (process.platform === 'win32' ? 'dip' : 'screen');
        if (coordinateSpace !== 'dip' && coordinateSpace !== 'screen') {
            throw new TypeError(`Unsupported external window coordinate space: ${coordinateSpace}`);
        }
        if (options.signal?.aborted) throw new DOMException('External window operation was cancelled', 'AbortError');

        const operation = externalWindowNative.moveAndResize(
            processId,
            bounds.x,
            bounds.y,
            bounds.width,
            bounds.height,
            Math.round(timeout),
            coordinateSpace === 'dip',
        );
        const abort = () => operation.cancel();
        options.signal?.addEventListener('abort', abort, { once: true });
        try {
            await operation.promise;
        }
        catch (error) {
            if (options.signal?.aborted) throw new DOMException('External window operation was cancelled', 'AbortError');
            throw error;
        }
        finally {
            options.signal?.removeEventListener('abort', abort);
        }
    },
};