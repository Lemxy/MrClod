import { createContext, useContext, useEffect, useMemo, useState } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';

const STORAGE_KEY = 'mrclod-lang';

const dict = {
  en: {
    thinking: 'MrClod is thinking…',
    allowTool: (name) => `Allow ${name}?`,
    allow: 'Allow',
    deny: 'Deny',
    emptyChat: 'Type something to get started',
    modelSonnet: 'balanced, for most tasks',
    modelOpus: 'most powerful, for hard tasks',
    modelHaiku: 'fastest and cheapest',
    modelFable: 'for creative tasks',
    effortLow: 'faster, less reasoning',
    effortMedium: 'balance of speed and quality',
    effortHigh: 'thinks deeper, slower replies',
    effortXhigh: 'max reasoning for hard tasks',
    effortMax: 'maximum effort, slowest',
    permAskInfo: 'normal Claude Code rules. WARNING: confirmations don\'t reach the phone — Bash runs anyway',
    permSkipInfo: '--dangerously-skip-permissions: removes every check. Trusted networks only',
    readyTitle: 'Ready to code from the couch?',
    readySubtitle: 'Connecting to Claude Code on your desktop…',
    pairingTitle: 'Ready to code from the couch?',
    pairingSubtitle: 'Connect to Claude Code on your desktop',
    ipLabel: 'IP or wss:// tunnel',
    ipPlaceholder: '192.168.1.10 or wss://xxx.trycloudflare.com',
    portLabel: 'Port',
    tokenLabel: 'Token',
    tokenPlaceholder: 'from the pairing window on desktop',
    pairingHint: 'Token and IP are shown in MrClod on your computer — open pairing there and enter them here',
    warnBoxText: 'Messages are encrypted with the token (AES-256-GCM), but the transport itself is plain ws:// with no TLS certificate. Home Wi-Fi only. Off it — use Tailscale or a wss:// address.',
    connect: 'Connect',
    scanQr: 'Scan QR from desktop',
    footer: '$ MrClod v1.0',
    ipRequired: 'Enter the IP or tunnel address',
    portInvalid: 'Port must be a number from 1 to 65535',
    tokenRequired: 'Enter the token from the pairing window on desktop',
    qrNotRecognized: 'QR code not recognized',
    connected: 'Connected',
    reconnecting: 'Reconnecting…',
    composerPlaceholder: 'Message Claude Code...',
    clear: 'Clear',
    noTasks: 'No tasks yet',
    taskDone: 'Done',
    taskInProgress: 'In progress…',
    allTasks: 'All tasks',
    taskCompletedTitle: 'Task completed',
    taskInProgressTitle: 'Task in progress',
    taskCompletedBody: 'All changes were successfully applied to your project.',
    taskInProgressBody: 'MrClod is working on the request, a report will appear when it\'s done.',
    request: 'Request',
    result: 'Result',
    replyNewRequest: 'Reply / new request',
    viewInChat: 'View in chat',
    chats: 'Chats',
    newChat: 'New chat',
    newChatPlaceholder: 'New chat name',
    create: 'Create',
    session: 'Session',
    logout: 'Log out',
    model: 'Model',
    permissions: 'Permissions',
    language: 'Language',
    deleteChatTitle: 'Delete chat?',
    deleteChatSubtitle: (title) => `"${title}" and all its history will be permanently deleted.`,
    delete: 'Delete',
    logoutTitle: 'Log out?',
    logoutSubtitle: 'The app will disconnect from the desktop and forget the token. To come back, re-enter it from the pairing window.',
    cancel: 'Cancel',
    noConnectionQueued: 'No connection — the message will be sent once reconnected',
    noConnectionRetry: 'No connection — try again later',
    waitingForYou: 'Waiting for your reply',
    askingPermission: (tool) => `Asking permission: ${tool}`,
    permAsk: 'Ask permission',
    permSkip: 'Allow and don\'t ask',
  },
  ru: {
    thinking: 'MrClod думает…',
    allowTool: (name) => `Разрешить ${name}?`,
    allow: 'Разрешить',
    deny: 'Запретить',
    emptyChat: 'Напишите что-нибудь, чтобы начать',
    modelSonnet: 'сбалансированная, для большинства задач',
    modelOpus: 'самая мощная, для сложных задач',
    modelHaiku: 'самая быстрая и дешёвая',
    modelFable: 'для творческих задач',
    effortLow: 'быстрее, меньше рассуждений',
    effortMedium: 'баланс скорости и качества',
    effortHigh: 'глубже думает, дольше отвечает',
    effortXhigh: 'максимум рассуждений для сложных задач',
    effortMax: 'предел усилий, самое медленное',
    permAskInfo: 'обычные правила Claude Code. ВНИМАНИЕ: подтверждения не приходят на телефон — Bash всё равно выполнится',
    permSkipInfo: '--dangerously-skip-permissions: снимает вообще все проверки. Только для доверенной сети',
    readyTitle: 'Готовы кодить с дивана?',
    readySubtitle: 'Подключаемся к Claude Code на десктопе…',
    pairingTitle: 'Готовы кодить с дивана?',
    pairingSubtitle: 'Подключитесь к Claude Code на десктопе',
    ipLabel: 'IP или wss://тоннель',
    ipPlaceholder: '192.168.1.10 или wss://xxx.trycloudflare.com',
    portLabel: 'Порт',
    tokenLabel: 'Токен',
    tokenPlaceholder: 'из окна пейринга на десктопе',
    pairingHint: 'Токен и IP показаны в MrClod на компьютере — открой пейринг там и введи сюда',
    warnBoxText: 'Сообщения шифруются токеном (AES-256-GCM), но сам транспорт — обычный ws:// без TLS-сертификата. Только для домашней Wi-Fi. Вне её — Tailscale или адрес wss://',
    connect: 'Подключиться',
    scanQr: 'Сканировать QR с десктопа',
    footer: '$ MrClod v1.0',
    ipRequired: 'Введите IP или адрес тоннеля',
    portInvalid: 'Порт должен быть числом от 1 до 65535',
    tokenRequired: 'Введите токен из окна пейринга на десктопе',
    qrNotRecognized: 'QR-код не распознан',
    connected: 'Подключено',
    reconnecting: 'Переподключение…',
    composerPlaceholder: 'Написать Claude Code...',
    clear: 'Очистить',
    noTasks: 'Задач пока нет',
    taskDone: 'Выполнено',
    taskInProgress: 'В работе…',
    allTasks: 'Все задачи',
    taskCompletedTitle: 'Задача выполнена',
    taskInProgressTitle: 'Задача выполняется',
    taskCompletedBody: 'Все изменения успешно применены к вашему проекту.',
    taskInProgressBody: 'MrClod работает над запросом, отчёт появится по завершении.',
    request: 'Запрос',
    result: 'Результат',
    replyNewRequest: 'Ответить / новый запрос',
    viewInChat: 'Посмотреть в чате',
    chats: 'Чаты',
    newChat: 'Новый чат',
    newChatPlaceholder: 'Название нового чата',
    create: 'Создать',
    session: 'Сессия',
    logout: 'Выйти из сессии',
    model: 'Модель',
    permissions: 'Разрешения',
    language: 'Язык',
    deleteChatTitle: 'Удалить чат?',
    deleteChatSubtitle: (title) => `«${title}» и вся его история будут удалены безвозвратно.`,
    delete: 'Удалить',
    logoutTitle: 'Выйти из сессии?',
    logoutSubtitle: 'Приложение отключится от десктопа и забудет токен. Чтобы вернуться, введите его заново из окна пейринга.',
    cancel: 'Отмена',
    noConnectionQueued: 'Нет связи — сообщение отправится при переподключении',
    noConnectionRetry: 'Нет связи — попробуйте позже',
    waitingForYou: 'Ждёт вашего ответа',
    askingPermission: (tool) => `Просит разрешение: ${tool}`,
    permAsk: 'Спрашивать разрешение',
    permSkip: 'Разрешить и не спрашивать',
  },
};

const LanguageContext = createContext(null);

export function LanguageProvider({ children }) {
  const [lang, setLangState] = useState('en');

  useEffect(() => {
    AsyncStorage.getItem(STORAGE_KEY).then((saved) => {
      if (saved === 'en' || saved === 'ru') setLangState(saved);
    });
  }, []);

  function setLang(next) {
    setLangState(next);
    AsyncStorage.setItem(STORAGE_KEY, next).catch(() => {});
  }

  const value = useMemo(() => {
    const t = (key, ...args) => {
      const entry = dict[lang][key] ?? dict.en[key];
      return typeof entry === 'function' ? entry(...args) : entry;
    };
    return { lang, setLang, t };
  }, [lang]);

  return <LanguageContext.Provider value={value}>{children}</LanguageContext.Provider>;
}

export function useLang() {
  const ctx = useContext(LanguageContext);
  if (!ctx) throw new Error('useLang must be used within LanguageProvider');
  return ctx;
}
