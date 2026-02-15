import type { Extension, ExtensionContext } from '@hydraclaw/extensions';

interface PhoneDevice {
  deviceId: string;
  name: string;
  platform: 'ios' | 'android';
  connected: boolean;
  batteryLevel: number | null;
  lastSeen: number;
}

interface PhoneCommand {
  id: string;
  deviceId: string;
  action: string;
  payload: Record<string, unknown>;
  sentAt: number;
  status: 'pending' | 'delivered' | 'executed' | 'failed';
  result?: unknown;
}

/**
 * Phone Control Extension
 *
 * Remote mobile device control for sending notifications, executing
 * commands, managing clipboard, toggling settings, and retrieving
 * device status from paired phones.
 */
class PhoneControlExtension implements Extension {
  id = 'phone-control';
  name = 'Phone Control';
  description = 'Remote mobile device control for notifications, commands, and device management';
  version = '1.0.0';
  type = 'integration' as const;

  private devices = new Map<string, PhoneDevice>();
  private commandHistory: PhoneCommand[] = [];
  private commandCounter = 0;
  private ctx: ExtensionContext | null = null;

  async init(context: ExtensionContext): Promise<void> {
    this.ctx = context;

    context.logger.info('Phone Control extension initializing');

    context.bus.on('phone:connect', async (...args: unknown[]) => {
      const [deviceId, name, platform] = args as [string, string, 'ios' | 'android'];
      const device = this.connectDevice(deviceId, name, platform);
      await context.bus.emit('phone:connected', device);
    });

    context.bus.on('phone:disconnect', async (...args: unknown[]) => {
      const [deviceId] = args as [string];
      this.disconnectDevice(deviceId);
      await context.bus.emit('phone:disconnected', deviceId);
    });

    context.bus.on('phone:command', async (...args: unknown[]) => {
      const [deviceId, action, payload] = args as [string, string, Record<string, unknown>?];
      const command = this.sendCommand(deviceId, action, payload);
      if (command) {
        await context.bus.emit('phone:command:sent', command);
      }
    });

    context.bus.on('phone:command:result', async (...args: unknown[]) => {
      const [commandId, status, result] = args as [string, PhoneCommand['status'], unknown];
      this.updateCommandStatus(commandId, status, result);
    });

    context.bus.on('phone:battery', async (...args: unknown[]) => {
      const [deviceId, level] = args as [string, number];
      this.updateBattery(deviceId, level);
    });

    context.bus.on('phone:status', async (...args: unknown[]) => {
      const [deviceId, callback] = args as [string, (device: PhoneDevice | null) => void];
      callback(this.devices.get(deviceId) ?? null);
    });

    context.logger.info('Phone Control initialized');
  }

  async destroy(): Promise<void> {
    this.devices.clear();
    this.commandHistory = [];
    this.ctx?.logger.info('Phone Control destroyed');
  }

  connectDevice(deviceId: string, name: string, platform: 'ios' | 'android'): PhoneDevice {
    const device: PhoneDevice = {
      deviceId,
      name,
      platform,
      connected: true,
      batteryLevel: null,
      lastSeen: Date.now(),
    };

    this.devices.set(deviceId, device);
    this.ctx?.logger.info(`Phone connected: ${name} (${deviceId}) [${platform}]`);
    return device;
  }

  disconnectDevice(deviceId: string): void {
    const device = this.devices.get(deviceId);
    if (device) {
      device.connected = false;
      this.ctx?.logger.info(`Phone disconnected: ${device.name} (${deviceId})`);
    }
  }

  sendCommand(deviceId: string, action: string, payload?: Record<string, unknown>): PhoneCommand | null {
    const device = this.devices.get(deviceId);
    if (!device || !device.connected) {
      this.ctx?.logger.warn(`Cannot send command to ${deviceId}: device not connected`);
      return null;
    }

    const command: PhoneCommand = {
      id: `cmd_${++this.commandCounter}_${Date.now()}`,
      deviceId,
      action,
      payload: payload ?? {},
      sentAt: Date.now(),
      status: 'pending',
    };

    this.commandHistory.push(command);
    device.lastSeen = Date.now();
    this.ctx?.logger.info(`Command sent to ${device.name}: ${action}`);
    return command;
  }

  updateCommandStatus(commandId: string, status: PhoneCommand['status'], result?: unknown): void {
    const command = this.commandHistory.find(c => c.id === commandId);
    if (command) {
      command.status = status;
      command.result = result;
    }
  }

  updateBattery(deviceId: string, level: number): void {
    const device = this.devices.get(deviceId);
    if (device) {
      device.batteryLevel = level;
      device.lastSeen = Date.now();
    }
  }

  getConnectedDevices(): PhoneDevice[] {
    return Array.from(this.devices.values()).filter(d => d.connected);
  }

  getCommandHistory(deviceId?: string, limit?: number): PhoneCommand[] {
    let commands = this.commandHistory;
    if (deviceId) {
      commands = commands.filter(c => c.deviceId === deviceId);
    }
    return commands.slice(-(limit ?? 50));
  }
}

export default new PhoneControlExtension();
