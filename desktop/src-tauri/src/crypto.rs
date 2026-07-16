use aes_gcm::aead::{Aead, KeyInit, OsRng};
use aes_gcm::{AeadCore, Aes256Gcm, Key, Nonce};
use sha2::{Digest, Sha256};

const NONCE_LEN: usize = 12;

/// Every WS frame is encrypted with a key derived from the pairing token, so
/// the token never has to cross the wire in plaintext and passive LAN sniffing
/// (open Wi-Fi, a compromised router) can't read either the token or the
/// chat content. Both sides already hold the token out-of-band (QR/manual
/// entry), so no handshake or cert exchange is needed — this is symmetric,
/// not transport TLS.
pub fn derive_key(token: &str) -> Key<Aes256Gcm> {
    let digest = Sha256::digest(token.as_bytes());
    *Key::<Aes256Gcm>::from_slice(&digest)
}

pub fn encrypt(key: &Key<Aes256Gcm>, plaintext: &[u8]) -> Vec<u8> {
    let cipher = Aes256Gcm::new(key);
    let nonce = Aes256Gcm::generate_nonce(&mut OsRng);
    let mut ciphertext = cipher
        .encrypt(&nonce, plaintext)
        .expect("AES-GCM encryption cannot fail for well-formed input");
    let mut out = Vec::with_capacity(NONCE_LEN + ciphertext.len());
    out.extend_from_slice(nonce.as_slice());
    out.append(&mut ciphertext);
    out
}

/// None on any failure (too short, wrong key, tampered/corrupted data) —
/// callers treat that as "unauthorized", same as a bad token used to.
pub fn decrypt(key: &Key<Aes256Gcm>, data: &[u8]) -> Option<Vec<u8>> {
    if data.len() < NONCE_LEN {
        return None;
    }
    let (nonce_bytes, ciphertext) = data.split_at(NONCE_LEN);
    let nonce = Nonce::from_slice(nonce_bytes);
    Aes256Gcm::new(key).decrypt(nonce, ciphertext).ok()
}
