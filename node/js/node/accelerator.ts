
const acceleratorTokenAliases = {
    'command': 'cmd',
    'control': 'ctrl',
    'return': 'enter',
    'escape': 'esc',
    'cmdorctrl': (process.platform === 'darwin') ? 'cmd': 'ctrl',
    'alt': (process.platform === 'darwin') ? 'option': 'alt',
    'plus': '+'
} as Record<string, string>;

acceleratorTokenAliases['commandorcontrol'] = acceleratorTokenAliases['cmdorctrl'];

const namedKeyTokens = new Set([
	'up', 'down', 'left', 'right', 'space', 'enter', 'tab', 'backspace', 'delete', 'insert',
	'home', 'end', 'pageup', 'pagedown', 'esc', 'volumedown', 'volumeup', 'volumemute',
	'medianexttrack', 'mediaprevioustrack', 'mediastop', 'mediaplaypause', 'printscreen'
]);

export const parseAcceleratorToTokens = (expr: string): string[] => {
	if (typeof expr !== 'string') {
		throw new TypeError('Accelerator must be a string');
	}

	if (expr.trim().length === 0) {
		return [];
	}

	const rawTokens = expr.split('+');
	if (rawTokens.length >= 3 && rawTokens.slice(-2).every(token => token.trim() === '')) {
		rawTokens.splice(-2, 2, 'plus');
	}
	if (rawTokens.some(token => token.trim().length === 0)) {
		throw new TypeError(`Invalid accelerator: ${expr}`);
	}

	const modifierTokens = new Set(['cmd', 'ctrl', 'shift', 'alt', 'option', 'super']);
	const seenModifiers = new Set<string>();
	const tokens: string[] = [];
	let hasKey = false;

	for (const rawToken of rawTokens) {
		const lowerCasedToken = rawToken.trim().toLowerCase();
		const token = acceleratorTokenAliases[lowerCasedToken] || lowerCasedToken;
		if (modifierTokens.has(token)) {
			if (seenModifiers.has(token)) {
				throw new TypeError(`Duplicate modifier in accelerator: ${expr}`);
			}
			seenModifiers.add(token);
		}
		else {
			if (hasKey) {
				throw new TypeError(`Accelerator must contain exactly one key: ${expr}`);
			}
			if (token.length !== 1 && !namedKeyTokens.has(token) && !/^f(?:[1-9]|1[0-9]|2[0-4])$/.test(token)) {
				throw new TypeError(`Invalid key in accelerator: ${expr}`);
			}
			hasKey = true;
		}
		tokens.push(token);
	}

	if (!hasKey) {
		throw new TypeError(`Accelerator must contain a key: ${expr}`);
	}
	return tokens;
}
