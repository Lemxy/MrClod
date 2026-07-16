use crate::crypto::{decrypt, derive_key, encrypt};
use crate::{run_claude, AppState};
use aes_gcm::{Aes256Gcm, Key};
use futures_util::stream::{SplitSink, SplitStream};
use futures_util::{SinkExt, StreamExt};
use mdns_sd::{ServiceDaemon, ServiceInfo};
use serde_json::{json, Value};
use tokio::net::TcpStream;
use tokio::net::TcpListener;
use tokio_tungstenite::tungstenite::Message;
use tokio_tungstenite::WebSocketStream;

type WsWrite = SplitSink<WebSocketStream<TcpStream>, Message>;
type WsRead = SplitStream<WebSocketStream<TcpStream>>;

/// Every frame on the wire is `nonce || AES-256-GCM(json)` inside a binary
/// WS message — see crypto.rs for why. `Message::Text` is no longer used at
/// the WS protocol level.
async fn send_json(
    write: &mut WsWrite,
    key: &Key<Aes256Gcm>,
    value: &Value,
) -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
    let bytes = encrypt(key, value.to_string().as_bytes());
    write.send(Message::Binary(bytes)).await?;
    Ok(())
}

/// Reads the next inbound WS message and decrypts it. `Ok(None)` means the
/// connection ended cleanly (Close/EOF); `Err` means malformed/undecryptable
/// input, which the caller treats the same as a bad token.
async fn recv_json(
    read: &mut WsRead,
    key: &Key<Aes256Gcm>,
) -> Result<Option<Value>, Box<dyn std::error::Error + Send + Sync>> {
    match read.next().await {
        Some(Ok(Message::Binary(bytes))) => match decrypt(key, &bytes) {
            Some(plain) => Ok(Some(serde_json::from_slice(&plain).unwrap_or(json!({})))),
            None => Err("decrypt failed".into()),
        },
        Some(Ok(Message::Close(_))) | None => Ok(None),
        Some(Ok(_)) => Err("expected binary frame".into()),
        Some(Err(e)) => Err(e.into()),
    }
}

pub const WS_PORT: u16 = 7878;
const SERVICE_TYPE: &str = "_claudecoderemote._tcp.local.";

fn advertise_mdns() {
    let Ok(mdns) = ServiceDaemon::new() else {
        eprintln!("mDNS: failed to start daemon, skipping discovery advertisement");
        return;
    };
    let host_name = format!(
        "{}.local.",
        hostname::get()
            .ok()
            .and_then(|h| h.into_string().ok())
            .unwrap_or_else(|| "claude-code-remote".into())
    );
    let ip = local_ip_address::local_ip()
        .map(|ip| ip.to_string())
        .unwrap_or_else(|_| "127.0.0.1".into());
    let instance = "claude-code-remote";
    match ServiceInfo::new(SERVICE_TYPE, instance, &host_name, ip, WS_PORT, None) {
        Ok(service) => {
            if let Err(e) = mdns.register(service) {
                eprintln!("mDNS: failed to register service: {e}");
            } else {
                println!("mDNS: advertising {instance} on port {WS_PORT}");
            }
        }
        Err(e) => eprintln!("mDNS: failed to build service info: {e}"),
    }
    // Keep the daemon alive for the lifetime of the process.
    std::mem::forget(mdns);
}

// ponytail: one TCP thread + a single tokio runtime for every WS connection,
// no connection-count limit or backpressure handling. Fine for a handful of
// phones on a home LAN; add a connection cap if that stops being true.
pub fn spawn_server(state: AppState) {
    std::thread::spawn(move || {
        advertise_mdns();
        let rt = tokio::runtime::Runtime::new().expect("failed to build tokio runtime");
        rt.block_on(async move {
            let listener = TcpListener::bind(("0.0.0.0", WS_PORT))
                .await
                .expect("failed to bind websocket port");
            println!("WebSocket server listening on port {WS_PORT}");
            loop {
                let (stream, addr) = match listener.accept().await {
                    Ok(v) => v,
                    Err(e) => {
                        eprintln!("WS accept error: {e}");
                        continue;
                    }
                };
                let state = state.clone();
                tokio::spawn(async move {
                    if let Err(e) = handle_connection(stream, state, addr.ip()).await {
                        eprintln!("WS connection {addr} closed: {e}");
                    }
                });
            }
        });
    });
}

async fn handle_connection(
    stream: tokio::net::TcpStream,
    state: AppState,
    peer_ip: std::net::IpAddr,
) -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
    let ws_stream = tokio_tungstenite::accept_async(stream).await?;
    let (mut write, mut read) = ws_stream.split();

    // Key is derived from the token the server already holds; the client
    // must independently derive the same key from the same token to produce
    // a frame that decrypts. A decrypt failure on the first frame is
    // therefore proof of a wrong/missing token, same as the old plaintext
    // comparison — but the token itself never appears on the wire.
    let expected_token = state.token.lock().unwrap().clone();
    let key = derive_key(&expected_token);

    if crate::auth_locked_out(&state, peer_ip) {
        let _ = send_json(
            &mut write,
            &key,
            &json!({"type": "error", "message": "too many attempts, try again later"}),
        )
        .await;
        return Ok(());
    }

    // First message must decrypt to {"type":"auth","token":"..."}.
    let authed = match recv_json(&mut read, &key).await {
        Ok(Some(v)) => {
            let supplied = v.get("token").and_then(|t| t.as_str()).unwrap_or("");
            v.get("type").and_then(|t| t.as_str()) == Some("auth")
                && crate::token_eq(supplied, &expected_token)
        }
        _ => false,
    };

    if !authed {
        crate::record_auth_failure(&state, peer_ip);
        // Can't send an encrypted error the unauthenticated peer can decrypt
        // without knowing the token, so just close.
        return Ok(());
    }
    crate::clear_auth_failures(&state, peer_ip);
    send_json(&mut write, &key, &json!({"type": "ack"})).await?;

    let sessions = {
        let conn = state.db.lock().unwrap();
        crate::list_sessions(&conn)
    };
    send_json(
        &mut write,
        &key,
        &json!({"type": "sessions", "items": sessions}),
    )
    .await?;

    let mut broadcast_rx = state.broadcast.subscribe();

    loop {
        tokio::select! {
            incoming = recv_json(&mut read, &key) => {
                match incoming {
                    Ok(Some(v)) => {
                        match v.get("type").and_then(|t| t.as_str()) {
                            Some("switch_session") => {
                                if let Some(session_id) = v.get("session_id").and_then(|m| m.as_str()) {
                                    let history = {
                                        let conn = state.db.lock().unwrap();
                                        crate::load_history(&conn, session_id)
                                    };
                                    send_json(&mut write, &key, &json!({
                                        "type": "history",
                                        "session_id": session_id,
                                        "items": history,
                                    })).await?;
                                }
                            }
                            Some("create_session") => {
                                let title = v.get("title").and_then(|t| t.as_str()).unwrap_or("Новый чат").to_string();
                                let session = {
                                    let conn = state.db.lock().unwrap();
                                    crate::create_session(&conn, &title)
                                };
                                // ponytail: broadcast only — this connection is already
                                // subscribed to `broadcast_rx`, a direct send here would
                                // double-deliver the event to the requester.
                                let msg = json!({"type": "session_created", "session": session}).to_string();
                                let _ = state.broadcast.send(msg);
                            }
                            Some("set_model") => {
                                if let Some(session_id) = v.get("session_id").and_then(|m| m.as_str()) {
                                    let model = v.get("model").and_then(|m| m.as_str());
                                    let sessions = {
                                        let conn = state.db.lock().unwrap();
                                        crate::set_session_model(&conn, session_id, model);
                                        crate::list_sessions(&conn)
                                    };
                                    let msg = json!({"type": "sessions", "items": sessions}).to_string();
                                    let _ = state.broadcast.send(msg);
                                }
                            }
                            Some("set_effort") => {
                                if let Some(session_id) = v.get("session_id").and_then(|m| m.as_str()) {
                                    let effort = v.get("effort").and_then(|m| m.as_str());
                                    let sessions = {
                                        let conn = state.db.lock().unwrap();
                                        crate::set_session_effort(&conn, session_id, effort);
                                        crate::list_sessions(&conn)
                                    };
                                    let msg = json!({"type": "sessions", "items": sessions}).to_string();
                                    let _ = state.broadcast.send(msg);
                                }
                            }
                            Some("set_permission_mode") => {
                                if let Some(session_id) = v.get("session_id").and_then(|m| m.as_str()) {
                                    let mode = v.get("permission_mode").and_then(|m| m.as_str());
                                    // "skip" grants unattended RCE on this machine, so it
                                    // needs an explicit yes on the desktop itself — the
                                    // pairing token alone isn't enough. Every other mode
                                    // (unset/"ask") applies immediately as before.
                                    if mode == Some("skip")
                                        && !crate::confirm_skip_permission(&state, session_id).await
                                    {
                                        send_json(&mut write, &key, &json!({
                                            "type": "error",
                                            "session_id": session_id,
                                            "message": "skip permissions declined or timed out on desktop",
                                        })).await?;
                                    } else {
                                        let sessions = {
                                            let conn = state.db.lock().unwrap();
                                            crate::set_session_permission_mode(&conn, session_id, mode);
                                            crate::list_sessions(&conn)
                                        };
                                        let msg = json!({"type": "sessions", "items": sessions}).to_string();
                                        let _ = state.broadcast.send(msg);
                                    }
                                }
                            }
                            Some("respond_permission") => {
                                if let Some(approval_id) = v.get("approval_id").and_then(|m| m.as_str()) {
                                    let approve = v.get("approve").and_then(|m| m.as_bool()).unwrap_or(false);
                                    if let Some(tx) = state.pending_permission_approvals.lock().unwrap().remove(approval_id) {
                                        let _ = tx.send(approve);
                                        // Every connected client (phone + desktop) got the
                                        // original permission_request via broadcast, so the
                                        // resolution needs the same fan-out — otherwise
                                        // whichever client didn't tap the button keeps
                                        // showing a bubble for a request that's already done.
                                        let _ = state.broadcast.send(
                                            json!({"type": "permission_resolved", "approval_id": approval_id}).to_string(),
                                        );
                                    }
                                }
                            }
                            Some("delete_session") => {
                                if let Some(session_id) = v.get("session_id").and_then(|m| m.as_str()) {
                                    let remaining = {
                                        let conn = state.db.lock().unwrap();
                                        crate::delete_session(&conn, session_id);
                                        // ponytail: never let the last chat disappear —
                                        // recreate a Default so the app always has
                                        // somewhere to land instead of an empty state.
                                        let mut sessions = crate::list_sessions(&conn);
                                        if sessions.is_empty() {
                                            sessions.push(crate::create_session(&conn, "Default"));
                                        }
                                        sessions
                                    };
                                    let msg = json!({
                                        "type": "session_deleted",
                                        "session_id": session_id,
                                        "sessions": remaining,
                                    }).to_string();
                                    let _ = state.broadcast.send(msg);
                                }
                            }
                            Some("new_request") => {
                                let session_id = v.get("session_id").and_then(|m| m.as_str()).map(|s| s.to_string());
                                let message = v.get("message").and_then(|m| m.as_str()).map(|s| s.to_string());
                                if let (Some(session_id), Some(message)) = (session_id, message) {
                                    send_json(&mut write, &key, &json!({"type": "status_update", "status": "busy", "session_id": session_id})).await?;
                                    // Run detached so this select loop keeps reading
                                    // messages and forwarding broadcasts while Claude
                                    // works; the result comes back via broadcast.
                                    let state_clone = state.clone();
                                    tokio::spawn(async move {
                                        let sid = session_id.clone();
                                        let st = state_clone.clone();
                                        let result = tokio::task::spawn_blocking(move || run_claude(&st, &sid, &message))
                                            .await
                                            .unwrap_or_else(|e| Err(e.to_string()));
                                        let reply = match result {
                                            Ok(reply) => json!({
                                                "type": "cc_finished",
                                                "session_id": session_id,
                                                "content": reply.text,
                                                "image_base64": reply.image_base64,
                                            }),
                                            Err(err) => json!({"type": "error", "session_id": session_id, "message": err}),
                                        };
                                        let _ = state_clone.broadcast.send(reply.to_string());
                                    });
                                }
                            }
                            _ => {}
                        }
                    }
                    Ok(None) => break,
                    Err(e) => return Err(e),
                }
            }
            Ok(msg) = broadcast_rx.recv() => {
                let value: Value = serde_json::from_str(&msg).unwrap_or(json!({}));
                send_json(&mut write, &key, &value).await?;
            }
        }
    }

    Ok(())
}
