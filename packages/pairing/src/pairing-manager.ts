import { randomUUID } from 'node:crypto';
import { createLogger } from '@hydraclaw/core';
import type { PairedDevice, PairingRequest, PairingResponse } from './types.js';
import {
  generateKeyPair,
  generatePairingCode,
  generateChallenge,
  hashPairingCode,
  verifyPairingCode,
  signMessage,
  verifySignature,
} from './crypto.js';
import type { KeyPair } from './crypto.js';

const logger = createLogger('pairing:manager');

const PAIRING_CODE_TTL_MS = 5 * 60 * 1000; // 5 minutes
const HEARTBEAT_INTERVAL_MS = 30 * 1000; // 30 seconds
const OFFLINE_THRESHOLD_MS = 90 * 1000; // 90 seconds

interface PendingPairing {
  code: string;
  codeHash: string;
  challenge: string;
  createdAt: number;
  expiresAt: number;
}

export interface PairingManagerConfig {
  deviceId?: string;
  deviceName?: string;
  deviceType?: 'desktop' | 'mobile' | 'server' | 'iot';
  platform?: string;
  onPairingRequest?: (request: PairingRequest) => Promise<boolean>;
}

export class PairingManager {
  private deviceId: string;
  private deviceName: string;
  private deviceType: string;
  private platform: string;
  private keyPair: KeyPair;
  private pairedDevices = new Map<string, PairedDevice>();
  private pendingPairings = new Map<string, PendingPairing>();
  private onPairingRequest?: (request: PairingRequest) => Promise<boolean>;
  private cleanupInterval: ReturnType<typeof setInterval> | null = null;

  constructor(config: PairingManagerConfig = {}) {
    this.deviceId = config.deviceId ?? randomUUID();
    this.deviceName = config.deviceName ?? `hydraclaw-${this.deviceId.slice(0, 8)}`;
    this.deviceType = config.deviceType ?? 'desktop';
    this.platform = config.platform ?? process.platform;
    this.keyPair = generateKeyPair();
    this.onPairingRequest = config.onPairingRequest;

    // Periodically clean up expired pairing codes
    this.cleanupInterval = setInterval(() => this.cleanupExpiredPairings(), 60_000);

    logger.debug('PairingManager initialized', {
      deviceId: this.deviceId,
      deviceName: this.deviceName,
      deviceType: this.deviceType,
    });
  }

  /**
   * Generate a time-limited pairing code that another device can use to pair.
   * Returns the code and an expiration timestamp.
   */
  generatePairingCode(): { code: string; expiresAt: number } {
    const code = generatePairingCode();
    const challenge = generateChallenge();
    const now = Date.now();

    const pending: PendingPairing = {
      code,
      codeHash: hashPairingCode(code),
      challenge,
      createdAt: now,
      expiresAt: now + PAIRING_CODE_TTL_MS,
    };

    this.pendingPairings.set(code, pending);

    logger.debug('Pairing code generated', { expiresAt: pending.expiresAt });

    return { code, expiresAt: pending.expiresAt };
  }

  /**
   * Initiate pairing with a remote device using its address and pairing code.
   */
  async initiatePairing(address: string, code: string): Promise<PairingResponse> {
    logger.debug('Initiating pairing', { address, codeLength: code.length });

    const challenge = generateChallenge();

    const request: PairingRequest = {
      deviceId: this.deviceId,
      deviceName: this.deviceName,
      deviceType: this.deviceType,
      platform: this.platform,
      publicKey: this.keyPair.publicKey,
      challenge,
    };

    // In a real implementation, this would send the request over the network
    // to the target device at the given address. For now, we return a
    // placeholder that indicates the request was sent.
    logger.debug('Pairing request prepared for transmission', {
      targetAddress: address,
      deviceId: request.deviceId,
    });

    return {
      accepted: false,
      reason: 'Pairing request sent, awaiting acceptance from remote device',
    };
  }

  /**
   * Accept an incoming pairing request from another device.
   */
  async acceptPairing(request: PairingRequest): Promise<PairingResponse> {
    logger.debug('Accepting pairing request', {
      deviceId: request.deviceId,
      deviceName: request.deviceName,
    });

    // Validate the request
    if (!request.deviceId || !request.publicKey) {
      return { accepted: false, reason: 'Invalid pairing request: missing required fields' };
    }

    // Check if already paired
    if (this.pairedDevices.has(request.deviceId)) {
      return { accepted: false, reason: 'Device is already paired' };
    }

    // If there's a callback for approval, use it
    if (this.onPairingRequest) {
      const approved = await this.onPairingRequest(request);
      if (!approved) {
        return { accepted: false, reason: 'Pairing request rejected by user' };
      }
    }

    // Sign the challenge to prove our identity
    const signedChallenge = signMessage(request.challenge, this.keyPair.privateKey);

    // Create the paired device record
    const now = Date.now();
    const device: PairedDevice = {
      id: request.deviceId,
      name: request.deviceName,
      type: request.deviceType as PairedDevice['type'],
      platform: request.platform,
      address: '', // Will be set when the device connects
      port: 0,
      publicKey: request.publicKey,
      pairedAt: now,
      lastSeen: now,
      status: 'online',
    };

    this.pairedDevices.set(device.id, device);

    logger.info('Device paired successfully', {
      deviceId: device.id,
      deviceName: device.name,
    });

    return {
      accepted: true,
      deviceId: this.deviceId,
      publicKey: this.keyPair.publicKey,
      token: signedChallenge,
    };
  }

  /**
   * Reject an incoming pairing request.
   */
  async rejectPairing(request: PairingRequest): Promise<PairingResponse> {
    logger.debug('Rejecting pairing request', {
      deviceId: request.deviceId,
      deviceName: request.deviceName,
    });

    return {
      accepted: false,
      reason: 'Pairing request was rejected',
    };
  }

  /**
   * Get all paired devices, optionally updating their online status.
   */
  getPairedDevices(): PairedDevice[] {
    const now = Date.now();

    // Update device statuses based on last seen time
    for (const device of this.pairedDevices.values()) {
      if (device.status !== 'offline' && now - device.lastSeen > OFFLINE_THRESHOLD_MS) {
        device.status = 'offline';
      }
    }

    return [...this.pairedDevices.values()];
  }

  /**
   * Get a specific paired device by ID.
   */
  getPairedDevice(deviceId: string): PairedDevice | undefined {
    return this.pairedDevices.get(deviceId);
  }

  /**
   * Remove a pairing with a device.
   */
  removePairing(deviceId: string): boolean {
    const device = this.pairedDevices.get(deviceId);
    if (!device) {
      logger.warn('Cannot remove pairing: device not found', { deviceId });
      return false;
    }

    this.pairedDevices.delete(deviceId);

    logger.info('Device unpaired', { deviceId, deviceName: device.name });
    return true;
  }

  /**
   * Send a message to a paired device.
   * The message is signed with our private key for authentication.
   */
  async sendToDevice(deviceId: string, message: unknown): Promise<void> {
    const device = this.pairedDevices.get(deviceId);
    if (!device) {
      throw new Error(`Device "${deviceId}" is not paired`);
    }

    if (device.status === 'offline') {
      throw new Error(`Device "${deviceId}" (${device.name}) is offline`);
    }

    const payload = JSON.stringify({
      from: this.deviceId,
      to: deviceId,
      timestamp: Date.now(),
      data: message,
    });

    const signature = signMessage(payload, this.keyPair.privateKey);

    logger.debug('Sending message to device', {
      deviceId,
      deviceName: device.name,
      payloadSize: payload.length,
    });

    // In a real implementation, this would transmit the signed payload
    // to the target device over the network connection.
    // The receiving device would verify the signature using our public key.
    void signature;
  }

  /**
   * Update the last seen timestamp for a paired device.
   */
  updateDeviceStatus(deviceId: string, address?: string, port?: number): void {
    const device = this.pairedDevices.get(deviceId);
    if (!device) return;

    device.lastSeen = Date.now();
    device.status = 'online';

    if (address) device.address = address;
    if (port) device.port = port;
  }

  /**
   * Verify a message received from a paired device.
   */
  verifyDeviceMessage(deviceId: string, message: string, signature: string): boolean {
    const device = this.pairedDevices.get(deviceId);
    if (!device) {
      logger.warn('Cannot verify message: device not paired', { deviceId });
      return false;
    }

    return verifySignature(message, signature, device.publicKey);
  }

  /**
   * Get this device's public key for sharing with other devices.
   */
  getPublicKey(): string {
    return this.keyPair.publicKey;
  }

  /**
   * Get this device's ID.
   */
  getDeviceId(): string {
    return this.deviceId;
  }

  /**
   * Clean up resources.
   */
  destroy(): void {
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
      this.cleanupInterval = null;
    }

    logger.debug('PairingManager destroyed');
  }

  private cleanupExpiredPairings(): void {
    const now = Date.now();
    let cleaned = 0;

    for (const [code, pending] of this.pendingPairings) {
      if (now > pending.expiresAt) {
        this.pendingPairings.delete(code);
        cleaned++;
      }
    }

    if (cleaned > 0) {
      logger.debug('Cleaned up expired pairing codes', { count: cleaned });
    }
  }
}
