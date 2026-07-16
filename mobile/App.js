import { useEffect, useRef, useState } from 'react';
import {
  FlatList,
  Image,
  KeyboardAvoidingView,
  Modal,
  Pressable,
  SafeAreaView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as SecureStore from 'expo-secure-store';
import * as Notifications from 'expo-notifications';
import * as Haptics from 'expo-haptics';
import { StatusBar } from 'expo-status-bar';
import { LinearGradient } from 'expo-linear-gradient';
import { BlurView } from 'expo-blur';
import { Ionicons } from '@expo/vector-icons';
import { MotiView } from 'moti';
import { MotiPressable } from 'moti/interactions';
import { Easing } from 'react-native-reanimated';
import { CameraView, useCameraPermissions } from 'expo-camera';
import { deriveKey, encryptFrame, decryptFrame } from './crypto';
import { LanguageProvider, useLang } from './i18n';

try {
  Notifications.setNotificationHandler({
    handleNotification: async () => ({
      shouldShowAlert: true,
      shouldPlaySound: false,
      shouldSetBadge: false,
      shouldShowBanner: true,
      shouldShowList: true,
    }),
  });
} catch (e) {
  console.warn('notifications unavailable:', e);
}

const STORAGE_KEY = 'ccr_pairing';
const QUEUE_KEY = 'ccr_queue';
const TASK_CLEAR_KEY = 'ccr_task_clear';
const SPRING = { type: 'spring', damping: 20, stiffness: 90 };

// The pairing token grants Bash/Write/Edit on the paired desktop, so it lives in
// the Keystore/Keychain rather than AsyncStorage (which is plain-text on disk and
// readable on a rooted device or via `adb backup`).
async function loadPairing() {
  const secure = await SecureStore.getItemAsync(STORAGE_KEY).catch(() => null);
  if (secure) return JSON.parse(secure);
  // migrate a pre-SecureStore pairing, then wipe the plain-text copy
  const legacy = await AsyncStorage.getItem(STORAGE_KEY);
  if (!legacy) return null;
  await SecureStore.setItemAsync(STORAGE_KEY, legacy).catch(() => {});
  await AsyncStorage.removeItem(STORAGE_KEY);
  return JSON.parse(legacy);
}

function notify(title, body) {
  // ponytail: expo-notifications local scheduling isn't guaranteed inside
  // Expo Go on every SDK; swallow failures so a notification glitch never
  // takes down the chat screen.
  try {
    Notifications.scheduleNotificationAsync({ content: { title, body }, trigger: null });
  } catch (e) {
    console.warn('notify failed:', e);
  }
}

function truncateWords(text, max) {
  if (!text) return '';
  const words = text.trim().split(/\s+/);
  if (words.length <= max) return text.trim();
  return words.slice(0, max).join(' ') + '…';
}

function haptic(style) {
  // ponytail: haptics can no-op/throw on emulators or some devices, never
  // let that crash a button press.
  try {
    Haptics.impactAsync(style ?? Haptics.ImpactFeedbackStyle.Light);
  } catch (e) {
    // ignore
  }
}

function AmbientGlow() {
  return (
    <View pointerEvents="none" style={styles.glowWrap}>
      <MotiView
        style={[styles.glowBlob, styles.glowCoral]}
        from={{ opacity: 0.18, scale: 1 }}
        animate={{ opacity: 0.28, scale: 1.08 }}
        transition={{ type: 'timing', duration: 6000, loop: true, repeatReverse: true, easing: Easing.inOut(Easing.ease) }}
      >
        <LinearGradient
          colors={['rgba(232,130,90,0.55)', 'rgba(232,130,90,0)']}
          style={styles.glowGradient}
        />
      </MotiView>
      <MotiView
        style={[styles.glowBlob, styles.glowTeal]}
        from={{ opacity: 0.12, scale: 1 }}
        animate={{ opacity: 0.2, scale: 1.1 }}
        transition={{ type: 'timing', duration: 7000, loop: true, repeatReverse: true, easing: Easing.inOut(Easing.ease) }}
      >
        <LinearGradient
          colors={['rgba(84,218,206,0.45)', 'rgba(84,218,206,0)']}
          style={styles.glowGradient}
        />
      </MotiView>
    </View>
  );
}

function TypingIndicator() {
  const { t } = useLang();
  return (
    <MotiView
      style={styles.progressCard}
      from={{ opacity: 0, translateY: 8 }}
      animate={{ opacity: 1, translateY: 0 }}
      transition={{ type: 'timing', duration: 220, easing: Easing.out(Easing.cubic) }}
    >
      <View style={styles.progressCardHeader}>
        <Ionicons name="hardware-chip-outline" size={16} color={TEAL} />
        <Text style={styles.progressCardLabel}>{t('thinking')}</Text>
      </View>
      <View style={styles.progressTrack}>
        <MotiView
          style={styles.progressFill}
          from={{ translateX: -140 }}
          animate={{ translateX: 140 }}
          transition={{ type: 'timing', duration: 1100, loop: true, easing: Easing.inOut(Easing.ease) }}
        />
      </View>
    </MotiView>
  );
}

// Rendered as the chat's ListFooterComponent, not appended to `messages` —
// it's not chat history, just a live prompt that vanishes the instant the
// user taps either button (respondPermission clears the state that feeds it).
function PermissionRequestBubble({ request, onRespond }) {
  const { t } = useLang();
  return (
    <MotiView
      style={styles.progressCard}
      from={{ opacity: 0, translateY: 8 }}
      animate={{ opacity: 1, translateY: 0 }}
      transition={{ type: 'timing', duration: 220, easing: Easing.out(Easing.cubic) }}
    >
      <View style={styles.progressCardHeader}>
        <Ionicons name="shield-checkmark-outline" size={16} color={CORAL} />
        <Text style={styles.progressCardLabel}>{t('allowTool', request.tool_name)}</Text>
      </View>
      {!!request.input && (
        <Text style={styles.permissionBubbleInput} numberOfLines={4}>
          {JSON.stringify(request.input)}
        </Text>
      )}
      <View style={{ flexDirection: 'row', gap: 8, marginTop: 10 }}>
        <PressableScale style={styles.permissionAllowBtn} onPress={() => onRespond(true)}>
          <Text style={styles.allowButtonText}>{t('allow')}</Text>
        </PressableScale>
        <PressableScale style={styles.permissionDenyBtn} onPress={() => onRespond(false)}>
          <Text style={styles.destructiveButtonText}>{t('deny')}</Text>
        </PressableScale>
      </View>
    </MotiView>
  );
}

function EmptyChatState() {
  const { t } = useLang();
  return (
    <View style={styles.emptyWrap}>
      <Ionicons name="chatbubble-ellipses-outline" size={40} color={ON_SURFACE_VARIANT} />
      <Text style={styles.emptyText}>{t('emptyChat')}</Text>
    </View>
  );
}

function MessageBubble({ item }) {
  const isUser = item.role === 'user';
  return (
    <MotiView
      style={isUser ? styles.msgWrapUser : styles.msgWrapAssistant}
      from={{ opacity: 0, translateY: 10, scale: 0.97 }}
      animate={{ opacity: 1, translateY: 0, scale: 1 }}
      transition={{ type: 'spring', damping: 18, stiffness: 180 }}
    >
      {isUser ? (
        <LinearGradient
          colors={[CORAL, '#D9714B']}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 1 }}
          style={[styles.msg, styles.msgUser]}
        >
          <Text style={styles.msgTextUser}>{item.content}</Text>
        </LinearGradient>
      ) : (
        <>
          <View style={styles.agentLabelRow}>
            <View style={styles.agentAvatar}>
              <Ionicons name="hardware-chip-outline" size={12} color={CORAL} />
            </View>
            <Text style={styles.agentLabelText}>MrClod Agent</Text>
          </View>
          <View style={[styles.msg, styles.msgAssistant]}>
            {!!item.image_base64 && (
              <Image
                source={{ uri: `data:image/png;base64,${item.image_base64}` }}
                style={styles.msgImage}
                resizeMode="contain"
              />
            )}
            {!!item.content && <Text style={styles.msgTextAssistant}>{item.content}</Text>}
          </View>
        </>
      )}
    </MotiView>
  );
}

function PressableScale({ style, onPress, children, hitSlop }) {
  return (
    <MotiPressable
      onPress={onPress}
      hitSlop={hitSlop}
      animate={({ pressed }) => {
        'worklet';
        return { scale: pressed ? 0.96 : 1 };
      }}
      transition={{ type: 'spring', damping: 15, stiffness: 300 }}
      style={style}
    >
      {children}
    </MotiPressable>
  );
}

// icon button with a guaranteed >=44x44 hit target regardless of the visual icon size
function IconButton({ name, color, size = 21, onPress, style }) {
  return (
    <PressableScale style={[styles.iconButton, style]} onPress={onPress} hitSlop={8}>
      <Ionicons name={name} size={size} color={color} />
    </PressableScale>
  );
}

function modelInfo(t) {
  return { sonnet: t('modelSonnet'), opus: t('modelOpus'), haiku: t('modelHaiku'), fable: t('modelFable') };
}

function effortInfo(t) {
  return {
    low: t('effortLow'),
    medium: t('effortMedium'),
    high: t('effortHigh'),
    xhigh: t('effortXhigh'),
    max: t('effortMax'),
  };
}

// Both modes execute tools without ever prompting: the desktop runs `claude -p`
// (headless), which has no channel to ask a question through, so "ask" is not the
// safe default it used to claim to be — verified by running a Bash tool call
// through it with no permission flags and watching it execute.
function permissionModeInfo(t) {
  return { ask: t('permAskInfo'), skip: t('permSkipInfo') };
}

function IntroScreen({ onDone }) {
  const { t } = useLang();
  const [exiting, setExiting] = useState(false);

  useEffect(() => {
    const t = setTimeout(() => setExiting(true), 1600);
    return () => clearTimeout(t);
  }, []);

  return (
    <MotiView
      style={styles.introRoot}
      from={{ opacity: 1 }}
      animate={{ opacity: exiting ? 0 : 1 }}
      transition={{ type: 'timing', duration: 320, easing: Easing.in(Easing.cubic) }}
      onDidAnimate={(key, finished) => {
        if (key === 'opacity' && finished && exiting) onDone();
      }}
    >
      <AmbientGlow />
      <SafeAreaView style={styles.introInner}>
        <MotiView
          style={styles.introLogoRing}
          from={{ opacity: 0, scale: 0.7, translateY: -30 }}
          animate={{
            opacity: exiting ? 0 : 1,
            scale: exiting ? 0.85 : 1,
            translateY: exiting ? -20 : 0,
          }}
          transition={{ type: 'spring', damping: 14, stiffness: 120 }}
        >
          <MotiView
            style={styles.introGlowPulse}
            from={{ opacity: 0.25, scale: 1 }}
            animate={{ opacity: 0.45, scale: 1.15 }}
            transition={{ type: 'timing', duration: 1800, loop: true, repeatReverse: true, easing: Easing.inOut(Easing.ease) }}
          />
          <Image source={require('./assets/mrclod_logo.png')} style={styles.introLogo} />
        </MotiView>

        <MotiView
          from={{ opacity: 0, translateY: 16 }}
          animate={{ opacity: exiting ? 0 : 1, translateY: exiting ? -8 : 0 }}
          transition={{ type: 'timing', duration: 380, delay: 120, easing: Easing.out(Easing.cubic) }}
        >
          <Text style={styles.introTitle}>{t('readyTitle')}</Text>
          <Text style={styles.introSubtitle}>{t('readySubtitle')}</Text>
        </MotiView>

        <MotiView
          style={styles.introDotsRow}
          from={{ opacity: 0 }}
          animate={{ opacity: exiting ? 0 : 1 }}
          transition={{ type: 'timing', duration: 300, delay: 260 }}
        >
          {[0, 1, 2].map((i) => (
            <MotiView
              key={i}
              style={styles.introDot}
              from={{ opacity: 0.3, scale: 1 }}
              animate={{ opacity: 1, scale: 1.3 }}
              transition={{
                type: 'timing',
                duration: 500,
                loop: true,
                repeatReverse: true,
                delay: i * 160,
                easing: Easing.inOut(Easing.ease),
              }}
            />
          ))}
        </MotiView>

        <Text style={styles.introFooter}>{'>_'} MrClod</Text>
      </SafeAreaView>
    </MotiView>
  );
}

function AppInner() {
  const { t, lang, setLang } = useLang();
  const [showIntro, setShowIntro] = useState(true);
  const [pairing, setPairing] = useState(null); // {ip, port, token}
  const [ip, setIp] = useState('');
  const [port, setPort] = useState('7878');
  const [token, setToken] = useState('');
  const [connected, setConnected] = useState(false);
  const [messages, setMessages] = useState([]);
  const [draft, setDraft] = useState('');
  const [sessions, setSessions] = useState([]);
  const [activeSessionId, setActiveSessionId] = useState(null);
  const [activeTab, setActiveTab] = useState('chat'); // 'chat' | 'tasks' | 'settings'
  const [selectedTaskId, setSelectedTaskId] = useState(null);
  const [clearedTaskIds, setClearedTaskIds] = useState({}); // session_id -> hidden task ids
  const [newSessionTitle, setNewSessionTitle] = useState('');
  const [showNewSessionInput, setShowNewSessionInput] = useState(false);
  const [isBusy, setIsBusy] = useState(false);
  const [pairingError, setPairingError] = useState('');
  const [showScanner, setShowScanner] = useState(false);
  const scanLockRef = useRef(false);
  const [cameraPermission, requestCameraPermission] = useCameraPermissions();
  const [confirm, setConfirm] = useState(null); // {title, subtitle, actionLabel, onConfirm}
  const [permissionRequest, setPermissionRequest] = useState(null); // {approval_id, session_id, tool_name, input}
  const [queue, setQueue] = useState([]); // messages not yet sent to a live connection
  const wsRef = useRef(null);
  const keyRef = useRef(null);
  const listRef = useRef(null);
  const queueRef = useRef([]);
  const reconnectAttemptsRef = useRef(0);
  const activeSessionIdRef = useRef(null);
  const pendingNewSessionTitleRef = useRef(null);
  // AsyncStorage keeps call order, so the write effects below would persist their
  // empty initial state before the load effect got to read — wiping the queue and
  // the cleared-task list on every launch. Only persist once the load is done.
  const loadedRef = useRef(false);

  useEffect(() => {
    activeSessionIdRef.current = activeSessionId;
  }, [activeSessionId]);

  useEffect(() => {
    queueRef.current = queue;
    if (loadedRef.current) AsyncStorage.setItem(QUEUE_KEY, JSON.stringify(queue));
  }, [queue]);

  useEffect(() => {
    if (loadedRef.current) AsyncStorage.setItem(TASK_CLEAR_KEY, JSON.stringify(clearedTaskIds));
  }, [clearedTaskIds]);

  useEffect(() => {
    Promise.all([
      loadPairing().then((saved) => {
        if (!saved) return;
        setIp(saved.ip);
        setPort(String(saved.port));
        setToken(saved.token);
        setPairing(saved);
      }),
      AsyncStorage.getItem(TASK_CLEAR_KEY).then((raw) => {
        if (raw) setClearedTaskIds(JSON.parse(raw));
      }),
      AsyncStorage.getItem(QUEUE_KEY).then((raw) => {
        if (raw) setQueue(JSON.parse(raw));
      }),
    ])
      .catch((e) => console.warn('load failed:', e))
      .finally(() => {
        loadedRef.current = true;
      });
    Notifications.requestPermissionsAsync().catch((e) => console.warn('permission request failed:', e));
  }, []);

  useEffect(() => {
    if (!pairing) return;
    connect(pairing);
    // clear the ref before closing, otherwise onclose sees wsRef.current === ws
    // and schedules a reconnect for a screen that is already gone
    return () => {
      const ws = wsRef.current;
      wsRef.current = null;
      ws?.close();
    };
  }, [pairing]);

  function connect({ ip, port, token }) {
    // ponytail: accept either a bare "host" (LAN) or a full "wss://host"
    // (tunnel) in the same field instead of a separate UI toggle.
    const url = ip.includes('://') ? ip : `ws://${ip}:${port}`;
    const ws = new WebSocket(url);
    ws.binaryType = 'arraybuffer';
    wsRef.current = ws;
    const key = deriveKey(token);
    keyRef.current = key;
    const send = (obj) => ws.send(encryptFrame(key, obj));

    // ponytail: adb-reverse/router tunnels can leave a socket that reports
    // OPEN but is actually dead. A periodic ping forces a real round trip so
    // a stale connection gets closed (and reconnected) instead of silently
    // swallowing the next send().
    const pingInterval = setInterval(() => {
      if (ws.readyState === WebSocket.OPEN) send({ type: 'ping' });
    }, 10000);

    ws.onopen = () => {
      send({ type: 'auth', token });
    };

    ws.onmessage = (e) => {
      const msg = decryptFrame(key, e.data);
      if (!msg) return;
      if (msg.type === 'ack') {
        setConnected(true);
        reconnectAttemptsRef.current = 0;
        // ponytail: flush whatever piled up while disconnected, in order,
        // then clear — no per-message ack/retry bookkeeping, good enough
        // for a phone that was briefly offline.
        const pending = queueRef.current;
        if (pending.length) {
          pending.forEach((m) =>
            send({ type: 'new_request', session_id: m.session_id, message: m.content })
          );
          setQueue([]);
        }
        // reconnect: re-request history for whatever chat the user was in
        if (activeSessionIdRef.current) {
          send({ type: 'switch_session', session_id: activeSessionIdRef.current });
        }
      } else if (msg.type === 'sessions') {
        setSessions(msg.items);
        if (!activeSessionIdRef.current && msg.items.length) {
          const first = msg.items[0].id;
          activeSessionIdRef.current = first;
          setActiveSessionId(first);
          send({ type: 'switch_session', session_id: first });
        }
      } else if (msg.type === 'session_created') {
        setSessions((prev) => [...prev, msg.session]);
        if (pendingNewSessionTitleRef.current && msg.session.title === pendingNewSessionTitleRef.current) {
          pendingNewSessionTitleRef.current = null;
          activeSessionIdRef.current = msg.session.id;
          setActiveSessionId(msg.session.id);
          send({ type: 'switch_session', session_id: msg.session.id });
        }
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
        setIsBusy(false);
        setMessages((prev) => [
          ...prev,
          { id: Date.now(), role: 'assistant', content: msg.content, image_base64: msg.image_base64, created_at: '' },
        ]);
        notify('Claude Code', truncateWords(msg.content, 85));
      } else if (msg.type === 'status_update') {
        // ponytail: hook-triggered status_updates (Stop/Notification) carry
        // no session_id at all — they're global, not tied to any chat. Only
        // filter when the server DID scope this update to a session.
        if (msg.session_id && msg.session_id !== activeSessionIdRef.current) return;
        if (msg.status === 'waiting_input') notify('Claude Code', t('waitingForYou'));
        setIsBusy(msg.status === 'busy');
      } else if (msg.type === 'error') {
        if (msg.session_id !== activeSessionIdRef.current) return;
        setIsBusy(false);
        notify('Claude Code Remote', msg.message);
      } else if (msg.type === 'permission_request') {
        // Fires once per tool call while a session is in "ask" mode — desktop
        // is running headless and blocks on this until answered (or 120s
        // pass, which the desktop treats as deny). The bubble only renders
        // inside the chat tab's FlatList footer, so force-switch there —
        // otherwise a user on Tasks/Settings gets the notification but no
        // way to actually answer without manually tapping back to chat.
        setActiveTab('chat');
        if (msg.session_id) {
          activeSessionIdRef.current = msg.session_id;
          setActiveSessionId(msg.session_id);
          send({ type: 'switch_session', session_id: msg.session_id });
        }
        setPermissionRequest(msg);
        haptic(Haptics.ImpactFeedbackStyle.Heavy);
        notify('Claude Code', t('askingPermission', msg.tool_name));
      } else if (msg.type === 'permission_resolved') {
        setPermissionRequest((prev) => (prev?.approval_id === msg.approval_id ? null : prev));
      }
    };

    ws.onerror = () => setConnected(false);
    ws.onclose = () => {
      clearInterval(pingInterval);
      setConnected(false);
      // ponytail: exponential backoff capped at 30s, no jitter — fine for a
      // single client reconnecting to one desktop, add jitter if this ever
      // fans out to many phones hammering the same server at once.
      const attempt = reconnectAttemptsRef.current++;
      const delay = Math.min(3000 * 2 ** attempt, 30000);
      setTimeout(() => {
        if (wsRef.current === ws) connect({ ip, port, token });
      }, delay);
    };
  }

  async function savePairing() {
    const host = ip.trim();
    const tok = token.trim();
    const isUrl = host.includes('://');
    const portNum = Number(port);
    if (!host) return setPairingError(t('ipRequired'));
    if (!isUrl && !(Number.isInteger(portNum) && portNum > 0 && portNum < 65536)) {
      return setPairingError(t('portInvalid'));
    }
    if (!tok) return setPairingError(t('tokenRequired'));
    setPairingError('');
    const info = { ip: host, port: portNum, token: tok };
    await SecureStore.setItemAsync(STORAGE_KEY, JSON.stringify(info));
    setPairing(info);
  }

  // desktop's "get_pairing_qr" command encodes exactly {ip, port, token} as the QR payload
  async function pairFromScan(raw) {
    try {
      const data = JSON.parse(raw);
      const host = String(data.ip || '').trim();
      const portNum = Number(data.port);
      const tok = String(data.token || '').trim();
      if (!host || !tok || !Number.isInteger(portNum) || portNum <= 0 || portNum >= 65536) {
        throw new Error('bad qr');
      }
      const info = { ip: host, port: portNum, token: tok };
      await SecureStore.setItemAsync(STORAGE_KEY, JSON.stringify(info));
      setPairing(info);
    } catch {
      setPairingError(t('qrNotRecognized'));
    }
    setShowScanner(false);
  }

  async function unpair() {
    haptic(Haptics.ImpactFeedbackStyle.Medium);
    // drop the ref first: onclose reconnects while wsRef still points at this
    // socket, which would silently re-establish the session right after logout
    const ws = wsRef.current;
    wsRef.current = null;
    ws?.close();
    await SecureStore.deleteItemAsync(STORAGE_KEY).catch(() => {});
    await AsyncStorage.multiRemove([QUEUE_KEY, TASK_CLEAR_KEY]);
    activeSessionIdRef.current = null;
    reconnectAttemptsRef.current = 0;
    setPairing(null);
    setConnected(false);
    setSessions([]);
    setMessages([]);
    setQueue([]);
    setClearedTaskIds({});
    setActiveSessionId(null);
    setSelectedTaskId(null);
    setActiveTab('chat');
    setToken('');
    setConfirm(null);
  }

  function send() {
    if (!draft.trim() || !activeSessionId) return;
    haptic();
    const item = { id: Date.now(), role: 'user', content: draft, created_at: '', session_id: activeSessionId };
    setMessages((prev) => [...prev, item]);

    const isOpen = wsRef.current && wsRef.current.readyState === WebSocket.OPEN;
    if (!isOpen) {
      setQueue((prev) => [...prev, item]);
      notify('Claude Code Remote', t('noConnectionQueued'));
      wsRef.current?.close();
      setDraft('');
      return;
    }
    wsRef.current.send(encryptFrame(keyRef.current, { type: 'new_request', session_id: activeSessionId, message: draft }));
    setDraft('');
  }

  function switchSession(sessionId) {
    if (!wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) {
      notify('Claude Code Remote', t('noConnectionRetry'));
      return;
    }
    haptic();
    activeSessionIdRef.current = sessionId;
    setActiveSessionId(sessionId);
    setMessages([]);
    setIsBusy(false);
    setActiveTab('chat');
    wsRef.current.send(encryptFrame(keyRef.current, { type: 'switch_session', session_id: sessionId }));
  }

  function createSession() {
    const title = newSessionTitle.trim();
    if (!title) return;
    if (!wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) {
      notify('Claude Code Remote', t('noConnectionRetry'));
      return;
    }
    haptic();
    pendingNewSessionTitleRef.current = title;
    setNewSessionTitle('');
    setShowNewSessionInput(false);
    wsRef.current.send(encryptFrame(keyRef.current, { type: 'create_session', title }));
  }

  function deleteSession(session) {
    setConfirm({
      title: t('deleteChatTitle'),
      subtitle: t('deleteChatSubtitle', session.title),
      actionLabel: t('delete'),
      onConfirm: () => confirmDeleteSession(session),
    });
  }

  function confirmDeleteSession(session) {
    haptic(Haptics.ImpactFeedbackStyle.Medium);
    if (!wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) {
      notify('Claude Code Remote', t('noConnectionRetry'));
      setConfirm(null);
      return;
    }
    wsRef.current.send(encryptFrame(keyRef.current, { type: 'delete_session', session_id: session.id }));
    setConfirm(null);
  }

  function askUnpair() {
    setConfirm({
      title: t('logoutTitle'),
      subtitle: t('logoutSubtitle'),
      actionLabel: t('logout'),
      onConfirm: unpair,
    });
  }

  const MODELS = [
    { label: 'Sonnet 5', value: 'sonnet' },
    { label: 'Opus 4.8', value: 'opus' },
    { label: 'Haiku 4.5', value: 'haiku' },
    { label: 'Fable 5', value: 'fable' },
  ];

  function setModel(model) {
    if (!activeSessionId) return;
    if (!wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) {
      notify('Claude Code Remote', t('noConnectionRetry'));
      return;
    }
    wsRef.current.send(encryptFrame(keyRef.current, { type: 'set_model', session_id: activeSessionId, model }));
  }

  const EFFORTS = [
    { label: 'Low', value: 'low' },
    { label: 'Medium', value: 'medium' },
    { label: 'High', value: 'high' },
    { label: 'XHigh', value: 'xhigh' },
    { label: 'Max', value: 'max' },
  ];

  function setEffort(effort) {
    if (!activeSessionId) return;
    if (!wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) {
      notify('Claude Code Remote', t('noConnectionRetry'));
      return;
    }
    wsRef.current.send(encryptFrame(keyRef.current, { type: 'set_effort', session_id: activeSessionId, effort }));
  }

  const PERMISSION_MODES = [
    { label: t('permAsk'), value: 'ask' },
    { label: t('permSkip'), value: 'skip' },
  ];

  function setPermissionMode(mode) {
    if (!activeSessionId) return;
    if (!wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) {
      notify('Claude Code Remote', t('noConnectionRetry'));
      return;
    }
    wsRef.current.send(encryptFrame(keyRef.current, { type: 'set_permission_mode', session_id: activeSessionId, permission_mode: mode }));
  }

  function respondPermission(approve) {
    if (!permissionRequest) return;
    haptic(Haptics.ImpactFeedbackStyle.Medium);
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(encryptFrame(keyRef.current, {
        type: 'respond_permission',
        approval_id: permissionRequest.approval_id,
        approve,
      }));
    }
    setPermissionRequest(null);
  }

  const activeSession = sessions.find((s) => s.id === activeSessionId);

  // ponytail: no separate task entity on the server — a "task" is just a
  // user message paired with the assistant reply that immediately follows
  // it in the same session's message list.
  const tasks = [];
  for (let i = 0; i < messages.length; i++) {
    if (messages[i].role !== 'user') continue;
    const reply = messages[i + 1]?.role === 'assistant' ? messages[i + 1] : null;
    tasks.push({
      id: messages[i].id,
      prompt: messages[i].content,
      reply: reply?.content || null,
      createdAt: messages[i].created_at,
      status: reply ? 'done' : isBusy ? 'busy' : 'pending',
    });
  }
  tasks.reverse();
  // ponytail: hide cleared tasks by id, not by an id > cutoff comparison. Live
  // messages carry a local Date.now() id and reloaded history carries the much
  // smaller server id, so a cutoff taken from a live id hid every task forever.
  // Ceiling: tasks cleared while live reappear once history reloads under their
  // server ids — fix properly by having the server own "cleared".
  const hiddenIds = clearedTaskIds[activeSessionId] || [];
  const visibleTasks = tasks.filter((t) => !hiddenIds.includes(String(t.id)));
  const selectedTask = tasks.find((t) => String(t.id) === String(selectedTaskId));

  function clearTasks() {
    if (!activeSessionId || !visibleTasks.length) return;
    haptic();
    const justCleared = visibleTasks.map((t) => String(t.id));
    setClearedTaskIds((prev) => ({
      ...prev,
      [activeSessionId]: [...(prev[activeSessionId] || []), ...justCleared],
    }));
  }

  if (!pairing) {
    return (
      <>
      {showIntro && <IntroScreen onDone={() => setShowIntro(false)} />}
      <MotiView
        style={styles.container}
        from={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ type: 'timing', duration: 250 }}
      >
        <AmbientGlow />
        <SafeAreaView style={{ flex: 1 }}>
        <View style={styles.pairingWrap}>
          <View style={styles.pairingLogoRing}>
            <Image source={require('./assets/mrclod_logo.png')} style={styles.pairingLogo} />
          </View>
          <Text style={styles.title}>{t('pairingTitle')}</Text>
          <Text style={styles.pairingSubtitle}>{t('pairingSubtitle')}</Text>
          <BlurView intensity={30} tint="dark" style={styles.card}>
            <Text style={styles.label}>{t('ipLabel')}</Text>
            <TextInput
              style={styles.input}
              value={ip}
              onChangeText={setIp}
              placeholder={t('ipPlaceholder')}
              placeholderTextColor="#DBC1B8"
              autoCapitalize="none"
            />
            <Text style={styles.label}>{t('portLabel')}</Text>
            <TextInput
              style={styles.input}
              value={port}
              onChangeText={setPort}
              keyboardType="numeric"
              placeholderTextColor="#DBC1B8"
            />
            <Text style={styles.label}>{t('tokenLabel')}</Text>
            <TextInput
              style={styles.input}
              value={token}
              onChangeText={setToken}
              placeholder={t('tokenPlaceholder')}
              autoCapitalize="none"
              placeholderTextColor="#DBC1B8"
            />
            <Text style={styles.pairingHint}>
              {t('pairingHint')}
            </Text>
            {!!ip.trim() && !ip.includes('://') && (
              <View style={styles.warnBox}>
                <Ionicons name="lock-open-outline" size={14} color="#FFB4AB" />
                <Text style={styles.warnBoxText}>
                  {t('warnBoxText')}
                </Text>
              </View>
            )}
            {!!pairingError && <Text style={styles.errorText}>{pairingError}</Text>}
            <PressableScale onPress={() => { haptic(); savePairing(); }}>
              <LinearGradient
                colors={[CORAL, '#D9714B']}
                start={{ x: 0, y: 0 }}
                end={{ x: 1, y: 1 }}
                style={styles.button}
              >
                <Text style={styles.buttonText}>{t('connect')}</Text>
              </LinearGradient>
            </PressableScale>
            <PressableScale
              onPress={async () => {
                haptic();
                if (!cameraPermission?.granted) {
                  const res = await requestCameraPermission();
                  if (!res.granted) return;
                }
                scanLockRef.current = false;
                setPairingError('');
                setShowScanner(true);
              }}
              style={{ marginTop: 10 }}
            >
              <View style={styles.scanButton}>
                <Ionicons name="qr-code-outline" size={16} color={TEAL} />
                <Text style={styles.scanButtonText}>{t('scanQr')}</Text>
              </View>
            </PressableScale>
          </BlurView>
          <Text style={styles.footer}>{t('footer')}</Text>
        </View>
        <StatusBar style="light" />
        </SafeAreaView>
      </MotiView>
      <Modal visible={showScanner} animationType="slide" onRequestClose={() => setShowScanner(false)}>
        <View style={{ flex: 1, backgroundColor: '#000' }}>
          <CameraView
            style={{ flex: 1 }}
            barcodeScannerSettings={{ barcodeTypes: ['qr'] }}
            onBarcodeScanned={({ data }) => {
              if (scanLockRef.current) return;
              scanLockRef.current = true;
              pairFromScan(data);
            }}
          />
          <SafeAreaView style={styles.scanCloseWrap}>
            <PressableScale onPress={() => setShowScanner(false)}>
              <View style={styles.scanCloseButton}>
                <Ionicons name="close" size={22} color="#fff" />
              </View>
            </PressableScale>
          </SafeAreaView>
        </View>
      </Modal>
      </>
    );
  }

  return (
    <>
    {showIntro && <IntroScreen onDone={() => setShowIntro(false)} />}
    <MotiView
      style={styles.container}
      from={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ type: 'timing', duration: 250 }}
    >
      <SafeAreaView style={{ flex: 1 }}>
      {/* edge-to-edge means the window never resizes for the IME, so Android needs
          an explicit behavior too — undefined made this a no-op and the keyboard
          covered the composer. */}
      <KeyboardAvoidingView style={{ flex: 1, width: '100%' }} behavior="padding">
        <BlurView intensity={40} tint="dark" style={styles.topBar}>
          <AmbientGlow />
          <View style={styles.topBarRow1}>
            <View style={styles.brandGroup}>
              <View style={styles.brandIconBox}>
                <Text style={styles.brandIconBoxText}>{'>_'}</Text>
              </View>
              <Text style={styles.brandNameSmall}>MrClod</Text>
            </View>
            <View style={[styles.connectionPill, connected ? styles.connectionPillOn : styles.connectionPillOff]}>
              <Ionicons name="wifi" size={13} color={connected ? TEAL : ON_SURFACE_VARIANT} />
              <Text style={[styles.connectionPillText, connected && { color: TEAL }]} numberOfLines={1}>
                {connected ? t('connected') : t('reconnecting')}
              </Text>
            </View>
          </View>
        </BlurView>
        {activeTab === 'chat' && (
          <>
            <FlatList
              ref={listRef}
              data={messages}
              keyExtractor={(item) => String(item.id)}
              style={{ flex: 1, width: '100%' }}
              contentContainerStyle={{ padding: 12, flexGrow: 1 }}
              onContentSizeChange={() => listRef.current?.scrollToEnd({ animated: true })}
              renderItem={({ item }) => <MessageBubble item={item} />}
              ListEmptyComponent={<EmptyChatState />}
              ListFooterComponent={
                permissionRequest ? (
                  <PermissionRequestBubble request={permissionRequest} onRespond={respondPermission} />
                ) : isBusy ? (
                  <TypingIndicator />
                ) : null
              }
            />
            <View style={styles.row}>
              <TextInput
                style={[styles.input, styles.chatInput]}
                value={draft}
                onChangeText={setDraft}
                placeholder={t('composerPlaceholder')}
                placeholderTextColor="#DBC1B8"
                multiline
              />
              <PressableScale onPress={send}>
                <LinearGradient
                  colors={[CORAL, '#D9714B']}
                  start={{ x: 0, y: 0 }}
                  end={{ x: 1, y: 1 }}
                  style={styles.sendButton}
                >
                  <Ionicons name="send" size={19} color={ON_PRIMARY} />
                </LinearGradient>
              </PressableScale>
            </View>
          </>
        )}

        {activeTab === 'tasks' && !selectedTask && (
          <FlatList
            data={visibleTasks}
            keyExtractor={(item) => String(item.id)}
            style={{ flex: 1, width: '100%' }}
            contentContainerStyle={{ padding: 12, flexGrow: 1 }}
            ListHeaderComponent={
              visibleTasks.length ? (
                <PressableScale style={styles.clearTasksButton} onPress={clearTasks}>
                  <Ionicons name="trash-outline" size={14} color={ON_SURFACE_VARIANT} />
                  <Text style={styles.clearTasksButtonText}>{t('clear')}</Text>
                </PressableScale>
              ) : null
            }
            ListEmptyComponent={
              <View style={styles.emptyWrap}>
                <Ionicons name="checkmark-done-outline" size={40} color={ON_SURFACE_VARIANT} />
                <Text style={styles.emptyText}>{t('noTasks')}</Text>
              </View>
            }
            renderItem={({ item }) => (
              <PressableScale style={styles.taskRow} onPress={() => setSelectedTaskId(item.id)}>
                {item.status === 'done' ? (
                  <View style={styles.taskStatusIconDone}>
                    <Ionicons name="checkmark" size={14} color={BG} />
                  </View>
                ) : (
                  <MotiView
                    style={styles.taskStatusIconBusy}
                    from={{ opacity: 0.4 }}
                    animate={{ opacity: 1 }}
                    transition={{ type: 'timing', duration: 700, loop: true, repeatReverse: true }}
                  >
                    <Ionicons name="time-outline" size={14} color={CORAL} />
                  </MotiView>
                )}
                <View style={{ flex: 1 }}>
                  <Text style={styles.taskRowTitle} numberOfLines={1}>{item.prompt}</Text>
                  <Text style={styles.taskRowStatus}>
                    {item.status === 'done' ? t('taskDone') : t('taskInProgress')}
                  </Text>
                </View>
                <Ionicons name="chevron-forward" size={18} color={ON_SURFACE_VARIANT} />
              </PressableScale>
            )}
          />
        )}

        {activeTab === 'tasks' && selectedTask && (
          <FlatList
            style={{ flex: 1, width: '100%' }}
            contentContainerStyle={{ padding: 20, alignItems: 'center' }}
            data={[]}
            renderItem={() => null}
            ListHeaderComponent={
              <>
                <PressableScale style={styles.taskBackButton} onPress={() => setSelectedTaskId(null)}>
                  <Ionicons name="chevron-back" size={18} color={ON_SURFACE_VARIANT} />
                  <Text style={styles.taskBackButtonText}>{t('allTasks')}</Text>
                </PressableScale>

                {selectedTask.status === 'done' ? (
                  <View style={styles.taskBigStatusDone}>
                    <Ionicons name="checkmark" size={34} color={BG} />
                  </View>
                ) : (
                  <View style={styles.taskBigStatusBusy}>
                    <Ionicons name="time-outline" size={34} color={CORAL} />
                  </View>
                )}
                <Text style={styles.taskBigTitle}>
                  {selectedTask.status === 'done' ? t('taskCompletedTitle') : t('taskInProgressTitle')}
                </Text>
                <Text style={styles.taskBigSubtitle}>
                  {selectedTask.status === 'done' ? t('taskCompletedBody') : t('taskInProgressBody')}
                </Text>

                <View style={styles.taskResultCard}>
                  <Text style={styles.settingsSectionLabel}>{t('request')}</Text>
                  <Text style={styles.taskResultText}>{selectedTask.prompt}</Text>
                  {selectedTask.reply && (
                    <>
                      <View style={{ height: 12 }} />
                      <Text style={styles.settingsSectionLabel}>{t('result')}</Text>
                      <Text style={styles.taskResultText}>{truncateWords(selectedTask.reply, 85)}</Text>
                    </>
                  )}
                </View>

                <PressableScale
                  onPress={() => { setActiveTab('chat'); setSelectedTaskId(null); }}
                  style={{ width: '100%' }}
                >
                  <LinearGradient
                    colors={[CORAL, '#D9714B']}
                    start={{ x: 0, y: 0 }}
                    end={{ x: 1, y: 1 }}
                    style={styles.button}
                  >
                    <Text style={styles.buttonText}>{t('replyNewRequest')}</Text>
                  </LinearGradient>
                </PressableScale>
                <PressableScale
                  style={styles.taskSecondaryButton}
                  onPress={() => { setActiveTab('chat'); setSelectedTaskId(null); }}
                >
                  <Text style={styles.taskSecondaryButtonText}>{t('viewInChat')}</Text>
                </PressableScale>
              </>
            }
          />
        )}

        {activeTab === 'settings' && (
          <FlatList
            style={{ flex: 1, width: '100%' }}
            contentContainerStyle={{ padding: 12 }}
            data={[{ key: 'chats' }, { key: 'model' }, { key: 'effort' }, { key: 'permission' }, { key: 'logout' }]}
            keyExtractor={(item) => item.key}
            ListHeaderComponent={
              <Text style={styles.activeSessionTitle} numberOfLines={1}>
                {activeSession?.title || '...'}
              </Text>
            }
            renderItem={({ item }) => {
              if (item.key === 'chats') {
                return (
                  <View style={{ marginTop: 16 }}>
                    <Text style={styles.settingsSectionLabel}>{t('chats')}</Text>
                    {!showNewSessionInput ? (
                      <PressableScale onPress={() => { haptic(); setShowNewSessionInput(true); }}>
                        <LinearGradient
                          colors={[CORAL, '#D9714B']}
                          start={{ x: 0, y: 0 }}
                          end={{ x: 1, y: 1 }}
                          style={[styles.newChatPrimaryButton, { marginHorizontal: 0 }]}
                        >
                          <Ionicons name="add-circle" size={20} color={ON_PRIMARY} />
                          <Text style={styles.buttonText}>{t('newChat')}</Text>
                        </LinearGradient>
                      </PressableScale>
                    ) : (
                      <MotiView
                        style={[styles.newSessionRow, { paddingHorizontal: 0 }]}
                        from={{ opacity: 0, translateY: -8 }}
                        animate={{ opacity: 1, translateY: 0 }}
                        transition={SPRING}
                      >
                        <TextInput
                          style={[styles.input, { flex: 1, marginTop: 0 }]}
                          value={newSessionTitle}
                          onChangeText={setNewSessionTitle}
                          placeholder={t('newChatPlaceholder')}
                          placeholderTextColor="#DBC1B8"
                          autoFocus
                        />
                        <PressableScale style={styles.createButton} onPress={createSession}>
                          <Text style={styles.buttonText}>{t('create')}</Text>
                        </PressableScale>
                        <IconButton
                          name="close"
                          color={ON_SURFACE_VARIANT}
                          onPress={() => { setShowNewSessionInput(false); setNewSessionTitle(''); }}
                        />
                      </MotiView>
                    )}
                    {sessions.map((item) => (
                      <View
                        key={item.id}
                        style={[styles.sessionRow, { marginTop: 10 }, item.id === activeSessionId && styles.sessionRowActive]}
                      >
                        <Pressable style={styles.sessionRowMain} onPress={() => switchSession(item.id)}>
                          <Ionicons name="chatbubbles-outline" size={18} color={ON_SURFACE_VARIANT} style={{ marginRight: 10 }} />
                          <View style={styles.sessionRowTextCol}>
                            <Text style={styles.sessionRowTitle} numberOfLines={1}>{item.title}</Text>
                            <View style={styles.sessionRowMetaRow}>
                              <Text style={styles.sessionRowModelPill}>
                                {MODELS.find((m) => m.value === item.model)?.label || 'Sonnet 5'}
                              </Text>
                              {!!item.created_at && <Text style={styles.sessionRowDate}>{item.created_at}</Text>}
                            </View>
                          </View>
                        </Pressable>
                        <IconButton
                          name="trash-outline"
                          color="#FFB4AB"
                          size={19}
                          onPress={() => deleteSession(item)}
                          style={styles.sessionDeleteButton}
                        />
                      </View>
                    ))}
                  </View>
                );
              }
              if (item.key === 'logout') {
                return (
                  <View style={{ marginTop: 28 }}>
                    <Text style={styles.settingsSectionLabel}>{t('language')}</Text>
                    <View style={{ flexDirection: 'row', gap: 8 }}>
                      {['en', 'ru'].map((code) => (
                        <PressableScale
                          key={code}
                          style={[styles.modelRow, lang === code && styles.modelRowActive, { flex: 1 }]}
                          onPress={() => { haptic(); setLang(code); }}
                        >
                          <Text style={styles.modelRowLabel}>{code.toUpperCase()}</Text>
                        </PressableScale>
                      ))}
                    </View>
                    <View style={{ height: 24 }} />
                    <Text style={styles.settingsSectionLabel}>{t('session')}</Text>
                    <PressableScale style={styles.logoutButton} onPress={askUnpair}>
                      <Ionicons name="log-out-outline" size={19} color="#FFB4AB" />
                      <Text style={styles.logoutButtonText}>{t('logout')}</Text>
                    </PressableScale>
                    <Text style={styles.logoutHint}>
                      {pairing?.ip}
                      {pairing?.ip?.includes('://') ? '' : `:${pairing?.port}`}
                    </Text>
                  </View>
                );
              }
              const SECTION = {
                model: { title: t('model'), options: MODELS, info: modelInfo(t), current: activeSession?.model || 'sonnet', onSelect: setModel },
                effort: { title: 'Effort', options: EFFORTS, info: effortInfo(t), current: activeSession?.effort || 'medium', onSelect: setEffort },
                permission: { title: t('permissions'), options: PERMISSION_MODES, info: permissionModeInfo(t), current: activeSession?.permission_mode || 'ask', onSelect: setPermissionMode },
              }[item.key];
              return (
                <View style={{ marginTop: 20 }}>
                  <Text style={styles.settingsSectionLabel}>{SECTION.title}</Text>
                  {SECTION.options.map((opt) => {
                    const active = opt.value === SECTION.current;
                    return (
                      <PressableScale
                        key={opt.value}
                        style={[styles.modelRow, active && styles.modelRowActive]}
                        onPress={() => { haptic(); SECTION.onSelect(opt.value); }}
                      >
                        <View style={{ flex: 1 }}>
                          <Text style={styles.modelRowLabel}>{opt.label}</Text>
                          <Text style={styles.modelRowDesc}>{SECTION.info[opt.value]}</Text>
                        </View>
                        {active && <Ionicons name="checkmark-circle" size={22} color={CORAL} />}
                      </PressableScale>
                    );
                  })}
                </View>
              );
            }}
          />
        )}

        <BlurView intensity={40} tint="dark" style={styles.tabBar}>
          <PressableScale style={styles.tabItem} onPress={() => { haptic(); setActiveTab('chat'); }}>
            {activeTab === 'chat' ? (
              <View style={styles.tabItemActiveCircle}>
                <Ionicons name="chatbubble-ellipses" size={20} color={ON_PRIMARY} />
              </View>
            ) : (
              <Ionicons name="chatbubble-ellipses-outline" size={22} color={ON_SURFACE_VARIANT} />
            )}
          </PressableScale>
          <PressableScale style={styles.tabItem} onPress={() => { haptic(); setActiveTab('tasks'); setSelectedTaskId(null); }}>
            {activeTab === 'tasks' ? (
              <View style={styles.tabItemActiveCircle}>
                <Ionicons name="checkmark-done" size={20} color={ON_PRIMARY} />
              </View>
            ) : (
              <Ionicons name="checkmark-done-outline" size={22} color={ON_SURFACE_VARIANT} />
            )}
          </PressableScale>
          <PressableScale style={styles.tabItem} onPress={() => { haptic(); setActiveTab('settings'); }}>
            {activeTab === 'settings' ? (
              <View style={styles.tabItemActiveCircle}>
                <Ionicons name="settings" size={20} color={ON_PRIMARY} />
              </View>
            ) : (
              <Ionicons name="settings-outline" size={22} color={ON_SURFACE_VARIANT} />
            )}
          </PressableScale>
        </BlurView>
      </KeyboardAvoidingView>
      <StatusBar style="light" />
      </SafeAreaView>

      <Modal visible={!!confirm} transparent animationType="none" onRequestClose={() => setConfirm(null)}>
        <Pressable style={styles.sheetScrim} onPress={() => setConfirm(null)}>
          <MotiView
            style={styles.confirmSheet}
            from={{ translateY: 300, opacity: 0 }}
            animate={{ translateY: confirm ? 0 : 300, opacity: confirm ? 1 : 0 }}
            transition={SPRING}
          >
            <Pressable onPress={() => {}}>
              <View style={styles.sheetHandle} />
              <Ionicons name="warning-outline" size={28} color="#FFB4AB" style={{ alignSelf: 'center', marginBottom: 8 }} />
              <Text style={styles.sheetTitle}>{confirm?.title}</Text>
              <Text style={styles.sheetSubtitle}>{confirm?.subtitle}</Text>
              <PressableScale style={styles.destructiveButton} onPress={() => confirm?.onConfirm()}>
                <Text style={styles.destructiveButtonText}>{confirm?.actionLabel}</Text>
              </PressableScale>
              <PressableScale style={styles.cancelButton} onPress={() => setConfirm(null)}>
                <Text style={styles.cancelButtonText}>{t('cancel')}</Text>
              </PressableScale>
            </Pressable>
          </MotiView>
        </Pressable>
      </Modal>
    </MotiView>
    </>
  );
}

export default function App() {
  return (
    <LanguageProvider>
      <AppInner />
    </LanguageProvider>
  );
}

const BG = '#0E0E12';
const SURFACE = '#1A1A20';
const OUTLINE = '#26262E';
const CORAL = '#E8825A';
const ON_PRIMARY = '#0E0E12';
const ON_SURFACE = '#F1DFD9';
const ON_SURFACE_VARIANT = '#DBC1B8';
const TEAL = '#54dace';

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: BG, padding: 16, paddingTop: 40 },
  glowWrap: { position: 'absolute', top: 0, left: 0, right: 0, height: 280, overflow: 'hidden' },
  glowBlob: { position: 'absolute', width: 260, height: 260, borderRadius: 130 },
  glowGradient: { flex: 1, borderRadius: 130 },
  glowCoral: { top: -80, left: -60 },
  glowTeal: { top: -40, right: -80 },
  scanButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingVertical: 12,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: 'rgba(84,218,206,0.3)',
    backgroundColor: 'rgba(84,218,206,0.08)',
  },
  scanButtonText: { color: TEAL, fontSize: 14, fontWeight: '600' },
  scanCloseWrap: { position: 'absolute', top: 0, right: 0, padding: 16 },
  scanCloseButton: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(0,0,0,0.5)',
  },
  pairingWrap: { flex: 1, justifyContent: 'center' },
  pairingLogoRing: {
    width: 96,
    height: 96,
    borderRadius: 48,
    alignSelf: 'center',
    marginBottom: 20,
    backgroundColor: 'rgba(232,130,90,0.1)',
    borderWidth: 1,
    borderColor: 'rgba(232,130,90,0.3)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  pairingLogo: { width: 96, height: 96, borderRadius: 48 },
  pairingSubtitle: {
    color: ON_SURFACE_VARIANT,
    fontSize: 14,
    textAlign: 'center',
    marginTop: -12,
    marginBottom: 24,
  },
  pairingHint: {
    color: ON_SURFACE_VARIANT,
    fontSize: 11,
    marginTop: 12,
    lineHeight: 16,
  },
  title: {
    fontSize: 22,
    fontWeight: '700',
    color: ON_SURFACE,
    textAlign: 'center',
    marginBottom: 4,
    letterSpacing: -0.3,
  },
  card: {
    backgroundColor: 'rgba(26,26,32,0.55)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.08)',
    borderRadius: 20,
    padding: 20,
    overflow: 'hidden',
  },
  label: {
    fontSize: 11,
    fontWeight: '600',
    color: ON_SURFACE_VARIANT,
    marginTop: 12,
    textTransform: 'uppercase',
    letterSpacing: 1,
  },
  input: {
    borderWidth: 1,
    borderColor: OUTLINE,
    backgroundColor: BG,
    borderRadius: 12,
    padding: 12,
    marginTop: 6,
    color: ON_SURFACE,
    fontFamily: 'monospace',
  },
  button: {
    paddingVertical: 16,
    borderRadius: 16,
    marginTop: 20,
    alignItems: 'center',
    shadowColor: CORAL,
    shadowOpacity: 0.35,
    shadowRadius: 16,
    shadowOffset: { width: 0, height: 6 },
    elevation: 6,
  },
  buttonText: { color: ON_PRIMARY, fontWeight: '700', fontSize: 16 },
  footer: {
    color: ON_SURFACE_VARIANT,
    fontFamily: 'monospace',
    fontSize: 12,
    textAlign: 'center',
    marginTop: 16,
  },
  topBar: {
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(255,255,255,0.08)',
    paddingBottom: 12,
    marginBottom: 4,
    overflow: 'hidden',
    marginHorizontal: -16,
    paddingHorizontal: 16,
    marginTop: -40,
    paddingTop: 40,
  },
  topBarRow1: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  brandGroup: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  iconButton: {
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(255,255,255,0.06)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.08)',
  },
  brandIconBox: {
    width: 30,
    height: 30,
    borderRadius: 9,
    backgroundColor: 'rgba(232,130,90,0.14)',
    borderWidth: 1,
    borderColor: 'rgba(232,130,90,0.3)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  brandIconBoxText: { fontFamily: 'monospace', fontSize: 13, fontWeight: '700', color: CORAL },
  brandNameSmall: { fontSize: 18, fontWeight: '700', color: CORAL, letterSpacing: -0.3 },
  activeSessionTitle: { color: ON_SURFACE, fontSize: 16, fontWeight: '700' },
  connectionPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    borderRadius: 999,
    borderWidth: 1,
    paddingVertical: 6,
    paddingHorizontal: 12,
    maxWidth: 170,
  },
  connectionPillOn: { borderColor: 'rgba(84,218,206,0.3)', backgroundColor: 'rgba(84,218,206,0.08)' },
  connectionPillOff: { borderColor: 'rgba(255,255,255,0.1)', backgroundColor: 'rgba(255,255,255,0.05)' },
  connectionPillText: { color: ON_SURFACE_VARIANT, fontSize: 12, fontWeight: '600' },
  tabBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-around',
    borderTopWidth: 1,
    borderTopColor: 'rgba(255,255,255,0.08)',
    paddingVertical: 10,
    marginHorizontal: -16,
    paddingHorizontal: 16,
    marginBottom: -16,
    paddingBottom: 20,
  },
  tabItem: { width: 56, height: 44, alignItems: 'center', justifyContent: 'center' },
  tabItemActiveCircle: {
    width: 38,
    height: 38,
    borderRadius: 19,
    backgroundColor: CORAL,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: CORAL,
    shadowOpacity: 0.4,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 3 },
    elevation: 4,
  },
  settingsSectionLabel: {
    color: ON_SURFACE_VARIANT,
    fontSize: 11,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 1,
    marginBottom: 10,
  },
  progressCard: {
    backgroundColor: 'rgba(255,255,255,0.05)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.08)',
    borderRadius: 16,
    padding: 14,
    marginVertical: 4,
    maxWidth: '85%',
  },
  progressCardHeader: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 10 },
  progressCardLabel: { color: ON_SURFACE, fontSize: 13, fontWeight: '600' },
  progressTrack: {
    height: 4,
    borderRadius: 2,
    backgroundColor: 'rgba(255,255,255,0.08)',
    overflow: 'hidden',
  },
  progressFill: { width: 80, height: 4, borderRadius: 2, backgroundColor: CORAL },
  agentLabelRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 4, marginLeft: 2 },
  agentAvatar: {
    width: 18,
    height: 18,
    borderRadius: 9,
    backgroundColor: 'rgba(232,130,90,0.16)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  agentLabelText: { color: ON_SURFACE_VARIANT, fontSize: 11, fontWeight: '600' },
  newChatPrimaryButton: {
    flexDirection: 'row',
    gap: 8,
    borderRadius: 16,
    paddingVertical: 14,
    marginHorizontal: 12,
    marginTop: 12,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: CORAL,
    shadowOpacity: 0.3,
    shadowRadius: 14,
    shadowOffset: { width: 0, height: 5 },
    elevation: 5,
  },
  newSessionRow: { flexDirection: 'row', gap: 8, paddingHorizontal: 12, paddingTop: 12, alignItems: 'center' },
  createButton: { backgroundColor: CORAL, borderRadius: 14, paddingVertical: 12, paddingHorizontal: 14 },
  sessionRow: {
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.08)',
    backgroundColor: 'rgba(255,255,255,0.04)',
    borderRadius: 18,
    padding: 16,
    marginBottom: 10,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  sessionRowActive: { borderColor: CORAL, backgroundColor: 'rgba(232,130,90,0.08)' },
  sessionRowMain: { flex: 1, flexDirection: 'row', alignItems: 'center' },
  sessionRowTextCol: { flex: 1 },
  sessionRowTitle: { color: ON_SURFACE, fontSize: 15, fontWeight: '600' },
  sessionRowMetaRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 6 },
  sessionRowModelPill: {
    color: TEAL,
    fontSize: 10,
    fontWeight: '600',
    borderWidth: 1,
    borderColor: 'rgba(84,218,206,0.3)',
    backgroundColor: 'rgba(84,218,206,0.08)',
    borderRadius: 999,
    paddingVertical: 2,
    paddingHorizontal: 8,
    overflow: 'hidden',
  },
  sessionRowDate: { color: ON_SURFACE_VARIANT, fontSize: 11 },
  sessionDeleteButton: { marginLeft: 4, backgroundColor: 'transparent', borderColor: 'transparent' },
  row: { flexDirection: 'row', alignItems: 'flex-end', marginTop: 8, gap: 10, paddingHorizontal: 12, paddingBottom: 10 },
  chatInput: {
    flex: 1,
    backgroundColor: 'rgba(255,255,255,0.05)',
    borderColor: 'rgba(255,255,255,0.1)',
    borderRadius: 22,
    marginTop: 0,
    minHeight: 44,
    paddingVertical: 12,
  },
  sendButton: {
    width: 46,
    height: 46,
    borderRadius: 999,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: CORAL,
    shadowOpacity: 0.4,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 4 },
    elevation: 5,
  },
  msgWrapUser: { alignSelf: 'flex-end', maxWidth: '85%', marginVertical: 4 },
  msgWrapAssistant: { alignSelf: 'flex-start', maxWidth: '85%', marginVertical: 4 },
  msg: { paddingVertical: 12, paddingHorizontal: 15, borderRadius: 20 },
  msgUser: { borderBottomRightRadius: 6 },
  msgAssistant: {
    backgroundColor: 'rgba(255,255,255,0.06)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.08)',
    borderBottomLeftRadius: 6,
  },
  msgTextUser: { color: ON_PRIMARY, fontSize: 15, lineHeight: 21 },
  msgTextAssistant: { color: ON_SURFACE, fontSize: 15, lineHeight: 21 },
  msgImage: { width: '100%', aspectRatio: 16 / 9, borderRadius: 12, marginBottom: 8, backgroundColor: '#00000033' },
  emptyWrap: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 12, paddingTop: 60 },
  emptyText: { color: ON_SURFACE_VARIANT, fontSize: 14, textAlign: 'center' },
  sheetScrim: { flex: 1, backgroundColor: 'rgba(0,0,0,0.55)', justifyContent: 'flex-end' },
  confirmSheet: {
    backgroundColor: 'rgba(26,26,32,0.92)',
    borderTopLeftRadius: 28,
    borderTopRightRadius: 28,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.08)',
    padding: 20,
    paddingBottom: 32,
  },
  sheetHandle: {
    width: 36,
    height: 4,
    borderRadius: 2,
    backgroundColor: 'rgba(255,255,255,0.2)',
    alignSelf: 'center',
    marginBottom: 16,
  },
  sheetTitle: { color: ON_SURFACE, fontSize: 17, fontWeight: '700', textAlign: 'center', marginBottom: 6 },
  sheetSubtitle: { color: ON_SURFACE_VARIANT, fontSize: 13, textAlign: 'center', marginBottom: 16 },
  modelRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.08)',
    backgroundColor: 'rgba(255,255,255,0.03)',
    borderRadius: 16,
    padding: 14,
    marginBottom: 10,
  },
  modelRowActive: { borderColor: CORAL, backgroundColor: 'rgba(232,130,90,0.1)' },
  modelRowLabel: { color: ON_SURFACE, fontSize: 15, fontWeight: '700' },
  modelRowDesc: { color: ON_SURFACE_VARIANT, fontSize: 12, marginTop: 2 },
  destructiveButton: {
    backgroundColor: '#FFB4AB',
    borderRadius: 16,
    paddingVertical: 14,
    alignItems: 'center',
    marginTop: 4,
  },
  destructiveButtonText: { color: '#3a0a06', fontWeight: '700', fontSize: 15 },
  cancelButton: { paddingVertical: 14, alignItems: 'center', marginTop: 6 },
  cancelButtonText: { color: ON_SURFACE_VARIANT, fontWeight: '600', fontSize: 15 },
  allowButtonText: { color: '#0b2400', fontWeight: '700', fontSize: 15 },
  permissionBubbleInput: {
    color: ON_SURFACE_VARIANT,
    fontSize: 11,
    fontFamily: 'monospace',
    marginTop: 6,
  },
  permissionAllowBtn: {
    flex: 1,
    backgroundColor: '#9CD67D',
    borderRadius: 12,
    paddingVertical: 10,
    alignItems: 'center',
  },
  permissionDenyBtn: {
    flex: 1,
    backgroundColor: '#FFB4AB',
    borderRadius: 12,
    paddingVertical: 10,
    alignItems: 'center',
  },
  introRoot: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: BG,
    zIndex: 100,
    elevation: 100,
  },
  introInner: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 14, paddingHorizontal: 32 },
  introLogoRing: {
    width: 120,
    height: 120,
    borderRadius: 60,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 20,
  },
  introGlowPulse: {
    position: 'absolute',
    width: 150,
    height: 150,
    borderRadius: 75,
    backgroundColor: 'rgba(232,130,90,0.35)',
  },
  introLogo: { width: 120, height: 120, borderRadius: 60 },
  introTitle: {
    color: ON_SURFACE,
    fontSize: 24,
    fontWeight: '700',
    textAlign: 'center',
    letterSpacing: -0.3,
  },
  introSubtitle: {
    color: ON_SURFACE_VARIANT,
    fontSize: 14,
    textAlign: 'center',
    marginTop: 8,
  },
  introDotsRow: { flexDirection: 'row', gap: 8, marginTop: 24 },
  introDot: { width: 7, height: 7, borderRadius: 4, backgroundColor: CORAL },
  introFooter: {
    position: 'absolute',
    bottom: 40,
    color: ON_SURFACE_VARIANT,
    fontFamily: 'monospace',
    fontSize: 12,
    letterSpacing: 1,
  },
  clearTasksButton: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-end',
    gap: 6,
    paddingVertical: 8,
    paddingHorizontal: 12,
    marginBottom: 8,
  },
  clearTasksButtonText: { color: ON_SURFACE_VARIANT, fontSize: 12, fontWeight: '600' },
  taskRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    backgroundColor: 'rgba(255,255,255,0.04)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.08)',
    borderRadius: 16,
    padding: 14,
    marginBottom: 10,
  },
  taskStatusIconDone: {
    width: 26,
    height: 26,
    borderRadius: 13,
    backgroundColor: TEAL,
    alignItems: 'center',
    justifyContent: 'center',
  },
  taskStatusIconBusy: {
    width: 26,
    height: 26,
    borderRadius: 13,
    backgroundColor: 'rgba(232,130,90,0.14)',
    borderWidth: 1,
    borderColor: 'rgba(232,130,90,0.35)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  taskRowTitle: { color: ON_SURFACE, fontSize: 14, fontWeight: '600' },
  taskRowStatus: { color: ON_SURFACE_VARIANT, fontSize: 12, marginTop: 2 },
  taskBackButton: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-start',
    gap: 4,
    marginBottom: 20,
  },
  taskBackButtonText: { color: ON_SURFACE_VARIANT, fontSize: 13, fontWeight: '600' },
  taskBigStatusDone: {
    width: 76,
    height: 76,
    borderRadius: 38,
    backgroundColor: TEAL,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 18,
  },
  taskBigStatusBusy: {
    width: 76,
    height: 76,
    borderRadius: 38,
    backgroundColor: 'rgba(232,130,90,0.14)',
    borderWidth: 1,
    borderColor: 'rgba(232,130,90,0.35)',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 18,
  },
  taskBigTitle: { color: ON_SURFACE, fontSize: 22, fontWeight: '700', textAlign: 'center' },
  taskBigSubtitle: {
    color: ON_SURFACE_VARIANT,
    fontSize: 14,
    textAlign: 'center',
    marginTop: 8,
    marginBottom: 20,
  },
  taskResultCard: {
    width: '100%',
    backgroundColor: 'rgba(255,255,255,0.05)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.08)',
    borderRadius: 16,
    padding: 16,
    marginBottom: 20,
  },
  taskResultText: { color: ON_SURFACE, fontSize: 14, lineHeight: 21, marginTop: 6 },
  taskSecondaryButton: { paddingVertical: 14, alignItems: 'center', marginTop: 4 },
  taskSecondaryButtonText: { color: ON_SURFACE_VARIANT, fontWeight: '600', fontSize: 15 },
  warnBox: {
    flexDirection: 'row',
    gap: 8,
    alignItems: 'flex-start',
    borderWidth: 1,
    borderColor: 'rgba(255,180,171,0.3)',
    backgroundColor: 'rgba(255,180,171,0.08)',
    borderRadius: 12,
    padding: 10,
    marginTop: 12,
  },
  warnBoxText: { flex: 1, color: '#FFB4AB', fontSize: 11, lineHeight: 16 },
  errorText: { color: '#FFB4AB', fontSize: 12, fontWeight: '600', marginTop: 12 },
  logoutButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    borderWidth: 1,
    borderColor: 'rgba(255,180,171,0.3)',
    backgroundColor: 'rgba(255,180,171,0.06)',
    borderRadius: 16,
    paddingVertical: 14,
  },
  logoutButtonText: { color: '#FFB4AB', fontWeight: '700', fontSize: 15 },
  logoutHint: {
    color: ON_SURFACE_VARIANT,
    fontFamily: 'monospace',
    fontSize: 11,
    textAlign: 'center',
    marginTop: 10,
  },
});
