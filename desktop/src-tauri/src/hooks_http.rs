use crate::AppState;
use serde_json::json;
use tauri_plugin_notification::NotificationExt;

pub const HOOK_PORT: u16 = 7879;

// ponytail: plain tiny_http loop, one request at a time, no auth on this
// endpoint (loopback-only — Claude Code hooks run as a local child process
// of this same machine). Add a shared secret if this ever listens beyond
// 127.0.0.1.
pub fn spawn_server(state: AppState) {
    std::thread::spawn(move || {
        let server = match tiny_http::Server::http(("127.0.0.1", HOOK_PORT)) {
            Ok(s) => s,
            Err(e) => {
                eprintln!("hooks HTTP: failed to bind port {HOOK_PORT}: {e}");
                return;
            }
        };
        println!("Hooks HTTP endpoint listening on port {HOOK_PORT}");

        for mut request in server.incoming_requests() {
            let mut body = String::new();
            let _ = request.as_reader().read_to_string(&mut body);
            let event: serde_json::Value = serde_json::from_str(&body).unwrap_or(json!({}));

            if request.url() == "/permission_request" {
                handle_permission_request(&state, &event, request);
                continue;
            }

            let event_name = event
                .get("event")
                .and_then(|v| v.as_str())
                .unwrap_or("unknown")
                .to_string();

            let (status, title, body_text) = match event_name.as_str() {
                "Stop" => (
                    "cc_finished",
                    "Claude Code",
                    "Задача завершена, ждёт новый запрос",
                ),
                "Notification" => (
                    "waiting_input",
                    "Claude Code",
                    "Ждёт вашего ответа",
                ),
                _ => ("unknown", "Claude Code", "Событие получено"),
            };

            let _ = state.broadcast.send(
                json!({"type": "status_update", "status": status}).to_string(),
            );

            let _ = state
                .app_handle
                .notification()
                .builder()
                .title(title)
                .body(body_text)
                .show();

            let _ = request.respond(tiny_http::Response::from_string("ok"));
        }
    });
}

/// Called by the `approval_prompt` MCP tool (permission-prompt-mcp.js) that
/// `run_claude_cli` wires up for every headless invocation not in "skip"
/// mode. Blocks this request thread — not the tokio runtime — until the
/// phone or desktop answers over WS (see ws.rs's "respond_permission"
/// handler) or 120s pass, which counts as deny.
fn handle_permission_request(state: &AppState, body: &serde_json::Value, request: tiny_http::Request) {
    let session_id = body.get("session_id").and_then(|v| v.as_str()).unwrap_or("").to_string();
    let tool_name = body.get("tool_name").and_then(|v| v.as_str()).unwrap_or("").to_string();
    let input = body.get("input").cloned().unwrap_or(json!({}));

    let approval_id = uuid::Uuid::new_v4().to_string();
    let (tx, rx) = std::sync::mpsc::channel::<bool>();
    state
        .pending_permission_approvals
        .lock()
        .unwrap()
        .insert(approval_id.clone(), tx);

    let _ = state.broadcast.send(
        json!({
            "type": "permission_request",
            "approval_id": approval_id,
            "session_id": session_id,
            "tool_name": tool_name,
            "input": input,
        })
        .to_string(),
    );

    let _ = state
        .app_handle
        .notification()
        .builder()
        .title("Claude Code")
        .body(format!("Просит разрешение: {tool_name}"))
        .show();

    let approved = rx
        .recv_timeout(std::time::Duration::from_secs(120))
        .unwrap_or(false);
    state.pending_permission_approvals.lock().unwrap().remove(&approval_id);

    let resp = if approved {
        json!({"decision": "allow"})
    } else {
        json!({"decision": "deny", "message": "denied or timed out"})
    };
    let _ = request.respond(
        tiny_http::Response::from_string(resp.to_string()).with_header(
            tiny_http::Header::from_bytes(&b"Content-Type"[..], &b"application/json"[..]).unwrap(),
        ),
    );
}
