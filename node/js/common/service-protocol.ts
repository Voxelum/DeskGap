export function isValidServiceName(serviceName: string): boolean {
    return /^[a-z0-9](?:[a-z0-9._-]*[a-z0-9])?$/.test(serviceName);
}

export function parseServiceURL(value: string): { serviceName: string; pathname: string; search: string } {
    if (!/^service:/i.test(value)) throw new TypeError('DeskGap service fetch only accepts service: URLs');
    const match = /^service:\/\/([^/?#]*)(.*)$/i.exec(value);
    if (match == null || !isValidServiceName(match[1])) {
        throw new TypeError('DeskGap service URLs require a service name without credentials or a port');
    }
    // Older WebViews treat unknown schemes as opaque URLs with an empty hostname.
    // Parse only the path using a standard scheme; the service name is not a DNS name.
    const suffix = match[2].startsWith('/') ? match[2] : `/${match[2]}`;
    const parsed = new URL(`https://service.invalid${suffix}`);
    return { serviceName: match[1], pathname: parsed.pathname, search: parsed.search };
}
