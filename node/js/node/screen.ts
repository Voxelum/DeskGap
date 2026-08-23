import { screenNative } from './internal/native';

export interface Rectangle {
    x: number;
    y: number;
    width: number;
    height: number;
}

export interface Display {
    id: number;
    label: string;
    bounds: Rectangle;
    workArea: Rectangle;
    size: { width: number; height: number };
    workAreaSize: { width: number; height: number };
    scaleFactor: number;
}

type NativeDisplay = Omit<Display, 'size' | 'workAreaSize'> & { primary: boolean };

function toDisplay(display: NativeDisplay): Display {
    const { primary: _, ...result } = display;
    return {
        ...result,
        size: { width: display.bounds.width, height: display.bounds.height },
        workAreaSize: { width: display.workArea.width, height: display.workArea.height },
    };
}

export const screen = {
    getAllDisplays(): Display[] {
        return screenNative.getAllDisplays().map(toDisplay);
    },

    getPrimaryDisplay(): Display {
        const displays = screenNative.getAllDisplays();
        const primaryDisplay = displays.find(display => display.primary) || displays[0];
        if (primaryDisplay == null) throw new Error('No displays are available');
        return toDisplay(primaryDisplay);
    },
};
