// Mirrors desktop/src-tauri/src/crypto.rs and mobile/crypto.js: every WS
// frame is nonce || AES-256-GCM(json), keyed by SHA-256(token). The desktop
// webview (WebView2/WKWebView) ships a full Web Crypto API, so this uses
// window.crypto.subtle directly instead of pulling in a JS AES library like
// the React Native client has to.
const NONCE_LEN = 12;

export async function deriveKey(token) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(token));
  return crypto.subtle.importKey('raw', digest, 'AES-GCM', false, ['encrypt', 'decrypt']);
}

export async function encryptFrame(key, obj) {
  const nonce = crypto.getRandomValues(new Uint8Array(NONCE_LEN));
  const plaintext = new TextEncoder().encode(JSON.stringify(obj));
  const ciphertext = new Uint8Array(
    await crypto.subtle.encrypt({ name: 'AES-GCM', iv: nonce }, key, plaintext)
  );
  const out = new Uint8Array(NONCE_LEN + ciphertext.length);
  out.set(nonce, 0);
  out.set(ciphertext, NONCE_LEN);
  return out.buffer;
}

// Returns null on any failure (wrong key, tampered/corrupted data) — callers
// treat that as "drop this message", same as a bad token used to.
export async function decryptFrame(key, arrayBuffer) {
  const data = new Uint8Array(arrayBuffer);
  if (data.length < NONCE_LEN) return null;
  const nonce = data.subarray(0, NONCE_LEN);
  const ciphertext = data.subarray(NONCE_LEN);
  try {
    const plaintext = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: nonce }, key, ciphertext);
    return JSON.parse(new TextDecoder().decode(plaintext));
  } catch {
    return null;
  }
}
