import { createContext, useContext, useMemo, useState } from 'react';

const STORAGE_KEY = 'mrclod-lang';

const dict = {
  en: {
    thinking: 'Thinking',
    permissionRequest: 'Permission Request',
    allow: 'Allow',
    deny: 'Deny',
    modelSonnet: 'balanced, for most tasks',
    modelOpus: 'most powerful, for hard tasks',
    modelHaiku: 'fastest and cheapest',
    modelFable: 'for creative tasks',
    effortLow: 'faster, less reasoning',
    effortMedium: 'balance of speed and quality',
    effortHigh: 'thinks deeper, slower replies',
    effortXhigh: 'max reasoning for hard tasks',
    effortMax: 'maximum effort, slowest',
    permAsk: 'Ask',
    permSkip: 'Allow all',
    permAskInfo: 'Claude Code confirms before risky actions — safer default',
    permSkipInfo: 'full access with no confirmations — Bash/Write/Edit run immediately',
    newChat: 'New chat',
    chatName: 'Chat name',
    recent: 'Recent',
    deleteChat: (title) => `Delete chat ${title}`,
    chats: 'Chats',
    pairing: 'Pairing',
    pairingQrAlt: 'Pairing QR',
    pairingToken: 'Pairing token',
    regenerateToken: 'Generate new',
    saved: 'Saved',
    tokenHint: 'Your own token or ⟳ for a new one — enter the same on the phone',
    availableOnline: 'Available from the internet',
    connectingTunnel: 'Connecting tunnel…',
    emptyState: 'Type something to get started',
    composerPlaceholder: 'Type here...',
    composerAria: 'Message to Claude Code',
    internetNoticeTitle: 'MrClod is now reachable from the internet',
    internetNoticeBody: 'By default the app opens a free tunnel (Cloudflare) so your phone can connect even off the home network. Access is protected only by the pairing token — never share the QR code or forward the token. You can disable the tunnel by editing the config manually (a proper toggle in the UI isn\'t built yet).',
    gotIt: 'Got it',
    skipTitle: 'Allow skip permissions?',
    skipBody: 'The phone is asking to enable no-confirmation mode for one of the chats. In this mode Claude Code can run Bash/Write/Edit on this machine without a single prompt. Only enable if you understand what you\'re doing.',
    decline: 'Decline',
    language: 'Language',
  },
  ru: {
    thinking: 'Думает',
    permissionRequest: 'Permission Request',
    allow: 'Разрешить',
    deny: 'Запретить',
    modelSonnet: 'сбалансированная, для большинства задач',
    modelOpus: 'самая мощная, для сложных задач',
    modelHaiku: 'самая быстрая и дешёвая',
    modelFable: 'для творческих задач',
    effortLow: 'быстрее, меньше рассуждений',
    effortMedium: 'баланс скорости и качества',
    effortHigh: 'глубже думает, дольше отвечает',
    effortXhigh: 'максимум рассуждений для сложных задач',
    effortMax: 'предел усилий, самое медленное',
    permAsk: 'Спрашивать',
    permSkip: 'Разрешить всё',
    permAskInfo: 'Claude Code уточняет перед опасными действиями — безопаснее по умолчанию',
    permSkipInfo: 'полный доступ без подтверждений — Bash/Write/Edit выполняются сразу',
    newChat: 'Новый чат',
    chatName: 'Название чата',
    recent: 'Недавние',
    deleteChat: (title) => `Удалить чат ${title}`,
    chats: 'Чаты',
    pairing: 'Пейринг',
    pairingQrAlt: 'QR для пейринга',
    pairingToken: 'Токен пейринга',
    regenerateToken: 'Сгенерировать новый',
    saved: 'Сохранено',
    tokenHint: 'Свой токен или ⟳ для нового — введи так же на телефоне',
    availableOnline: 'Доступно из интернета',
    connectingTunnel: 'Подключаю туннель…',
    emptyState: 'Напишите что-нибудь, чтобы начать',
    composerPlaceholder: 'Пиши сюда...',
    composerAria: 'Сообщение для Claude Code',
    internetNoticeTitle: 'MrClod теперь доступен из интернета',
    internetNoticeBody: 'По умолчанию приложение поднимает бесплатный туннель (Cloudflare), чтобы телефон мог подключиться и вне домашней сети. Доступ защищён только токеном пейринга — никому не показывай QR-код и не пересылай токен. Отключить туннель можно, отредактировав конфигурацию вручную (полноценный тумблер в UI пока не сделан).',
    gotIt: 'Понятно',
    skipTitle: 'Разрешить skip permissions?',
    skipBody: 'Телефон просит включить режим без подтверждений для одного из чатов. В этом режиме Claude Code сможет выполнять Bash/Write/Edit на этом компьютере без единого запроса. Включайте только если понимаете, что делаете.',
    decline: 'Отклонить',
    language: 'Язык',
  },
};

const LanguageContext = createContext(null);

function detectDefault() {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved === 'en' || saved === 'ru') return saved;
  } catch {}
  return 'en';
}

export function LanguageProvider({ children }) {
  const [lang, setLangState] = useState(detectDefault);

  function setLang(next) {
    setLangState(next);
    try {
      localStorage.setItem(STORAGE_KEY, next);
    } catch {}
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
