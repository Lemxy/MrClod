#!/usr/bin/env node
// MCP stdio server exposing one tool: approval_prompt.
// Claude Code calls this (via --permission-prompt-tool) for every tool use
// that needs a permission decision while running headless (`claude -p`),
// which otherwise has no channel to ask a question through. This forwards
// the request to the MrClod desktop app over loopback HTTP; the desktop app
// relays it to whichever client (phone or desktop) is connected over its
// existing WebSocket and blocks until someone taps allow/deny.

const http = require('http');

const HOOK_PORT = process.env.MRCLOD_HOOK_PORT || '7879';
const SESSION_ID = process.env.MRCLOD_SESSION_ID || '';

function askDesktop(toolName, input) {
  return new Promise((resolve) => {
    const body = JSON.stringify({ session_id: SESSION_ID, tool_name: toolName, input });
    const req = http.request(
      {
        host: '127.0.0.1',
        port: Number(HOOK_PORT),
        path: '/permission_request',
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) },
        timeout: 130000,
      },
      (res) => {
        let data = '';
        res.on('data', (c) => (data += c));
        res.on('end', () => {
          try {
            resolve(JSON.parse(data));
          } catch {
            resolve({ decision: 'deny', message: 'malformed response from MrClod desktop' });
          }
        });
      }
    );
    req.on('error', () => resolve({ decision: 'deny', message: 'MrClod desktop unreachable' }));
    req.on('timeout', () => {
      req.destroy();
      resolve({ decision: 'deny', message: 'timed out waiting for a decision' });
    });
    req.write(body);
    req.end();
  });
}

function send(msg) {
  process.stdout.write(JSON.stringify(msg) + '\n');
}

const TOOL = {
  name: 'approval_prompt',
  description: 'Ask the MrClod user (phone or desktop) to allow or deny a tool call.',
  inputSchema: {
    type: 'object',
    properties: {
      tool_name: { type: 'string' },
      input: { type: 'object' },
    },
    required: ['tool_name', 'input'],
  },
};

let buf = '';
process.stdin.on('data', (chunk) => {
  buf += chunk;
  let idx;
  while ((idx = buf.indexOf('\n')) >= 0) {
    const line = buf.slice(0, idx).trim();
    buf = buf.slice(idx + 1);
    if (line) handle(JSON.parse(line));
  }
});

async function handle(msg) {
  if (msg.method === 'initialize') {
    send({
      jsonrpc: '2.0',
      id: msg.id,
      result: {
        protocolVersion: '2024-11-05',
        capabilities: { tools: {} },
        serverInfo: { name: 'mrclod-permission', version: '1.0.0' },
      },
    });
    return;
  }
  if (msg.method === 'notifications/initialized') return;
  if (msg.method === 'tools/list') {
    send({ jsonrpc: '2.0', id: msg.id, result: { tools: [TOOL] } });
    return;
  }
  if (msg.method === 'tools/call') {
    const args = (msg.params && msg.params.arguments) || {};
    const decision = await askDesktop(args.tool_name || '', args.input || {});
    const payload =
      decision.decision === 'allow'
        ? { behavior: 'allow', updatedInput: args.input || {} }
        : { behavior: 'deny', message: decision.message || 'denied by user' };
    send({
      jsonrpc: '2.0',
      id: msg.id,
      result: { content: [{ type: 'text', text: JSON.stringify(payload) }] },
    });
    return;
  }
  if (msg.id !== undefined) {
    send({ jsonrpc: '2.0', id: msg.id, error: { code: -32601, message: 'method not found' } });
  }
}

process.stdin.resume();
