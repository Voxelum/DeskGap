import { EventEmitter } from 'events';
import { powerMonitorNative } from './internal/native';

export interface PowerMonitorBackend {
    isOnBatteryPower(): boolean;
    startMonitoring(callbacks: {
        onSuspend(): void;
        onResume(): void;
        onPowerSourceChanged(onBattery: boolean): void;
    }): void;
}

export class PowerMonitor extends EventEmitter {
    private isMonitoring_ = false;

    constructor(private readonly backend_: PowerMonitorBackend = powerMonitorNative) {
        super();
        super.on('newListener', (eventName: string | symbol) => {
            if (
                !this.isMonitoring_
                && typeof eventName === 'string'
                && ['suspend', 'resume', 'on-ac', 'on-battery'].includes(eventName)
            ) {
                this.isMonitoring_ = true;
                backend_.startMonitoring({
                    onSuspend: () => this.emit('suspend'),
                    onResume: () => this.emit('resume'),
                    onPowerSourceChanged: onBattery => this.emit(onBattery ? 'on-battery' : 'on-ac'),
                });
            }
        });
    }

    get onBatteryPower(): boolean {
        return this.backend_.isOnBatteryPower();
    }

    isOnBatteryPower(): boolean {
        return this.backend_.isOnBatteryPower();
    }
}

export interface PowerMonitor {
    on(eventName: 'suspend' | 'resume' | 'on-ac' | 'on-battery', listener: () => void): this;
    once(eventName: 'suspend' | 'resume' | 'on-ac' | 'on-battery', listener: () => void): this;
}

export const powerMonitor = new PowerMonitor();
