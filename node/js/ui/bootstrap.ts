declare var window: any;

//This is the interface of window.deskgap in preload_${platform}.js
interface InternalDeskGap {
    //This is previously defined in a platform-specific manner.
    platform: string;
}


//preload.ts will modify window.deskgap so we need to keep a reference here.
export const internalDeskGap: InternalDeskGap = window.deskgap;
