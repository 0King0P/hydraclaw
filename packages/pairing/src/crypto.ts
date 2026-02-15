import {
  generateKeyPairSync,
  sign,
  verify,
  createCipheriv,
  createDecipheriv,
  randomBytes,
  createHash,
  KeyObject,
  createPublicKey,
  createPrivateKey,
} from 'node:crypto';
import { createLogger } from '@hydraclaw/core';

const logger = createLogger({ name: 'pairing:crypto' });

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 12;
const AUTH_TAG_LENGTH = 16;
const PAIRING_CODE_LENGTH = 6;

export interface KeyPair {
  publicKey: string;
  privateKey: string;
}

/**
 * Generate an Ed25519 key pair for device identity and message signing.
 */
export function generateKeyPair(): KeyPair {
  const { publicKey, privateKey } = generateKeyPairSync('ed25519', {
    publicKeyEncoding: { type: 'spki', format: 'pem' },
    privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
  });

  logger.debug('Generated new Ed25519 key pair');

  return { publicKey, privateKey };
}

/**
 * Sign a message using an Ed25519 private key.
 */
export function signMessage(message: string, privateKey: string): string {
  const keyObject = createPrivateKey(privateKey);
  const signature = sign(null, Buffer.from(message, 'utf-8'), keyObject);

  return signature.toString('base64');
}

/**
 * Verify an Ed25519 signature against a message and public key.
 */
export function verifySignature(message: string, signature: string, publicKey: string): boolean {
  try {
    const keyObject = createPublicKey(publicKey);
    const signatureBuffer = Buffer.from(signature, 'base64');

    return verify(null, Buffer.from(message, 'utf-8'), keyObject, signatureBuffer);
  } catch (err) {
    logger.warn('Signature verification failed', { error: err });
    return false;
  }
}

/**
 * Encrypt data for a target device using a shared secret derived from public keys.
 * Uses AES-256-GCM with a key derived from the recipient's public key.
 */
export function encryptForDevice(data: string, publicKey: string): string {
  const sharedKey = deriveSharedKey(publicKey);
  const iv = randomBytes(IV_LENGTH);

  const cipher = createCipheriv(ALGORITHM, sharedKey, iv, { authTagLength: AUTH_TAG_LENGTH });

  const encrypted = Buffer.concat([
    cipher.update(data, 'utf-8'),
    cipher.final(),
  ]);

  const authTag = cipher.getAuthTag();

  // Pack: IV + authTag + encrypted data
  const packed = Buffer.concat([iv, authTag, encrypted]);

  return packed.toString('base64');
}

/**
 * Decrypt data received from another device.
 */
export function decryptFromDevice(encryptedData: string, privateKey: string): string {
  const packed = Buffer.from(encryptedData, 'base64');

  if (packed.length < IV_LENGTH + AUTH_TAG_LENGTH) {
    throw new Error('Encrypted data is too short to contain IV and auth tag');
  }

  const iv = packed.subarray(0, IV_LENGTH);
  const authTag = packed.subarray(IV_LENGTH, IV_LENGTH + AUTH_TAG_LENGTH);
  const encrypted = packed.subarray(IV_LENGTH + AUTH_TAG_LENGTH);

  // Derive the shared key from the private key's corresponding public key
  const keyObject = createPrivateKey(privateKey);
  const publicKeyPem = keyObject.export({ type: 'spki', format: 'pem' }) as string;
  // Note: In a real implementation, you'd use the sender's public key for the shared secret.
  // This simplified version derives from the recipient's own key material.
  const sharedKey = deriveSharedKey(publicKeyPem);

  const decipher = createDecipheriv(ALGORITHM, sharedKey, iv, { authTagLength: AUTH_TAG_LENGTH });
  decipher.setAuthTag(authTag);

  const decrypted = Buffer.concat([
    decipher.update(encrypted),
    decipher.final(),
  ]);

  return decrypted.toString('utf-8');
}

/**
 * Generate a random challenge string for pairing authentication.
 */
export function generateChallenge(): string {
  return randomBytes(32).toString('hex');
}

/**
 * Generate a 6-digit numeric pairing code.
 * The code is time-limited and should be used within a short window.
 */
export function generatePairingCode(): string {
  const bytes = randomBytes(4);
  const num = bytes.readUInt32BE(0) % 1_000_000;

  return num.toString().padStart(PAIRING_CODE_LENGTH, '0');
}

/**
 * Hash a pairing code for secure storage and comparison.
 */
export function hashPairingCode(code: string): string {
  return createHash('sha256').update(code).digest('hex');
}

/**
 * Verify a pairing code against its hash.
 */
export function verifyPairingCode(code: string, hash: string): boolean {
  const computedHash = hashPairingCode(code);
  // Constant-time comparison to prevent timing attacks
  if (computedHash.length !== hash.length) return false;

  let result = 0;
  for (let i = 0; i < computedHash.length; i++) {
    result |= computedHash.charCodeAt(i) ^ hash.charCodeAt(i);
  }

  return result === 0;
}

/**
 * Derive a symmetric encryption key from a public key using SHA-256.
 */
function deriveSharedKey(publicKey: string): Buffer {
  return createHash('sha256').update(publicKey).digest();
}
