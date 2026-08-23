function normalizeSwitchName(name: string): string {
    const normalized = name.replace(/^-+/, '');
    if (normalized.length === 0 || /[\s=]/.test(normalized)) {
        throw new TypeError(`Invalid command-line switch: ${name}`);
    }
    return normalized;
}

function quoteArgument(value: string): string {
    return `"${value.replace(/([\\"])/g, '\\$1')}"`;
}

export class CommandLine {
    private readonly appendedSwitches = new Map<string, string>();
    private readonly initialWebView2Arguments = process.env.WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS || '';

    hasSwitch(name: string): boolean {
        const normalized = normalizeSwitchName(name);
        return this.appendedSwitches.has(normalized) || process.argv.slice(1).some(argument =>
            argument === `--${normalized}` || argument.startsWith(`--${normalized}=`)
        );
    }

    getSwitchValue(name: string): string {
        const normalized = normalizeSwitchName(name);
        const appended = this.appendedSwitches.get(normalized);
        if (appended != null) return appended;
        const argument = process.argv.slice(1).find(value => value.startsWith(`--${normalized}=`));
        return argument == null ? '' : argument.substring(normalized.length + 3);
    }

    appendSwitch(name: string, value = ''): void {
        const normalized = normalizeSwitchName(name);
        this.appendedSwitches.set(normalized, String(value));
        this.updateWebView2Arguments();
    }

    removeSwitch(name: string): void {
        this.appendedSwitches.delete(normalizeSwitchName(name));
        this.updateWebView2Arguments();
    }

    private updateWebView2Arguments(): void {
        if (process.platform !== 'win32') return;
        const appended = Array.from(this.appendedSwitches, ([name, value]) =>
            value.length === 0 ? `--${name}` : `--${name}=${quoteArgument(value)}`
        );
        process.env.WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS = [this.initialWebView2Arguments, ...appended]
            .filter(Boolean)
            .join(' ');
    }
}
