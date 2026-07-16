use std::io::{BufRead, BufReader};
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Mutex;

/// Opt-in internet access for pairing, so a phone off the home LAN (or
/// stuck behind AP isolation) can still reach this machine. Uses Cloudflare's
/// "quick tunnel" — free, no account, no domain, just an outbound connection
/// from this machine to Cloudflare's edge, which hands back a random
/// `https://xxxx.trycloudflare.com` that proxies to our local WS port. The
/// pairing token + AES-GCM framing (see crypto.rs) are what actually secure
/// it; the tunnel itself is just transport.
pub struct TunnelState {
    pub url: Mutex<Option<String>>,
    started: AtomicBool,
}

impl TunnelState {
    pub fn new() -> Self {
        Self {
            url: Mutex::new(None),
            started: AtomicBool::new(false),
        }
    }
}

fn cloudflared_path(app_dir: &Path) -> PathBuf {
    app_dir.join(if cfg!(windows) {
        "cloudflared.exe"
    } else {
        "cloudflared"
    })
}

// Pinned to a specific release (not "latest") with a hardcoded checksum so a
// compromised GitHub Releases asset — or a MITM that somehow still passes TLS
// validation — can't get an arbitrary binary silently executed on this
// machine. Bump both together when updating: download the new
// cloudflared-windows-amd64.exe for the target version and re-hash it.
const CLOUDFLARED_VERSION: &str = "2025.9.1";
const CLOUDFLARED_SHA256: &str = "871c63a23f167ec1a4fc5e2c3de9e91e4f0742af708fb8b86055ddd6da82ea8e";

fn download_url() -> Option<String> {
    // ponytail: only the platform this app actually ships for today. Add
    // arms here if/when macOS/Linux builds happen.
    if cfg!(all(windows, target_arch = "x86_64")) {
        Some(format!(
            "https://github.com/cloudflare/cloudflared/releases/download/{CLOUDFLARED_VERSION}/cloudflared-windows-amd64.exe"
        ))
    } else {
        None
    }
}

fn sha256_hex(bytes: &[u8]) -> String {
    use sha2::{Digest, Sha256};
    let digest = Sha256::digest(bytes);
    digest.iter().map(|b| format!("{b:02x}")).collect()
}

fn ensure_binary(app_dir: &Path) -> Result<PathBuf, String> {
    let path = cloudflared_path(app_dir);
    if path.exists() {
        return Ok(path);
    }
    let url = download_url().ok_or("no cloudflared build for this platform")?;
    let resp = ureq::get(&url)
        .call()
        .map_err(|e| format!("download failed: {e}"))?;
    let mut bytes = Vec::new();
    std::io::copy(&mut resp.into_reader(), &mut bytes).map_err(|e| e.to_string())?;

    let actual = sha256_hex(&bytes);
    if actual != CLOUDFLARED_SHA256 {
        return Err(format!(
            "cloudflared checksum mismatch: expected {CLOUDFLARED_SHA256}, got {actual} — refusing to run it"
        ));
    }

    std::fs::write(&path, &bytes).map_err(|e| e.to_string())?;
    Ok(path)
}

/// Idempotent — the second and later calls are no-ops so the UI can just
/// invoke this on every "enable internet access" click without tracking
/// whether it already ran.
pub fn start(app_dir: PathBuf, local_port: u16, state: std::sync::Arc<TunnelState>) {
    if state.started.swap(true, Ordering::SeqCst) {
        return;
    }
    std::thread::spawn(move || {
        let bin = match ensure_binary(&app_dir) {
            Ok(p) => p,
            Err(e) => {
                eprintln!("cloudflared: {e}");
                state.started.store(false, Ordering::SeqCst);
                return;
            }
        };
        let child = Command::new(bin)
            .args([
                "tunnel",
                "--url",
                &format!("http://localhost:{local_port}"),
                "--no-autoupdate",
            ])
            .stderr(Stdio::piped())
            .stdout(Stdio::null())
            .spawn();
        let mut child = match child {
            Ok(c) => c,
            Err(e) => {
                eprintln!("cloudflared: failed to start: {e}");
                state.started.store(false, Ordering::SeqCst);
                return;
            }
        };
        // cloudflared logs the assigned hostname to stderr. Keep draining the
        // whole stream (not just until the first match) so the pipe never
        // fills up and blocks the child process.
        if let Some(stderr) = child.stderr.take() {
            for line in BufReader::new(stderr).lines().map_while(Result::ok) {
                if let Some(start) = line.find("https://") {
                    if let Some(rel_end) = line[start..].find(".trycloudflare.com") {
                        let end = start + rel_end + ".trycloudflare.com".len();
                        let wss_url = line[start..end].replacen("https://", "wss://", 1);
                        *state.url.lock().unwrap() = Some(wss_url);
                    }
                }
            }
        }
        let _ = child.wait();
        // Tunnel process died (network blip, Cloudflare edge reset, etc.) —
        // clear the stale URL so the UI shows "connecting" instead of a dead
        // address, and allow a future start() call to spawn a fresh one.
        *state.url.lock().unwrap() = None;
        state.started.store(false, Ordering::SeqCst);
    });
}
