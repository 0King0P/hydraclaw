export interface PairedDevice {
  id: string;
  name: string;
  type: 'desktop' | 'mobile' | 'server' | 'iot';
  platform: string;
  address: string;
  port: number;
  publicKey: string;
  pairedAt: number;
  lastSeen: number;
  status: 'online' | 'offline' | 'connecting';
}

export interface PairingRequest {
  deviceId: string;
  deviceName: string;
  deviceType: string;
  platform: string;
  publicKey: string;
  challenge: string;
}

export interface PairingResponse {
  accepted: boolean;
  deviceId?: string;
  publicKey?: string;
  token?: string;
  reason?: string;
}

export interface NodeInfo {
  id: string;
  name: string;
  version: string;
  address: string;
  port: number;
  capabilities: string[];
  load: { cpu: number; memory: number; activeSessions: number };
  status: 'ready' | 'busy' | 'draining' | 'offline';
}
