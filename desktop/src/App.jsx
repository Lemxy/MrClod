import { useEffect, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import SpotlightBackground from './SpotlightBackground.jsx';
import { deriveKey, encryptFrame, decryptFrame } from './crypto.js';
import { useLang } from './i18n.jsx';

const { invoke } = window.__TAURI__.core;

const spring = { type: 'spring', stiffness: 400, damping: 32 };

function ThinkingIndicator() {
  const [step, setStep] = useState(0);
  const { t } = useLang();
  useEffect(() => {
    const id = setInterval(() => setStep((s) => (s + 1) % 3), 500);
    return () => clearInterval(id);
  }, []);
  return (
    <div className="msg-row thinking-row">
      <div className="msg-avatar msg-avatar-assistant">
        <span className="material-symbols-outlined">memory</span>
      </div>
      <div className="msg-body">
        <div className="thinking-label">
          <span className="material-symbols-outlined spin">data_usage</span>
          {t('thinking')}{'.'.repeat(step + 1)}
        </div>
      </div>
    </div>
  );
}

// Rendered inline in the chat, not as a modal or OS notification — it's the
// same "-p" invocation that's blocked on hooks_http.rs's /permission_request
// waiting for this exact answer, so a notification with nothing to tap left
// it stuck for a full 120s timeout (then Claude Code retried, which is why
// it looked like an infinite loop of notifications with no way to respond).
function PermissionBubble({ request, onRespond }) {
  const { t } = useLang();
  return (
    <motion.div
      className="msg-row"
      layout
      initial={{ opacity: 0, y: 10, scale: 0.98 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      transition={spring}
    >
      <div className="msg-avatar msg-avatar-assistant">
        <span className="material-symbols-outlined">smart_toy</span>
      </div>
      <div className="msg-body">
        <div className="permission-card">
          <div className="permission-head">
            <div className="permission-head-left">
              <div className="permission-icon">
                <span className="material-symbols-outlined">terminal</span>
              </div>
              <h3 className="permission-title">{t('permissionRequest')}</h3>
            </div>
            <span className="permission-badge">{request.tool_name}</span>
          </div>
          {request.input && (
            <pre className="permission-input">{JSON.stringify(request.input, null, 2)}</pre>
          )}
          <div className="permission-actions">
            <button className="btn-allow" onClick={() => onRespond(true)}>
              <span className="material-symbols-outlined">check_circle</span>
              {t('allow')}
            </button>
            <button className="btn-deny" onClick={() => onRespond(false)}>
              <span className="material-symbols-outlined">cancel</span>
              {t('deny')}
            </button>
          </div>
        </div>
      </div>
    </motion.div>
  );
}

function Message({ role, content, imageBase64 }) {
  const isUser = role === 'user';
  return (
    <motion.div
      className="msg-row"
      layout
      initial={{ opacity: 0, y: 10, scale: 0.98 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      transition={spring}
    >
      <div className={`msg-avatar ${isUser ? 'msg-avatar-user' : 'msg-avatar-assistant'}`}>
        <span className="material-symbols-outlined">{isUser ? 'person' : 'smart_toy'}</span>
      </div>
      <div className="msg-body">
        {imageBase64 && (
          <img className="bubble-image" src={`data:image/png;base64,${imageBase64}`} alt="screenshot" />
        )}
        <p className="msg-text">{content}</p>
      </div>
    </motion.div>
  );
}

const MODELS = [
  { label: 'Sonnet 5', value: 'sonnet' },
  { label: 'Opus 4.8', value: 'opus' },
  { label: 'Haiku 4.5', value: 'haiku' },
  { label: 'Fable 5', value: 'fable' },
];

function modelInfo(t) {
  return { sonnet: t('modelSonnet'), opus: t('modelOpus'), haiku: t('modelHaiku'), fable: t('modelFable') };
}

const EFFORTS = [
  { label: 'Low', value: 'low' },
  { label: 'Medium', value: 'medium' },
  { label: 'High', value: 'high' },
  { label: 'XHigh', value: 'xhigh' },
  { label: 'Max', value: 'max' },
];

function effortInfo(t) {
  return {
    low: t('effortLow'),
    medium: t('effortMedium'),
    high: t('effortHigh'),
    xhigh: t('effortXhigh'),
    max: t('effortMax'),
  };
}

function permissionModes(t) {
  return [
    { label: t('permAsk'), value: 'ask' },
    { label: t('permSkip'), value: 'skip' },
  ];
}

function permissionModeInfo(t) {
  return { ask: t('permAskInfo'), skip: t('permSkipInfo') };
}

function Dropdown({ value, options, info, onChange }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);

  useEffect(() => {
    function onDocClick(e) {
      if (ref.current && !ref.current.contains(e.target)) setOpen(false);
    }
    document.addEventListener('mousedown', onDocClick);
    return () => document.removeEventListener('mousedown', onDocClick);
  }, []);

  const current = options.find((o) => o.value === value);

  return (
    <div className="dropdown" ref={ref}>
      <motion.button
        type="button"
        className="dropdown-trigger"
        onClick={() => setOpen((v) => !v)}
        whileTap={{ scale: 0.96 }}
        transition={{ duration: 0.1 }}
      >
        <span>{current?.label ?? value}</span>
        <motion.span
          className="dropdown-caret"
          animate={{ rotate: open ? 180 : 0 }}
          transition={{ duration: 0.18, ease: 'easeOut' }}
        >
          ▾
        </motion.span>
      </motion.button>
      <AnimatePresence>
        {open && (
          <motion.div
            className="dropdown-menu"
            initial={{ opacity: 0, y: -6, scale: 0.97 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -6, scale: 0.97 }}
            transition={{ duration: 0.15, ease: 'easeOut' }}
          >
            {options.map((opt) => (
              <button
                key={opt.value}
                type="button"
                className={`dropdown-item ${opt.value === value ? 'dropdown-item-active' : ''}`}
                onClick={() => {
                  onChange(opt.value);
                  setOpen(false);
                }}
              >
                <div className="dropdown-item-text">
                  <span className="dropdown-item-label">{opt.label}</span>
                  {info?.[opt.value] && <span className="dropdown-item-desc">{info[opt.value]}</span>}
                </div>
                {opt.value === value && <span className="dropdown-item-check">✓</span>}
              </button>
            ))}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

function SessionSidebar({ sessions, activeId, onSwitch, onCreate, onDelete, open }) {
  const [creating, setCreating] = useState(false);
  const [title, setTitle] = useState('');
  const { t } = useLang();

  function submitCreate() {
    const t = title.trim();
    if (!t) return;
    onCreate(t);
    setTitle('');
    setCreating(false);
  }

  return (
    <motion.aside
      className="sidebar"
      initial={false}
      animate={{ width: open ? 260 : 0, opacity: open ? 1 : 0 }}
      transition={{ duration: 0.2, ease: 'easeOut' }}
    >
      <div className="sidebar-inner">
        <div className="sidebar-brand">
          <span className="sidebar-brand-mark">{'>_'}</span>
          <div>
            <h1 className="sidebar-brand-name">MrClod</h1>
            <p className="sidebar-brand-sub">Claude Code Desktop</p>
          </div>
        </div>
        {!creating ? (
          <button className="new-chat-btn" onClick={() => setCreating(true)}>
            <span className="material-symbols-outlined">add</span>
            {t('newChat')}
          </button>
        ) : (
          <div className="new-chat-row">
            <input
              autoFocus
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && submitCreate()}
              placeholder={t('chatName')}
            />
            <button onClick={submitCreate}>OK</button>
          </div>
        )}
        <div className="sidebar-section-label">{t('recent')}</div>
        <div className="session-list">
          {sessions.map((s) => (
            <div
              key={s.id}
              className={`session-item ${s.id === activeId ? 'session-item-active' : ''}`}
              onClick={() => onSwitch(s.id)}
            >
              <span className="material-symbols-outlined session-item-icon">chat_bubble</span>
              <div className="session-item-text">
                <div className="session-item-title">{s.title}</div>
                <div className="session-item-meta">
                  {MODELS.find((m) => m.value === s.model)?.label || 'Sonnet 5'}
                  {' · '}
                  {EFFORTS.find((ef) => ef.value === s.effort)?.label || 'Medium'}
                </div>
              </div>
              <button
                className="session-delete"
                onClick={(e) => {
                  e.stopPropagation();
                  onDelete(s.id);
                }}
                aria-label={t('deleteChat', s.title)}
              >
                ×
              </button>
            </div>
          ))}
        </div>
      </div>
    </motion.aside>
  );
}

export default function App() {
  const { t, lang, setLang } = useLang();
  const [connected, setConnected] = useState(false);
  const [sessions, setSessions] = useState([]);
  const [activeSessionId, setActiveSessionId] = useState(null);
  const [messages, setMessages] = useState([]);
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [pairing, setPairing] = useState(null);
  const [qr, setQr] = useState(null);
  const [pairingOpen, setPairingOpen] = useState(false);
  const [tokenDraft, setTokenDraft] = useState('');
  const [tokenSaved, setTokenSaved] = useState(false);
  const [skipRequest, setSkipRequest] = useState(null); // {approval_id, session_id}
  const [permissionRequest, setPermissionRequest] = useState(null); // {approval_id, session_id, tool_name, input}

  const wsRef = useRef(null);
  const keyRef = useRef(null);
  const activeSessionIdRef = useRef(null);
  const scrollRef = useRef(null);

  useEffect(() => {
    activeSessionIdRef.current = activeSessionId;
  }, [activeSessionId]);

  // A phone with the pairing token can ask to enable "skip permissions"
  // (unattended Bash/Write/Edit RCE) — that only takes effect if answered
  // here, on the machine itself.
  useEffect(() => {
    const unlistenPromise = window.__TAURI__.event.listen('skip_permission_request', (e) => {
      setSkipRequest(e.payload);
    });
    return () => {
      unlistenPromise.then((unlisten) => unlisten());
    };
  }, []);

  function respondSkipRequest(approve) {
    if (!skipRequest) return;
    invoke('respond_skip_permission', { approvalId: skipRequest.approval_id, approve });
    setSkipRequest(null);
  }

  const [showInternetNotice, setShowInternetNotice] = useState(false);
  useEffect(() => {
    invoke('should_show_internet_notice').then(setShowInternetNotice);
  }, []);

  useEffect(() => {
    // ponytail: StrictMode double-invokes this effect in dev. Without this
    // guard, cleanup fires before the awaited invoke() calls resolve (so it
    // has no socket to close yet), and the first invocation's WebSocket gets
    // created anyway — leaving two live connections, each with its own
    // onmessage handler, each appending to the same React state (visible as
    // duplicated sessions/messages).
    let cancelled = false;

    (async () => {
      const info = await invoke('get_pairing_info');
      if (cancelled) return;
      setPairing(info);
      setTokenDraft(info.token);
      const qrData = await invoke('get_pairing_qr');
      if (cancelled) return;
      setQr(qrData);

      const ws = new WebSocket(`ws://127.0.0.1:${info.port}`);
      ws.binaryType = 'arraybuffer';
      if (cancelled) {
        ws.close();
        return;
      }
      wsRef.current = ws;
      const key = await deriveKey(info.token);
      keyRef.current = key;
      const send = async (obj) => ws.send(await encryptFrame(key, obj));

      ws.onopen = () => send({ type: 'auth', token: info.token });

      ws.onmessage = async (e) => {
        const msg = await decryptFrame(key, e.data);
        if (!msg) return;
        if (msg.type === 'ack') {
          setConnected(true);
        } else if (msg.type === 'sessions') {
          setSessions(msg.items);
          if (!activeSessionIdRef.current && msg.items.length) {
            const first = msg.items[0].id;
            activeSessionIdRef.current = first;
            setActiveSessionId(first);
            send({ type: 'switch_session', session_id: first });
          }
        } else if (msg.type === 'session_created') {
          setSessions((prev) => (prev.some((s) => s.id === msg.session.id) ? prev : [...prev, msg.session]));
        } else if (msg.type === 'session_deleted') {
          setSessions(msg.sessions);
          if (msg.session_id === activeSessionIdRef.current) {
            const fallback = msg.sessions[0]?.id;
            activeSessionIdRef.current = fallback;
            setActiveSessionId(fallback);
            setMessages([]);
            if (fallback) send({ type: 'switch_session', session_id: fallback });
          }
        } else if (msg.type === 'history') {
          if (msg.session_id === activeSessionIdRef.current) setMessages(msg.items);
        } else if (msg.type === 'cc_finished') {
          if (msg.session_id !== activeSessionIdRef.current) return;
          setBusy(false);
          setMessages((prev) => [...prev, { id: `srv-${Date.now()}`, role: 'assistant', content: msg.content, image_base64: msg.image_base64 }]);
        } else if (msg.type === 'status_update') {
          if (msg.session_id && msg.session_id !== activeSessionIdRef.current) return;
          setBusy(msg.status === 'busy');
        } else if (msg.type === 'error') {
          if (msg.session_id !== activeSessionIdRef.current) return;
          setBusy(false);
          setError(msg.message);
        } else if (msg.type === 'permission_request') {
          setPermissionRequest(msg);
        } else if (msg.type === 'permission_resolved') {
          setPermissionRequest((prev) => (prev?.approval_id === msg.approval_id ? null : prev));
        }
      };

      ws.onclose = () => setConnected(false);
      ws.onerror = () => setConnected(false);
    })();

    return () => {
      cancelled = true;
      wsRef.current?.close();
      wsRef.current = null;
    };
  }, []);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' });
  }, [messages, busy, permissionRequest]);

  async function wsSend(obj) {
    if (!wsRef.current || !keyRef.current) return;
    wsRef.current.send(await encryptFrame(keyRef.current, obj));
  }

  function send() {
    const text = draft.trim();
    if (!text || busy || !activeSessionId || !wsRef.current) return;
    setDraft('');
    setError(null);
    setMessages((prev) => [...prev, { id: `local-${Date.now()}`, role: 'user', content: text }]);
    wsSend({ type: 'new_request', session_id: activeSessionId, message: text });
  }

  function onKeyDown(e) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      send();
    }
  }

  function switchSession(id) {
    if (!wsRef.current || id === activeSessionId) return;
    activeSessionIdRef.current = id;
    setActiveSessionId(id);
    setMessages([]);
    setBusy(false);
    wsSend({ type: 'switch_session', session_id: id });
  }

  function createSession(title) {
    wsSend({ type: 'create_session', title });
  }

  function deleteSession(id) {
    wsSend({ type: 'delete_session', session_id: id });
  }

  function setModel(model) {
    if (!activeSessionId) return;
    wsSend({ type: 'set_model', session_id: activeSessionId, model });
  }

  function setEffort(effort) {
    if (!activeSessionId) return;
    wsSend({ type: 'set_effort', session_id: activeSessionId, effort });
  }

  function setPermissionMode(permission_mode) {
    if (!activeSessionId) return;
    wsSend({ type: 'set_permission_mode', session_id: activeSessionId, permission_mode });
  }

  function respondPermission(approve) {
    if (!permissionRequest) return;
    wsSend({ type: 'respond_permission', approval_id: permissionRequest.approval_id, approve });
    setPermissionRequest(null);
  }

  async function saveToken() {
    const t = tokenDraft.trim();
    if (!t || t === pairing?.token) return;
    await invoke('set_pairing_token_cmd', { token: t });
    const info = await invoke('get_pairing_info');
    setPairing(info);
    setTokenDraft(info.token);
    setQr(await invoke('get_pairing_qr'));
    setTokenSaved(true);
    setTimeout(() => setTokenSaved(false), 1500);
  }

  async function regenerateToken() {
    await invoke('regenerate_pairing_token');
    const info = await invoke('get_pairing_info');
    setPairing(info);
    setTokenDraft(info.token);
    setQr(await invoke('get_pairing_qr'));
    setTokenSaved(true);
    setTimeout(() => setTokenSaved(false), 1500);
  }

  // Base mode: the tunnel is started automatically on launch (see lib.rs
  // run()), so as soon as the pairing panel is open we just poll until
  // Cloudflare hands back a hostname — no button to click.
  useEffect(() => {
    if (!pairingOpen || pairing?.tunnel_url) return;
    const id = setInterval(async () => {
      const info = await invoke('get_pairing_info');
      setPairing(info);
      if (info.tunnel_url) setQr(await invoke('get_pairing_qr'));
    }, 2000);
    return () => clearInterval(id);
  }, [pairingOpen, pairing?.tunnel_url]);

  const activeSession = sessions.find((s) => s.id === activeSessionId);

  return (
    <SpotlightBackground>
    {showInternetNotice && (
      <div className="skip-modal-overlay">
        <div className="skip-modal">
          <h3>{t('internetNoticeTitle')}</h3>
          <p>{t('internetNoticeBody')}</p>
          <div className="skip-modal-actions">
            <button className="btn-danger" onClick={() => setShowInternetNotice(false)}>{t('gotIt')}</button>
          </div>
        </div>
      </div>
    )}
    {skipRequest && (
      <div className="skip-modal-overlay">
        <div className="skip-modal">
          <h3>{t('skipTitle')}</h3>
          <p>{t('skipBody')}</p>
          <div className="skip-modal-actions">
            <button className="btn-secondary" onClick={() => respondSkipRequest(false)}>{t('decline')}</button>
            <button className="btn-danger" onClick={() => respondSkipRequest(true)}>{t('allow')}</button>
          </div>
        </div>
      </div>
    )}
    <div className="app">
      <SessionSidebar
        sessions={sessions}
        activeId={activeSessionId}
        onSwitch={switchSession}
        onCreate={createSession}
        onDelete={deleteSession}
        open={sidebarOpen}
      />

      <div className="main">
        <header className="topbar">
          <div className="topbar-row">
            <button className="icon-btn" onClick={() => setSidebarOpen((v) => !v)} aria-label={t('chats')}>
              <span className="material-symbols-outlined">menu</span>
            </button>
            <div className="status-badge">
              <span className={`status-dot ${connected ? 'status-on' : ''}`} />
              <span className="status-badge-label">
                {MODELS.find((m) => m.value === activeSession?.model)?.label || 'Sonnet 5'}
              </span>
            </div>
            <div className="session-title" title={activeSession?.title}>
              {activeSession?.title || '...'}
            </div>
            <Dropdown
              value={activeSession?.model || 'sonnet'}
              options={MODELS}
              info={modelInfo(t)}
              onChange={setModel}
            />
            <Dropdown
              value={activeSession?.effort || 'medium'}
              options={EFFORTS}
              info={effortInfo(t)}
              onChange={setEffort}
            />
            <Dropdown
              value={activeSession?.permission_mode || 'ask'}
              options={permissionModes(t)}
              info={permissionModeInfo(t)}
              onChange={setPermissionMode}
            />
            <button
              className="pairing-toggle"
              onClick={() => setLang(lang === 'en' ? 'ru' : 'en')}
              title={t('language')}
            >
              {lang === 'en' ? 'RU' : 'EN'}
            </button>
            <button className="pairing-toggle" onClick={() => setPairingOpen((v) => !v)}>
              {t('pairing')}
            </button>
          </div>
          <AnimatePresence initial={false}>
            {pairingOpen && pairing && (
              <motion.div
                className="pairing-body"
                initial={{ height: 0, opacity: 0 }}
                animate={{ height: 'auto', opacity: 1 }}
                exit={{ height: 0, opacity: 0 }}
                transition={{ duration: 0.22, ease: 'easeOut' }}
              >
                {qr && <img className="pairing-qr" src={qr} alt={t('pairingQrAlt')} />}
                <div className="pairing-meta">
                  <div>
                    ws://{pairing.ip}:{pairing.port}
                  </div>
                  <div className="token-row">
                    <input
                      className="token-input"
                      value={tokenDraft}
                      onChange={(e) => setTokenDraft(e.target.value)}
                      onKeyDown={(e) => e.key === 'Enter' && saveToken()}
                      onBlur={saveToken}
                      spellCheck={false}
                      aria-label={t('pairingToken')}
                    />
                    <button type="button" className="token-btn" onClick={regenerateToken} title={t('regenerateToken')}>
                      ⟳
                    </button>
                  </div>
                  <div className="token-hint">
                    {tokenSaved ? t('saved') : t('tokenHint')}
                  </div>
                  <div className="tunnel-row">
                    <div className={`tunnel-status ${pairing.tunnel_url ? 'tunnel-status-on' : ''}`}>
                      {pairing.tunnel_url ? t('availableOnline') : t('connectingTunnel')}
                    </div>
                  </div>
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </header>

        <main className="chat" ref={scrollRef}>
          {messages.length === 0 && !busy && <div className="empty-state">{t('emptyState')}</div>}
          <AnimatePresence initial={false}>
            {messages.map((m) => (
              <Message key={m.id} role={m.role} content={m.content} imageBase64={m.image_base64} />
            ))}
          </AnimatePresence>
          {permissionRequest ? (
            <PermissionBubble request={permissionRequest} onRespond={respondPermission} />
          ) : (
            busy && <ThinkingIndicator />
          )}
        </main>

        {error && (
          <motion.div className="error-banner" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}>
            {error}
          </motion.div>
        )}

        <form
          className="composer"
          onSubmit={(e) => {
            e.preventDefault();
            send();
          }}
        >
          <textarea
            rows={2}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={onKeyDown}
            placeholder={t('composerPlaceholder')}
            aria-label={t('composerAria')}
          />
          <motion.button
            type="submit"
            className="send-button"
            disabled={busy || !draft.trim()}
            whileTap={{ scale: 0.94 }}
            transition={{ duration: 0.1 }}
          >
            <span className="material-symbols-outlined">arrow_upward</span>
          </motion.button>
        </form>
      </div>
    </div>
    </SpotlightBackground>
  );
}
