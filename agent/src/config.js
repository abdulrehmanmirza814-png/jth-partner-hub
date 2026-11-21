import path from 'node:path';
import { CONFIG_DIR, readJson, deepMerge } from './util.js';

export const DEFAULTS = {
  // off   = do nothing
  // draft = write the reply into the WhatsApp box but DO NOT press send (you review & press Enter)
  // auto  = send automatically (only for safe categories; risky ones are escalated to you)
  mode: 'draft',
  owner_name: '', // your name exactly as it appears in exported chats, e.g. "Abdul Rehman"
  timezone: 'Asia/Dubai',
  llm: { model: 'claude-opus-5-5', effort: 'medium', fallbacks: true, max_tokens: 3000 },
  whatsapp: {
    enabled: true,
    url: 'https://web.whatsapp.com',
    poll_seconds: [20, 40],
    reply_delay_seconds: [6, 18],
    typing_ms_per_char: [20, 55],
    max_chats_per_pass: 5,
    skip_groups: true,
    allow_chats: [], // if non-empty, ONLY these chat names are handled
    deny_chats: [], // never touch these chats (family, friends, suppliers...)
    max_auto_replies_per_hour: 30,
    max_auto_replies_per_day: 250,
    active_hours: null, // null = 24/7, or e.g. {"from":"08:00","to":"23:30"}
    context_messages: 25,
    examples: 6,
    auto_send_categories: ['greeting', 'inquiry', 'quote', 'booking', 'change', 'other'],
    always_escalate_keywords: [
      'refund', 'complain', 'complaint', 'scam', 'fraud', 'police', 'lawyer', 'legal action',
      'chargeback', 'compensation', 'unacceptable', 'terrible', 'worst', 'injur', 'accident', 'hospital',
      'iban', 'account number', 'bank transfer', 'swift', 'credit card', 'card number', 'passport',
    ],
    ai_disclosure: '', // optional text added to the FIRST reply in a new chat, e.g. "(Assistant to Abdul)"
  },
  tasks: { default_gap_seconds: [60, 150] },
  // The desktop assistant: sees the screen, moves the real mouse, types on the real keyboard.
  desktop: {
    enabled: true,
    // watch      = you approve every set of actions before it runs (best for the first days)
    // supervised = it asks before sending/posting/paying; you can step in any time (default)
    // auto       = no per-action questions (only the deny-list, corner stop and your mouse takeover remain)
    mode: 'supervised',
    max_steps: 80,
    max_minutes: 30,
    max_actions_per_turn: 5,
    settle_ms: 500,
    pause_on_user_input: true, // you touch the mouse -> it pauses
    takeover_px: 25,
    max_edge: 1568,
    max_megapixels: 1.15,
    deny_windows: ['1password', 'bitwarden', 'lastpass', 'keepass', 'keychain access', 'password', 'wallet', 'banking', 'paypal', 'authenticator', 'windows security', 'credential'],
    send_apps: ['whatsapp', 'gmail', 'mail', 'outlook', 'inbox', 'compose', 'facebook', 'instagram', 'messenger', 'telegram', 'linkedin', 'twitter', 'x.com', 'slack', 'discord', 'signal', 'teams', 'reddit', 'tiktok'],
  },
  panel: { port: 8787 },
  email: {
    mode: 'draft', // draft = replies are saved as Gmail drafts for you to send; auto = may send safe categories
    query: 'is:unread in:inbox newer_than:2d -category:promotions -category:social -category:forums',
    max_per_run: 15,
    check_every_minutes: 30,
    auto_send_categories: [],
    deny_senders: [],
  },
  briefing: { at: '08:00' },
  social: { platforms: ['facebook', 'instagram'], plan: null }, // plan example: {"at":"09:00","topic":"this week's offers","count":1}
  research: { sites: [] },
};

export function loadConfig() {
  const file = path.join(CONFIG_DIR, 'agent.config.json');
  const user = readJson(file, {});
  const cfg = deepMerge(DEFAULTS, user);
  if (process.env.AGENT_MODEL) cfg.llm.model = process.env.AGENT_MODEL;
  if (process.env.AGENT_MODE) cfg.mode = process.env.AGENT_MODE;
  if (process.env.OWNER_NAME) cfg.owner_name = process.env.OWNER_NAME;
  return cfg;
}
