export function encodeUTF8(value: string): Uint8Array {
    if (typeof TextEncoder !== 'undefined') return new TextEncoder().encode(value);
    const bytes: number[] = [];
    for (let index = 0; index < value.length; index++) {
        let point = value.charCodeAt(index);
        if (point >= 0xd800 && point <= 0xdbff) {
            const low = value.charCodeAt(index + 1);
            if (low >= 0xdc00 && low <= 0xdfff) {
                point = 0x10000 + ((point - 0xd800) << 10) + low - 0xdc00;
                index++;
            }
            else point = 0xfffd;
        }
        else if (point >= 0xdc00 && point <= 0xdfff) point = 0xfffd;

        if (point < 0x80) bytes.push(point);
        else if (point < 0x800) bytes.push(0xc0 | (point >> 6), 0x80 | (point & 0x3f));
        else if (point < 0x10000) bytes.push(0xe0 | (point >> 12), 0x80 | ((point >> 6) & 0x3f), 0x80 | (point & 0x3f));
        else bytes.push(0xf0 | (point >> 18), 0x80 | ((point >> 12) & 0x3f), 0x80 | ((point >> 6) & 0x3f), 0x80 | (point & 0x3f));
    }
    return new Uint8Array(bytes);
}

export function decodeUTF8(bytes: Uint8Array): string {
    if (typeof TextDecoder !== 'undefined') return new TextDecoder().decode(bytes);
    let value = '';
    let index = 0;
    while (index < bytes.length) {
        const first = bytes[index++];
        let point = first;
        let remaining = 0;
        let lower = 0x80;
        let upper = 0xbf;
        if (first <= 0x7f) {}
        else if (first >= 0xc2 && first <= 0xdf) {
            point = first & 0x1f;
            remaining = 1;
        }
        else if (first >= 0xe0 && first <= 0xef) {
            point = first & 0x0f;
            remaining = 2;
            if (first === 0xe0) lower = 0xa0;
            if (first === 0xed) upper = 0x9f;
        }
        else if (first >= 0xf0 && first <= 0xf4) {
            point = first & 0x07;
            remaining = 3;
            if (first === 0xf0) lower = 0x90;
            if (first === 0xf4) upper = 0x8f;
        }
        else point = 0xfffd;

        while (remaining > 0) {
            const next = bytes[index];
            if (index === bytes.length || next < lower || next > upper) {
                point = 0xfffd;
                break;
            }
            index++;
            point = (point << 6) | (next & 0x3f);
            remaining--;
            lower = 0x80;
            upper = 0xbf;
        }
        if (point === 0xfeff && value.length === 0 && index === 3) continue;
        if (point <= 0xffff) value += String.fromCharCode(point);
        else {
            point -= 0x10000;
            value += String.fromCharCode(0xd800 + (point >> 10), 0xdc00 + (point & 0x3ff));
        }
    }
    return value;
}
