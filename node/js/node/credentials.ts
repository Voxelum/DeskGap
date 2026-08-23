import { credentialsNative } from './internal/native';
import { createHash } from 'crypto';

export interface Credential {
    account: string;
    password: string;
}

let applicationScope = 'default';

/** @internal */
export function configureCredentialScope(applicationId: string): void {
    applicationScope = createHash('sha256').update(applicationId).digest('hex').substring(0, 32);
}

function scopedService(service: string): string {
    return `deskgap:${applicationScope}:${service}`;
}

function validate(service: string, account?: string): void {
    if (typeof service !== 'string' || service.length === 0) throw new TypeError('Credential service is required');
    if (account != null && (typeof account !== 'string' || account.length === 0)) {
        throw new TypeError('Credential account is required');
    }
}

export const credentials = {
    async getPassword(service: string, account: string): Promise<string | null> {
        validate(service, account);
        return await credentialsNative.getPassword(scopedService(service), account);
    },

    async setPassword(service: string, account: string, password: string): Promise<void> {
        validate(service, account);
        if (typeof password !== 'string') throw new TypeError('Credential password must be a string');
        await credentialsNative.setPassword(scopedService(service), account, password);
    },

    async deletePassword(service: string, account: string): Promise<boolean> {
        validate(service, account);
        return await credentialsNative.deletePassword(scopedService(service), account);
    },

    async findCredentials(service: string): Promise<Credential[]> {
        validate(service);
        return await credentialsNative.findCredentials(scopedService(service));
    },
};
