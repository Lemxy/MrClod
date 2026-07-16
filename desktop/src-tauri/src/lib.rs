mod crypto;
mod hooks_http;
mod tunnel;
mod ws;

use rusqlite::Connection;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::net::IpAddr;
use std::process::Command;
use std::sync::{Arc, Mutex};
use std::time::Instant;
use tauri::{AppHandle, Manager, State};

#[derive(Clone)]
pub struct AppState {
    db: Arc<Mutex<Connection>>,
    // ponytail: one global lock around every `claude` CLI invocation. Two
    // concurrent new_request calls for the same session could otherwise
    // race on reading/writing `claude_session_id` (both see "none", both
    // mint a fresh --session-id, one silently overwrites the other's row).
    // A single mutex serializes all sessions, not just the contended one —
    // fine for a personal-use tool; split into a per-session lock map if
    // multiple chats ever need to run Claude Code truly in parallel.
    claude_lock: Arc<Mutex<()>>,
    pub broadcast: tokio::sync::broadcast::Sender<String>,
    pub token: Arc<Mutex<String>>,
    // Failed auth attempts per source IP. The pairing token is short enough to
    // type by hand, so it is also short enough to brute-force: without a limit,
    // an attacker who can reach port 7878 just enumerates it and lands
    // arbitrary code execution on this machine.
    pub auth_failures: Arc<Mutex<HashMap<IpAddr, (u32, Instant)>>>,
    pub app_handle: AppHandle,
    // Enabling "skip" permission mode grants unattended Bash/Write/Edit RCE to
    // anyone holding the pairing token, with zero confirmation on this
    // machine. Requests to enable it block on a yes/no dialog shown in the
    // desktop window instead of taking effect immediately; the sender here
    // wakes the waiting WS handler once the user answers (or the request
    // times out, which counts as "no").
    pub pending_skip_approvals: Arc<Mutex<HashMap<String, tokio::sync::oneshot::Sender<bool>>>>,
    // Same idea as pending_skip_approvals but for per-tool-call "ask" mode
    // prompts, answered from hooks_http.rs's /permission_request handler
    // (a plain thread, not tokio — hence std::sync::mpsc, not oneshot).
    pub pending_permission_approvals: Arc<Mutex<HashMap<String, std::sync::mpsc::Sender<bool>>>>,
    pub tunnel: Arc<tunnel::TunnelState>,
    pub app_dir: std::path::PathBuf,
    // A client that already knows the token could otherwise spam the skip-
    // permission dialog on the desktop hoping for an exhausted, distracted
    // click-through. One prompt per session per cooldown window.
    pub last_skip_request: Arc<Mutex<HashMap<String, Instant>>>,
}

#[derive(Serialize, Deserialize, Clone)]
pub struct HistoryItem {
    id: i64,
    role: String,
    content: String,
    created_at: String,
    image_base64: Option<String>,
}

#[derive(Serialize, Deserialize, Clone)]
pub struct SessionInfo {
    id: String,
    title: String,
    created_at: String,
    model: Option<String>,
    effort: Option<String>,
    permission_mode: Option<String>,
}

fn init_db(conn: &Connection) {
    conn.execute(
        "CREATE TABLE IF NOT EXISTS sessions (
            id TEXT PRIMARY KEY,
            title TEXT NOT NULL,
            claude_session_id TEXT,
            model TEXT,
            created_at TEXT NOT NULL DEFAULT (datetime('now'))
        )",
        [],
    )
    .expect("failed to create sessions table");
    // ponytail: same ALTER-if-missing pattern as the messages.session_id
    // migration below — sessions.model didn't exist before model switching.
    if conn.prepare("SELECT model FROM sessions LIMIT 1").is_err() {
        conn.execute("ALTER TABLE sessions ADD COLUMN model TEXT", [])
            .ok();
    }
    if conn.prepare("SELECT effort FROM sessions LIMIT 1").is_err() {
        conn.execute("ALTER TABLE sessions ADD COLUMN effort TEXT", [])
            .ok();
    }
    // ponytail: 'ask' (default) leaves tool-call permissions to Claude Code's
    // normal deny-in-headless-mode behavior; 'skip' adds the two
    // --dangerously-skip-permissions flags for unattended runs. Defaulting
    // new/open-source installs to 'ask' is the safer out-of-the-box choice.
    if conn.prepare("SELECT permission_mode FROM sessions LIMIT 1").is_err() {
        conn.execute("ALTER TABLE sessions ADD COLUMN permission_mode TEXT", [])
            .ok();
    }
    conn.execute(
        "CREATE TABLE IF NOT EXISTS messages (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            session_id TEXT NOT NULL,
            role TEXT NOT NULL,
            content TEXT NOT NULL,
            created_at TEXT NOT NULL DEFAULT (datetime('now'))
        )",
        [],
    )
    .expect("failed to create messages table");
    conn.execute(
        "CREATE TABLE IF NOT EXISTS config (key TEXT PRIMARY KEY, value TEXT NOT NULL)",
        [],
    )
    .expect("failed to create config table");

    if conn.prepare("SELECT image_base64 FROM messages LIMIT 1").is_err() {
        conn.execute("ALTER TABLE messages ADD COLUMN image_base64 TEXT", [])
            .ok();
    }

    // ponytail: one-time migration for pre-multi-session databases — old
    // `messages` rows had no session_id column at all. If the column is
    // missing, add it and backfill every existing row into a single
    // "Default" session so history isn't lost.
    let column_missing = conn
        .prepare("SELECT session_id FROM messages LIMIT 1")
        .err()
        .is_some();
    if column_missing {
        conn.execute("ALTER TABLE messages ADD COLUMN session_id TEXT", [])
            .ok();
        let default_id = uuid::Uuid::new_v4().to_string();
        conn.execute(
            "INSERT INTO sessions (id, title) VALUES (?1, 'Default')",
            [&default_id],
        )
        .ok();
        conn.execute(
            "UPDATE messages SET session_id = ?1 WHERE session_id IS NULL",
            [&default_id],
        )
        .ok();
    }
}

// The alphabet has no ambiguous 0/O/1/I, so the code stays quick to read off one
// screen and type on another.
// The token is the only thing standing between the network and `claude` running
// on this machine, so it needs real entropy: 6 chars over this alphabet was only
// ~30 bits, which a determined attacker enumerates. 12 chars is ~60 bits and
// still short enough to read off the screen.
//
// `% 32` keeps the low 5 bits of each byte, and v4's fixed version/variant bits
// live in the high nibbles of bytes 6 and 8, so every byte still contributes 5
// random bits. 32 also divides 256 evenly, so there's no modulo bias.
// Bumped from 12 with the internet tunnel becoming default-on: a token that
// was "good enough" when only reachable from the home LAN needs more margin
// once it's reachable from anywhere. 16 chars from the 33-char alphabet is
// ~82 bits for a generated token.
pub(crate) const MIN_TOKEN_LEN: usize = 16;
pub(crate) const MIN_TOKEN_DISTINCT_CHARS: usize = 8;

fn generate_short_token() -> String {
    const ALPHABET: &[u8] = b"ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
    uuid::Uuid::new_v4().into_bytes()[..MIN_TOKEN_LEN]
        .iter()
        .map(|b| ALPHABET[(*b as usize) % ALPHABET.len()] as char)
        .collect()
}

/// Compare in constant time so a network attacker can't recover the token byte
/// by byte from response timing. Length is not secret (it's fixed).
pub(crate) fn token_eq(a: &str, b: &str) -> bool {
    let (a, b) = (a.as_bytes(), b.as_bytes());
    if a.len() != b.len() {
        return false;
    }
    a.iter().zip(b).fold(0u8, |acc, (x, y)| acc | (x ^ y)) == 0
}

pub(crate) const MAX_AUTH_FAILURES: u32 = 5;
pub(crate) const AUTH_LOCKOUT: std::time::Duration = std::time::Duration::from_secs(60);

fn auth_failures_path(app_dir: &std::path::Path) -> std::path::PathBuf {
    app_dir.join("auth_failures.json")
}

/// Loaded once at startup so a restart mid-brute-force doesn't hand the
/// attacker a fresh 5 free guesses — matters a lot more now that the tunnel
/// makes this endpoint reachable from the whole internet by default, not
/// just the LAN. Stale (already-expired) entries are dropped on load.
pub(crate) fn load_auth_failures(app_dir: &std::path::Path) -> HashMap<IpAddr, (u32, Instant)> {
    let Ok(raw) = std::fs::read_to_string(auth_failures_path(app_dir)) else {
        return HashMap::new();
    };
    let Ok(entries) = serde_json::from_str::<HashMap<IpAddr, (u32, u64)>>(&raw) else {
        return HashMap::new();
    };
    let now_unix = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs();
    let now_instant = Instant::now();
    entries
        .into_iter()
        .filter_map(|(ip, (count, last_unix))| {
            let age = now_unix.saturating_sub(last_unix);
            if age >= AUTH_LOCKOUT.as_secs() {
                return None;
            }
            // Instant has no cross-process representation, so reconstruct one
            // that's `age` seconds in the past relative to "now" in this run.
            let last = now_instant.checked_sub(std::time::Duration::from_secs(age))?;
            Some((ip, (count, last)))
        })
        .collect()
}

fn save_auth_failures(state: &AppState) {
    let failures = state.auth_failures.lock().unwrap();
    let now_unix = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs();
    let serializable: HashMap<IpAddr, (u32, u64)> = failures
        .iter()
        .map(|(ip, (count, last))| {
            let age = last.elapsed().as_secs();
            (*ip, (*count, now_unix.saturating_sub(age)))
        })
        .collect();
    drop(failures);
    if let Ok(json) = serde_json::to_string(&serializable) {
        let _ = std::fs::write(auth_failures_path(&state.app_dir), json);
    }
}

/// True while `ip` is locked out for burning through MAX_AUTH_FAILURES.
/// Caps a brute-force at 5 guesses per minute per source, which turns even the
/// legacy 6-char (~30-bit) tokens from hours-of-work into millennia.
pub(crate) fn auth_locked_out(state: &AppState, ip: IpAddr) -> bool {
    let mut failures = state.auth_failures.lock().unwrap();
    // drop entries whose lockout has elapsed, so the map can't grow forever
    failures.retain(|_, (_, last)| last.elapsed() < AUTH_LOCKOUT);
    match failures.get(&ip) {
        Some((count, last)) => *count >= MAX_AUTH_FAILURES && last.elapsed() < AUTH_LOCKOUT,
        None => false,
    }
}

pub(crate) fn record_auth_failure(state: &AppState, ip: IpAddr) {
    {
        let mut failures = state.auth_failures.lock().unwrap();
        let entry = failures.entry(ip).or_insert((0, Instant::now()));
        entry.0 += 1;
        entry.1 = Instant::now();
    }
    save_auth_failures(state);
}

pub(crate) fn clear_auth_failures(state: &AppState, ip: IpAddr) {
    state.auth_failures.lock().unwrap().remove(&ip);
    save_auth_failures(state);
}

fn get_or_create_token(conn: &Connection) -> String {
    if let Ok(existing) = conn.query_row(
        "SELECT value FROM config WHERE key = 'pairing_token'",
        [],
        |row| row.get::<_, String>(0),
    ) {
        return existing;
    }
    let token = generate_short_token();
    conn.execute(
        "INSERT INTO config (key, value) VALUES ('pairing_token', ?1)",
        [&token],
    )
    .expect("failed to store pairing token");
    token
}

pub(crate) fn set_pairing_token(conn: &Connection, token: &str) {
    conn.execute(
        "INSERT INTO config (key, value) VALUES ('pairing_token', ?1)
         ON CONFLICT(key) DO UPDATE SET value = excluded.value",
        [token],
    )
    .expect("failed to update pairing token");
}

/// True exactly once (the first call ever, across the app's whole lifetime)
/// so the desktop UI can show a one-time "your computer is now reachable
/// from the internet" notice instead of silently enabling it. Every
/// subsequent call — including after reinstalls that keep the same app data
/// dir — returns false.
#[tauri::command]
fn should_show_internet_notice(state: State<AppState>) -> bool {
    let conn = state.db.lock().unwrap();
    let already_shown: bool = conn
        .query_row(
            "SELECT value FROM config WHERE key = 'internet_notice_shown'",
            [],
            |row| row.get::<_, String>(0),
        )
        .is_ok();
    if already_shown {
        return false;
    }
    conn.execute(
        "INSERT INTO config (key, value) VALUES ('internet_notice_shown', '1')
         ON CONFLICT(key) DO NOTHING",
        [],
    )
    .ok();
    true
}

fn save_message(conn: &Connection, session_id: &str, role: &str, content: &str, image_base64: Option<&str>) {
    conn.execute(
        "INSERT INTO messages (session_id, role, content, image_base64) VALUES (?1, ?2, ?3, ?4)",
        rusqlite::params![session_id, role, content, image_base64],
    )
    .expect("failed to insert message");
}

pub(crate) fn load_history(conn: &Connection, session_id: &str) -> Vec<HistoryItem> {
    let mut stmt = conn
        .prepare("SELECT id, role, content, created_at, image_base64 FROM messages WHERE session_id = ?1 ORDER BY id ASC")
        .unwrap();
    let rows = stmt
        .query_map([session_id], |row| {
            Ok(HistoryItem {
                id: row.get(0)?,
                role: row.get(1)?,
                content: row.get(2)?,
                created_at: row.get(3)?,
                image_base64: row.get(4)?,
            })
        })
        .unwrap();
    rows.filter_map(|r| r.ok()).collect()
}

pub(crate) fn list_sessions(conn: &Connection) -> Vec<SessionInfo> {
    let mut stmt = conn
        .prepare("SELECT id, title, created_at, model, effort, permission_mode FROM sessions ORDER BY created_at ASC")
        .unwrap();
    let rows = stmt
        .query_map([], |row| {
            Ok(SessionInfo {
                id: row.get(0)?,
                title: row.get(1)?,
                created_at: row.get(2)?,
                model: row.get(3)?,
                effort: row.get(4)?,
                permission_mode: row.get(5)?,
            })
        })
        .unwrap();
    rows.filter_map(|r| r.ok()).collect()
}

pub(crate) fn create_session(conn: &Connection, title: &str) -> SessionInfo {
    let id = uuid::Uuid::new_v4().to_string();
    let title = if title.trim().is_empty() { "Новый чат" } else { title };
    conn.execute(
        "INSERT INTO sessions (id, title) VALUES (?1, ?2)",
        [&id, title],
    )
    .expect("failed to insert session");
    conn.query_row(
        "SELECT id, title, created_at, model, effort, permission_mode FROM sessions WHERE id = ?1",
        [&id],
        |row| {
            Ok(SessionInfo {
                id: row.get(0)?,
                title: row.get(1)?,
                created_at: row.get(2)?,
                model: row.get(3)?,
                effort: row.get(4)?,
                permission_mode: row.get(5)?,
            })
        },
    )
    .expect("failed to load just-inserted session")
}

pub(crate) fn set_session_permission_mode(conn: &Connection, session_id: &str, mode: Option<&str>) {
    conn.execute(
        "UPDATE sessions SET permission_mode = ?1 WHERE id = ?2",
        rusqlite::params![mode, session_id],
    )
    .ok();
}

// Allowlists for values that end up as argv entries to `claude.cmd` — on
// Windows that runs through cmd.exe, whose batch-file argument parsing can be
// abused to break out of quoting (the "BatBadBut" class, CVE-2024-24576) if
// the string is attacker-controlled. Reject anything outside the known set
// instead of trusting client input.
pub(crate) const ALLOWED_MODELS: &[&str] = &["sonnet", "opus", "haiku", "fable"];
pub(crate) const ALLOWED_EFFORTS: &[&str] = &["low", "medium", "high", "xhigh", "max"];

pub(crate) fn set_session_model(conn: &Connection, session_id: &str, model: Option<&str>) {
    if let Some(m) = model {
        if !ALLOWED_MODELS.contains(&m) {
            return;
        }
    }
    conn.execute(
        "UPDATE sessions SET model = ?1 WHERE id = ?2",
        rusqlite::params![model, session_id],
    )
    .ok();
}

pub(crate) fn set_session_effort(conn: &Connection, session_id: &str, effort: Option<&str>) {
    if let Some(e) = effort {
        if !ALLOWED_EFFORTS.contains(&e) {
            return;
        }
    }
    conn.execute(
        "UPDATE sessions SET effort = ?1 WHERE id = ?2",
        rusqlite::params![effort, session_id],
    )
    .ok();
}

pub(crate) fn delete_session(conn: &Connection, session_id: &str) {
    conn.execute("DELETE FROM messages WHERE session_id = ?1", [session_id])
        .ok();
    conn.execute("DELETE FROM sessions WHERE id = ?1", [session_id])
        .ok();
}

fn ensure_default_session(conn: &Connection) -> String {
    if let Ok(existing) = conn.query_row(
        "SELECT id FROM sessions ORDER BY created_at ASC LIMIT 1",
        [],
        |row| row.get::<_, String>(0),
    ) {
        return existing;
    }
    create_session(conn, "Default").id
}

// ponytail: no Tauri-command chat API here on purpose — the desktop window
// talks to its own WS server (ws.rs) over ws://127.0.0.1:WS_PORT exactly
// like the phone does. One protocol for session switch/create/delete/model
// and message sending means both clients see the same live state with no
// separate broadcast wiring to keep in sync.

#[derive(Serialize)]
struct PairingInfo {
    token: String,
    port: u16,
    ip: String,
    tunnel_url: Option<String>,
}

fn pairing_info(state: &AppState) -> PairingInfo {
    let ip = local_ip_address::local_ip()
        .map(|ip| ip.to_string())
        .unwrap_or_else(|_| "127.0.0.1".into());
    PairingInfo {
        token: state.token.lock().unwrap().clone(),
        port: ws::WS_PORT,
        ip,
        tunnel_url: state.tunnel.url.lock().unwrap().clone(),
    }
}

#[tauri::command]
fn get_pairing_info(state: State<AppState>) -> PairingInfo {
    // Polled every 2s while the pairing panel is open — a cheap place to
    // retry a tunnel that failed to start (spawn error, transient download
    // failure) since tunnel::start() is a no-op while one is already running.
    tunnel::start(state.app_dir.clone(), ws::WS_PORT, state.tunnel.clone());
    pairing_info(&state)
}

#[tauri::command]
fn set_pairing_token_cmd(state: State<AppState>, token: String) -> Result<(), String> {
    let token = token.trim();
    if token.is_empty() {
        return Err("token can't be empty".into());
    }
    // a hand-picked token guards code execution on this machine just like a
    // generated one, so it doesn't get to be shorter than what we generate
    if token.chars().count() < MIN_TOKEN_LEN {
        return Err(format!("token must be at least {MIN_TOKEN_LEN} characters"));
    }
    // Length alone doesn't stop "aaaaaaaaaaaaaaaa" — with the tunnel
    // reachable from the internet by default, a low-entropy custom token is
    // a realistic brute-force target, not just a theoretical one.
    let distinct = token.chars().collect::<std::collections::HashSet<_>>().len();
    if distinct < MIN_TOKEN_DISTINCT_CHARS {
        return Err(format!(
            "token must use at least {MIN_TOKEN_DISTINCT_CHARS} different characters"
        ));
    }
    {
        let conn = state.db.lock().unwrap();
        set_pairing_token(&conn, token);
    }
    *state.token.lock().unwrap() = token.to_string();
    Ok(())
}

#[tauri::command]
fn regenerate_pairing_token(state: State<AppState>) -> String {
    let new_token = generate_short_token();
    {
        let conn = state.db.lock().unwrap();
        set_pairing_token(&conn, &new_token);
    }
    *state.token.lock().unwrap() = new_token.clone();
    new_token
}

#[tauri::command]
fn respond_skip_permission(state: State<AppState>, approval_id: String, approve: bool) {
    if let Some(tx) = state.pending_skip_approvals.lock().unwrap().remove(&approval_id) {
        let _ = tx.send(approve);
    }
}

/// Blocks until the desktop UI answers the "enable skip permissions?" dialog
/// (or 30s pass, which counts as "no"). Emits `skip_permission_request` with
/// {approval_id, session_id} for App.jsx to render and answer via the
/// `respond_skip_permission` command above.
pub(crate) const SKIP_REQUEST_COOLDOWN: std::time::Duration = std::time::Duration::from_secs(10);

pub(crate) async fn confirm_skip_permission(state: &AppState, session_id: &str) -> bool {
    {
        let mut last = state.last_skip_request.lock().unwrap();
        if let Some(prev) = last.get(session_id) {
            if prev.elapsed() < SKIP_REQUEST_COOLDOWN {
                // Silently deny — no dialog, no popup storm. The client
                // already got a "declined" answer for this session recently.
                return false;
            }
        }
        last.insert(session_id.to_string(), Instant::now());
    }

    let approval_id = uuid::Uuid::new_v4().to_string();
    let (tx, rx) = tokio::sync::oneshot::channel();
    state
        .pending_skip_approvals
        .lock()
        .unwrap()
        .insert(approval_id.clone(), tx);

    use tauri::Emitter;
    if state
        .app_handle
        .emit(
            "skip_permission_request",
            serde_json::json!({"approval_id": approval_id, "session_id": session_id}),
        )
        .is_err()
    {
        state.pending_skip_approvals.lock().unwrap().remove(&approval_id);
        return false;
    }

    let approved = tokio::time::timeout(std::time::Duration::from_secs(30), rx)
        .await
        .ok()
        .and_then(|r| r.ok())
        .unwrap_or(false);
    state.pending_skip_approvals.lock().unwrap().remove(&approval_id);
    approved
}

#[tauri::command]
fn get_pairing_qr(state: State<AppState>) -> Result<String, String> {
    let info = pairing_info(&state);
    // Mobile already treats an "ip" containing "://" as a full URL and skips
    // appending the port (see App.js connect()) — reuse that path so a
    // tunnel URL just works through the same QR flow as a bare LAN IP.
    let address = info.tunnel_url.as_deref().unwrap_or(&info.ip);
    let payload = serde_json::json!({"ip": address, "port": info.port, "token": info.token}).to_string();

    use image::ImageEncoder;
    let code = qrcode::QrCode::new(payload.as_bytes()).map_err(|e| e.to_string())?;
    let image = code.render::<image::Luma<u8>>().module_dimensions(8, 8).build();

    let mut png_bytes: Vec<u8> = Vec::new();
    image::codecs::png::PngEncoder::new(&mut png_bytes)
        .write_image(
            image.as_raw(),
            image.width(),
            image.height(),
            image::ExtendedColorType::L8,
        )
        .map_err(|e| e.to_string())?;

    Ok(format!(
        "data:image/png;base64,{}",
        base64::Engine::encode(&base64::engine::general_purpose::STANDARD, &png_bytes)
    ))
}

// ponytail: one-shot `-p` call per message instead of a long-lived interactive
// subprocess with piped stdin. Simpler, no stdin-framing/deadlock risk.
// Session continuity via --session-id / --resume, tracked per chat session
// in the `sessions.claude_session_id` column (not in-memory) so multiple
// concurrent chats each keep their own Claude Code conversation.
pub struct ClaudeReply {
    pub text: String,
    pub image_base64: Option<String>,
}

pub fn run_claude(state: &AppState, session_id: &str, message: &str) -> Result<ClaudeReply, String> {
    {
        let conn = state.db.lock().unwrap();
        save_message(&conn, session_id, "user", message, None);
    }

    let output = run_claude_cli(state, session_id, message)?;

    // ponytail: Claude Code's session store can lose track of a resumed
    // session (observed as "No conversation found with session ID: ..."),
    // e.g. after the CLI's own housekeeping. One transparent retry on a
    // fresh session beats surfacing a dead end to the user.
    let output = if !output.status.success()
        && String::from_utf8_lossy(&output.stderr).contains("No conversation found")
    {
        let conn = state.db.lock().unwrap();
        conn.execute(
            "UPDATE sessions SET claude_session_id = NULL WHERE id = ?1",
            [session_id],
        )
        .ok();
        drop(conn);
        run_claude_cli(state, session_id, message)?
    } else {
        output
    };

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr).to_string();
        return Err(format!("claude exited with error: {stderr}"));
    }

    let stdout = String::from_utf8_lossy(&output.stdout);
    let parsed: serde_json::Value =
        serde_json::from_str(&stdout).map_err(|e| format!("failed to parse claude output: {e}"))?;
    let reply = parsed
        .get("result")
        .and_then(|v| v.as_str())
        .unwrap_or(&stdout)
        .to_string();

    // Claude Code is told (via --append-system-prompt in run_claude_cli) to
    // save any screenshot it takes to this fixed path instead of describing
    // it in text. One path is safe here because claude_lock serializes every
    // invocation across all sessions — only one can ever be writing it.
    let screenshot_path = screenshot_outbox_path(&state.app_dir);
    let image_base64 = std::fs::read(&screenshot_path).ok().map(|bytes| {
        let _ = std::fs::remove_file(&screenshot_path);
        base64::Engine::encode(&base64::engine::general_purpose::STANDARD, &bytes)
    });

    {
        let conn = state.db.lock().unwrap();
        save_message(&conn, session_id, "assistant", &reply, image_base64.as_deref());
    }

    Ok(ClaudeReply { text: reply, image_base64 })
}

fn screenshot_outbox_path(app_dir: &std::path::Path) -> std::path::PathBuf {
    app_dir.join("screenshot_outbox.png")
}

fn permission_prompt_script_path(app_dir: &std::path::Path) -> std::path::PathBuf {
    app_dir.join("permission-prompt-mcp.js")
}

fn run_claude_cli(
    state: &AppState,
    session_id: &str,
    message: &str,
) -> Result<std::process::Output, String> {
    let _guard = state.claude_lock.lock().unwrap();

    let claude_bin = if cfg!(windows) {
        "claude.cmd"
    } else {
        "claude"
    };
    let mut cmd = Command::new(claude_bin);
    // claude.cmd routes through cmd.exe, which — spawned from a GUI app with
    // no console of its own — pops up a real console window per invocation
    // (and claude in turn spawns the permission-prompt MCP server as a
    // grandchild, another window without this). CREATE_NO_WINDOW keeps the
    // whole tree console-less; stdout/stderr are already piped above so
    // nothing is lost, there's just nothing visible to show.
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x08000000;
        cmd.creation_flags(CREATE_NO_WINDOW);
    }
    // ponytail: pass the prompt over stdin instead of as an argv entry.
    // Command::new on Windows routes .cmd files through cmd.exe, whose
    // argument parsing chokes on newlines/quotes/special chars in the
    // message ("batch file arguments are invalid"); stdin sidesteps that
    // whole escaping problem and works identically on every platform.
    cmd.arg("-p")
        .arg("--output-format")
        .arg("json")
        .stdin(std::process::Stdio::piped());

    // Screenshot support: tell Claude Code where to save one instead of
    // describing pixels in text — run_claude() picks the file up after this
    // process exits and attaches it to the chat message. Windows-only for
    // now (PowerShell GDI+ screen capture); no-op elsewhere.
    let screenshot_path = screenshot_outbox_path(&state.app_dir);
    let _ = std::fs::remove_file(&screenshot_path);
    if cfg!(windows) {
        let ps_capture = format!(
            "Add-Type -AssemblyName System.Windows.Forms,System.Drawing; \
             $b=[System.Windows.Forms.Screen]::PrimaryScreen.Bounds; \
             $bmp=New-Object System.Drawing.Bitmap $b.Width,$b.Height; \
             $g=[System.Drawing.Graphics]::FromImage($bmp); \
             $g.CopyFromScreen($b.Location,[System.Drawing.Point]::Empty,$b.Size); \
             $bmp.Save('{}')",
            screenshot_path.display()
        );
        let system_prompt = format!(
            "If the user asks for a screenshot or to see the screen, capture it by running \
             exactly this command via the Bash tool, then just briefly confirm in your reply \
             without describing the image — it is attached to the chat automatically: \
             powershell -NoProfile -Command \"{ps_capture}\""
        );
        // ponytail: this string is full of quotes/$/parens that cmd.exe's
        // batch-file argv parsing (claude.cmd routes through it) mangles —
        // observed as "-AssemblyName" leaking out as its own bogus argv
        // entry, which the claude CLI then rejects as an unknown option.
        // Writing it to a file and passing the path (no special chars)
        // sidesteps the same cmd.exe quoting problem the stdin-for-message
        // comment above already describes.
        let system_prompt_path = state.app_dir.join("screenshot_system_prompt.txt");
        if std::fs::write(&system_prompt_path, system_prompt).is_ok() {
            cmd.arg("--append-system-prompt-file").arg(&system_prompt_path);
        }
    }

    let (existing_claude_session, model, effort, permission_mode): (
        Option<String>,
        Option<String>,
        Option<String>,
        Option<String>,
    ) = {
        let conn = state.db.lock().unwrap();
        conn.query_row(
            "SELECT claude_session_id, model, effort, permission_mode FROM sessions WHERE id = ?1",
            [session_id],
            |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?, row.get(3)?)),
        )
        .unwrap_or((None, None, None, None))
    };

    // ponytail: 'skip' is opt-in per session, not a hardcoded default — every
    // tool call (Bash/Edit/Write/etc.) then runs with zero confirmation, so
    // anyone with the pairing token gets unattended code execution on this
    // machine. 'ask' (or unset) wires up --permission-prompt-tool below so
    // every tool call actually blocks on a real allow/deny from the phone or
    // desktop instead of silently running (headless `-p` has no channel to
    // ask a question through on its own — it just executes or refuses).
    if permission_mode.as_deref() == Some("skip") {
        cmd.arg("--allow-dangerously-skip-permissions")
            .arg("--dangerously-skip-permissions");
    } else {
        let script_path = permission_prompt_script_path(&state.app_dir);
        let mcp_config_path = state.app_dir.join(format!("mcp-permission-{session_id}.json"));
        let mcp_config = serde_json::json!({
            "mcpServers": {
                "mrclod-permission": {
                    "type": "stdio",
                    "command": "node",
                    "args": [script_path.to_string_lossy()],
                    "env": {
                        "MRCLOD_SESSION_ID": session_id,
                        "MRCLOD_HOOK_PORT": hooks_http::HOOK_PORT.to_string(),
                    }
                }
            }
        });
        if std::fs::write(&mcp_config_path, mcp_config.to_string()).is_ok() {
            cmd.arg("--mcp-config")
                .arg(&mcp_config_path)
                .arg("--permission-prompt-tool")
                .arg("mcp__mrclod-permission__approval_prompt");
        }
    }

    if let Some(model) = model {
        cmd.arg("--model").arg(model);
    }

    if let Some(effort) = effort {
        cmd.arg("--effort").arg(effort);
    }

    match existing_claude_session {
        Some(id) => {
            cmd.arg("--resume").arg(id);
        }
        None => {
            let new_id = uuid::Uuid::new_v4().to_string();
            cmd.arg("--session-id").arg(&new_id);
            let conn = state.db.lock().unwrap();
            conn.execute(
                "UPDATE sessions SET claude_session_id = ?1 WHERE id = ?2",
                [&new_id, session_id],
            )
            .ok();
        }
    }

    cmd.stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::piped());
    let mut child = cmd.spawn().map_err(|e| format!("failed to spawn claude: {e}"))?;
    {
        use std::io::Write;
        let mut stdin = child.stdin.take().expect("child stdin was piped");
        stdin
            .write_all(message.as_bytes())
            .map_err(|e| format!("failed to write prompt to claude stdin: {e}"))?;
    }
    child
        .wait_with_output()
        .map_err(|e| format!("failed to read claude output: {e}"))
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_opener::init())
        .setup(|app| {
            let app_dir = app
                .path()
                .app_data_dir()
                .expect("failed to resolve app data dir");
            std::fs::create_dir_all(&app_dir).expect("failed to create app data dir");
            let db_file = app_dir.join("history.db");
            let conn = Connection::open(db_file).expect("failed to open sqlite db");
            init_db(&conn);
            ensure_default_session(&conn);
            let token = get_or_create_token(&conn);
            let (tx, _rx) = tokio::sync::broadcast::channel(64);

            let state = AppState {
                db: Arc::new(Mutex::new(conn)),
                claude_lock: Arc::new(Mutex::new(())),
                broadcast: tx,
                token: Arc::new(Mutex::new(token)),
                auth_failures: Arc::new(Mutex::new(load_auth_failures(&app_dir))),
                app_handle: app.handle().clone(),
                pending_skip_approvals: Arc::new(Mutex::new(HashMap::new())),
                pending_permission_approvals: Arc::new(Mutex::new(HashMap::new())),
                tunnel: Arc::new(tunnel::TunnelState::new()),
                app_dir: app_dir.clone(),
                last_skip_request: Arc::new(Mutex::new(HashMap::new())),
            };

            // Written once at startup so run_claude_cli can point Claude
            // Code's --mcp-config at a stable on-disk path for every "ask"
            // mode invocation.
            std::fs::write(
                permission_prompt_script_path(&app_dir),
                include_str!("../assets/permission-prompt-mcp.js"),
            )
            .expect("failed to write permission-prompt-mcp.js");

            app.manage(state.clone());
            ws::spawn_server(state.clone());
            // Base mode: internet pairing is on by default, not gated behind
            // a button, so a fresh install works away from the LAN out of
            // the box. Token + AES-GCM framing (crypto.rs) are what actually
            // gate access; the tunnel is just transport.
            tunnel::start(state.app_dir.clone(), ws::WS_PORT, state.tunnel.clone());
            hooks_http::spawn_server(state);

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            get_pairing_info,
            get_pairing_qr,
            set_pairing_token_cmd,
            regenerate_pairing_token,
            respond_skip_permission,
            should_show_internet_notice
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn token_eq_matches_only_identical_tokens() {
        assert!(token_eq("ABC123XYZ789", "ABC123XYZ789"));
        assert!(!token_eq("ABC123XYZ789", "ABC123XYZ788")); // last byte differs
        assert!(!token_eq("ABC123XYZ789", "BBC123XYZ789")); // first byte differs
        assert!(!token_eq("ABC", "ABC123XYZ789")); // prefix is not a match
        assert!(!token_eq("", "ABC123XYZ789"));
    }

    #[test]
    fn generated_tokens_are_long_and_not_repeated() {
        let a = generate_short_token();
        assert_eq!(a.chars().count(), MIN_TOKEN_LEN);
        assert!(a.chars().all(|c| c.is_ascii_uppercase() || c.is_ascii_digit()));
        // 60 bits of entropy: a collision across 100 draws would mean the
        // generator is broken, not unlucky
        let mut seen = std::collections::HashSet::new();
        for _ in 0..100 {
            assert!(seen.insert(generate_short_token()), "duplicate token");
        }
    }
}
