import { sha256 } from '@noble/hashes/sha2.js';
import { gcm } from '@noble/ciphers/aes.js';
import { getRandomBytes } from 'expo-crypto';

const NONCE_LEN = 12;

// Mirrors desktop/src-tauri/src/crypto.rs: every WS frame is
// nonce || AES-256-GCM(json), keyed by SHA-256(token). Both sides already
// hold the token out-of-band (QR/manual entry), so the token itself never
// has to cross the wire — a passive LAN listener sees only ciphertext.
export function deriveKey(token) {
  return sha256(new TextEncoder().encode(token));
}

export function encryptFrame(key, obj) {
  const nonce = getRandomBytes(NONCE_LEN);
  const plaintext = new TextEncoder().encode(JSON.stringify(obj));
  const ciphertext = gcm(key, nonce).encrypt(plaintext);
  const out = new Uint8Array(NONCE_LEN + ciphertext.length);
  out.set(nonce, 0);
  out.set(ciphertext, NONCE_LEN);
  return out.buffer;
}

// Returns null on any failure (wrong key, tampered/corrupted data) — callers
// treat that as "drop this message", same as a bad token used to.
export function decryptFrame(key, arrayBuffer) {
  const data = new Uint8Array(arrayBuffer);
  if (data.length < NONCE_LEN) return null;
  const nonce = data.subarray(0, NONCE_LEN);
  const ciphertext = data.subarray(NONCE_LEN);
  try {
    const plaintext = gcm(key, nonce).decrypt(ciphertext);
    return JSON.parse(new TextDecoder().decode(plaintext));
  } catch {
    return null;
  }
}
