import { randomBytes } from 'node:crypto';
import type { Extension, ExtensionContext } from '@hydraclaw/extensions';

interface PairedDevice {
  deviceId: string;
  name: string;
  type: 'phone' | 'tablet' | 'desktop' | 'iot' | 'wearable' | 'other';
  pairedAt: number;
  lastSeen: number;
  pairingCode?: string;
  capabilities: string[];
  metadata: Record<string, unknown>;
}

interface PairingSession {
  code: string;
  createdAt: number;
  expiresAt: number;
  initiatedBy: string;
}

/**
 * Device Pairing Extension
 *
 * Manages device pairing and multi-device session continuity for HydraClaw.
 * Allows users to pair phones, tablets, desktops, and IoT devices to their
 * HydraClaw instance and synchronize state across them.
 */
class DevicePairExtension implements Extension {
  id = 'device-pair';
  name = 'Device Pairing';
  description = 'Manage device pairing and multi-device session continuity';
  version = '1.0.0';
  type = 'integration' as const;

  private devices = new Map<string, PairedDevice>();
  private activeSessions = new Map<string, PairingSession>();
  private heartbeatInterval: NodeJS.Timeout | null = null;
  private ctx: ExtensionContext | null = null;

  async init(context: ExtensionContext): Promise<void> {
    this.ctx = context;
    const heartbeatMs = (context.config.heartbeatMs as number) ?? 30000;

    context.logger.info('Device Pairing extension initializing');

    // Listen for device events
    context.bus.on('device:pair:request', async (...args: unknown[]) => {
      const [initiatedBy] = args as [string];
      const session = this.createPairingSession(initiatedBy);
      await context.bus.emit('device:pair:code', session.code, session.expiresAt);
    });

    context.bus.on('device:pair:complete', async (...args: unknown[]) => {
      const [code, deviceInfo] = args as [string, Omit<PairedDevice, 'pairedAt' | 'lastSeen'>];
      const result = this.completePairing(code, deviceInfo);
      await context.bus.emit('device:pair:result', result);
    });

    context.bus.on('device:heartbeat', async (...args: unknown[]) => {
      const [deviceId] = args as [string];
      this.updateLastSeen(deviceId);
    });

    // Periodic check for stale devices
    this.heartbeatInterval = setInterval(() => {
      this.checkStaleDevices(heartbeatMs * 10); // 10x heartbeat interval
    }, heartbeatMs);

    context.logger.info(`Device Pairing initialized (heartbeat: ${heartbeatMs}ms)`);
  }

  async destroy(): Promise<void> {
    if (this.heartbeatInterval) {
      clearInterval(this.heartbeatInterval);
      this.heartbeatInterval = null;
    }
    this.devices.clear();
    this.activeSessions.clear();
    this.ctx?.logger.info('Device Pairing destroyed');
  }

  createPairingSession(initiatedBy: string): PairingSession {
    // Generate a 6-character pairing code
    const code = randomBytes(3).toString('hex').toUpperCase();
    const now = Date.now();

    const session: PairingSession = {
      code,
      createdAt: now,
      expiresAt: now + 5 * 60 * 1000, // 5 minute expiry
      initiatedBy,
    };

    this.activeSessions.set(code, session);
    this.ctx?.logger.info(`Pairing session created: ${code} (expires in 5 minutes)`);
    return session;
  }

  completePairing(code: string, deviceInfo: Omit<PairedDevice, 'pairedAt' | 'lastSeen'>): PairedDevice | null {
    const session = this.activeSessions.get(code);
    if (!session) {
      this.ctx?.logger.warn(`Pairing failed: invalid code "${code}"`);
      return null;
    }

    if (Date.now() > session.expiresAt) {
      this.activeSessions.delete(code);
      this.ctx?.logger.warn(`Pairing failed: code "${code}" has expired`);
      return null;
    }

    const now = Date.now();
    const device: PairedDevice = {
      ...deviceInfo,
      pairedAt: now,
      lastSeen: now,
      pairingCode: code,
    };

    this.devices.set(device.deviceId, device);
    this.activeSessions.delete(code);
    this.ctx?.logger.info(`Device paired: ${device.name} (${device.deviceId}) [${device.type}]`);
    return device;
  }

  unpairDevice(deviceId: string): boolean {
    const device = this.devices.get(deviceId);
    if (!device) return false;

    this.devices.delete(deviceId);
    this.ctx?.logger.info(`Device unpaired: ${device.name} (${deviceId})`);
    return true;
  }

  getDevice(deviceId: string): PairedDevice | undefined {
    return this.devices.get(deviceId);
  }

  getAllDevices(): PairedDevice[] {
    return Array.from(this.devices.values());
  }

  getOnlineDevices(thresholdMs: number = 60000): PairedDevice[] {
    const cutoff = Date.now() - thresholdMs;
    return Array.from(this.devices.values()).filter(d => d.lastSeen >= cutoff);
  }

  updateLastSeen(deviceId: string): void {
    const device = this.devices.get(deviceId);
    if (device) {
      device.lastSeen = Date.now();
    }
  }

  private checkStaleDevices(thresholdMs: number): void {
    const cutoff = Date.now() - thresholdMs;
    for (const device of this.devices.values()) {
      if (device.lastSeen < cutoff) {
        this.ctx?.bus.emit('device:stale', device.deviceId, device.name).catch(() => {});
      }
    }

    // Also clean up expired pairing sessions
    const now = Date.now();
    for (const [code, session] of this.activeSessions) {
      if (now > session.expiresAt) {
        this.activeSessions.delete(code);
      }
    }
  }
}

export default new DevicePairExtension();
