export type {
  PairedDevice,
  PairingRequest,
  PairingResponse,
  NodeInfo,
} from './types.js';

export { PairingManager } from './pairing-manager.js';
export type { PairingManagerConfig } from './pairing-manager.js';

export { NodeHost } from './node-host.js';
export type { NodeHostConfig } from './node-host.js';

export {
  generateKeyPair,
  signMessage,
  verifySignature,
  encryptForDevice,
  decryptFromDevice,
  generateChallenge,
  generatePairingCode,
  hashPairingCode,
  verifyPairingCode,
} from './crypto.js';
export type { KeyPair } from './crypto.js';

export { RPCClient, RPCServer, RPC_ERRORS } from './rpc.js';
export type {
  JSONRPCRequest,
  JSONRPCResponse,
  JSONRPCError,
  RPCClientConfig,
  RPCServerConfig,
} from './rpc.js';
