import path from 'node:path';
import { DATA, readJson, writeJson, pause, log, today } from '../util.js';
import { decide } from '../llm.js';
import { retrieve } from './style.js';
import { buildSystemPrompt, buildUserPrompt, DECISION_TOOL, evaluateDecision } from './decision.js';
import { alertOwner } from '../notify.js';
import * as dom from './dom.js';

const STATE_FILE = () => path.join(DATA, 'state', 'whatsapp.json');

function inActiveHours(cfg, date = new Date()) {
  const ah = cfg.whatsapp.active_hours;
  if (!ah) return true;
  const hhmm = new Intl.DateTimeFormat('en-GB', { timeZone: cfg.timezone, hour: '2-digit', minute: '2-digit', hour12: false }).format(date);
  return ah.from <= ah.to ? hhmm >= ah.from && hhmm <= ah.to : hhmm >= ah.from || hhmm <= ah.to;
}

export class WhatsAppResponder {
  /**
   * @param {object} o  cfg, llm, page, kb (text), styleGuide (text), stats, index (retrieval index)
   */
  constructor(o) {
    Object.assign(this, o);
    this.state = readJson(STATE_FILE(), { handled: {}, sentAt: [], day: { date: today(), count: 0 } });
    this.system = buildSystemPrompt({ cfg: this.cfg, kb: this.kb, styleGuide: this.styleGuide, stats: this.stats });
  }

  save() { writeJson(STATE_FILE(), this.state); }

  rateLimited() {
    const w = this.cfg.whatsapp;
    const now = Date.now();
    this.state.sentAt = this.state.sentAt.filter((t) => now - t < 3600e3);
    if (this.state.day.date !== today()) this.state.day = { date: today(), count: 0 };
    return this.state.sentAt.length >= w.max_auto_replies_per_hour || this.state.day.count >= w.max_auto_replies_per_day;
  }

  allowed(title) {
    const w = this.cfg.whatsapp, t = title.toLowerCase();
    if (w.deny_chats.some((d) => t.includes(d.toLowerCase()))) return false;
    if (w.allow_chats.length) return w.allow_chats.some((a) => t.includes(a.toLowerCase()));
    return true;
  }

  /** One sweep over the sidebar. Returns a list of outcomes (useful for tests/logging). */
  async pass() {
    const { cfg } = this;
    if (cfg.mode === 'off' || !inActiveHours(cfg)) return [];
    const chats = await dom.listChats(this.page);
    if (!chats) { log('WhatsApp sidebar not found - is the QR code still waiting to be scanned?'); return []; }
    const todo = chats.filter((c) => c.unread > 0 && c.title && this.allowed(c.title)).slice(0, cfg.whatsapp.max_chats_per_pass);
    const outcomes = [];
    for (const c of todo) {
      try {
        outcomes.push(await this.handleChat(c));
      } catch (e) {
        log(`error in chat "${c.title}": ${e.message}`);
        outcomes.push({ chat: c.title, outcome: 'error', reason: e.message });
      }
      await pause([2, 6]);
    }
    return outcomes;
  }

  async handleChat(row) {
    const { cfg, page } = this;
    await dom.openChat(page, row.title);
    await pause([1, 2.5]);
    const chat = await dom.readChat(page);
    const done = async (outcome, reason = '') => { await dom.closeChat(page).catch(() => {}); return { chat: row.title, outcome, reason }; };
    if (!chat || !chat.messages.length) return done('skipped', 'no messages visible');
    if (cfg.whatsapp.skip_groups && chat.isGroup) return done('skipped', 'group chat');
    if (chat.composerText) return done('skipped', 'you are typing in this chat'); // never overwrite the owner's own text

    const msgs = chat.messages;
    const last = msgs.at(-1);
    if (last.out) return done('skipped', 'last message is yours');
    if (this.state.handled[row.title] === last.id) return done('skipped', 'already handled');

    let firstNew = msgs.length;
    while (firstNew > 0 && !msgs[firstNew - 1].out) firstNew--;
    const newMessages = msgs.slice(firstNew);
    const history = msgs.slice(Math.max(0, firstNew - cfg.whatsapp.context_messages), firstNew);
    const guestText = newMessages.map((m) => m.text).filter(Boolean).join('\n');
    const ownerText = msgs.filter((m) => m.out).map((m) => m.text).join('\n'); // prices Abdul already quoted in this chat
    const mark = () => { this.state.handled[row.title] = last.id; this.save(); };

    let verdict;
    if (!guestText) {
      verdict = { action: 'escalate', reason: 'guest sent a voice note / image / file only' };
    } else {
      const examples = this.index ? retrieve(this.index, guestText, cfg.whatsapp.examples) : [];
      const user = buildUserPrompt({
        chatTitle: row.title, history, newMessages, examples,
        isNewChat: !history.some((m) => m.out) && history.length === 0,
        nowText: new Intl.DateTimeFormat('en-GB', { timeZone: cfg.timezone, dateStyle: 'full', timeStyle: 'short' }).format(new Date()),
      });
      const result = await decide(this.llm, { system: this.system, user, tool: DECISION_TOOL });
      verdict = evaluateDecision(result, { cfg, kb: this.kb, guestText, ownerText, mode: cfg.mode });
    }

    if (verdict.action === 'send' && this.rateLimited()) verdict = { ...verdict, action: 'draft', reason: 'hourly/daily auto-reply limit reached' };

    switch (verdict.action) {
      case 'ignore':
        mark();
        log(`[${row.title}] ignored: ${verdict.reason}`);
        return done('ignored', verdict.reason);
      case 'escalate': {
        if (verdict.draft) await dom.typeInComposer(page, verdict.draft, null); // leave a suggestion in the box, never sent
        mark();
        await alertOwner({ title: `Needs you: ${row.title}`, body: `${verdict.reason}\nGuest said: ${guestText.slice(0, 300) || '(media)'}${verdict.draft ? `\nSuggested reply (left in the chat box, NOT sent): ${verdict.draft}` : ''}` });
        return done('escalated', verdict.reason);
      }
      case 'draft':
        await dom.typeInComposer(page, verdict.reply, null);
        mark();
        log(`[${row.title}] draft left in chat box (${verdict.reason})`);
        return done('drafted', verdict.reason);
      case 'send': {
        await pause(cfg.whatsapp.reply_delay_seconds);
        await dom.typeInComposer(page, verdict.reply, cfg.whatsapp.typing_ms_per_char);
        await pause([0.5, 1.5]);
        await dom.pressSend(page);
        await pause([1, 2]);
        mark();
        this.state.sentAt.push(Date.now());
        this.state.day.count += 1;
        this.save();
        log(`[${row.title}] SENT: ${verdict.reply.slice(0, 80).replace(/\n/g, ' ')}`);
        return done('sent', verdict.reason);
      }
      default:
        return done('skipped', 'unknown verdict');
    }
  }
}
