import crypto from 'node:crypto';
import { log } from '../util.js';
import { alertOwner } from '../notify.js';

/**
 * Shared live state of the desktop assistant: is it on, what is it doing, does it wait for you.
 * The control panel and the agent loop both talk to this one object.
 */
export class Control {
  constructor({ approvalTimeoutMs = 20 * 60 * 1000 } = {}) {
    this.enabled = true;        // master switch: when off, no task is started
    this.stopFlag = false;      // set by STOP or the corner failsafe; ends the current run
    this.stopReason = '';
    this.pauseInfo = null;      // { reason, at } while waiting for you to press Continue
    this.status = 'idle';       // idle | running | paused | waiting_approval
    this.current = null;        // { text, runId, step }
    this.shotPath = null;
    this.logLines = [];
    this.pending = null;        // approval waiting for you
    this.approvalTimeoutMs = approvalTimeoutMs;
    this._pauseResolve = null;
    this._approvalResolve = null;
  }

  say(line) {
    this.logLines.push({ t: new Date().toISOString().slice(11, 19), line });
    if (this.logLines.length > 300) this.logLines.shift();
    log(`[desktop] ${line}`);
  }

  /** Emergency stop: ends the run, denies any waiting approval and switches the assistant OFF. */
  stop(reason = 'Stopped by owner') {
    this.stopFlag = true; this.stopReason = reason; this.enabled = false;
    this.say(`STOP: ${reason}`);
    this._pauseResolve?.(); this._pauseResolve = null;
    this.resolveApproval(this.pending?.id, false);
  }
  clearStop() { this.stopFlag = false; this.stopReason = ''; }

  pause(reason) {
    this.pauseInfo = { reason, at: new Date().toISOString() };
    this.status = 'paused';
    this.say(`PAUSED: ${reason}`);
    alertOwner({ title: 'Assistant paused', body: reason }).catch(() => {});
    return new Promise((resolve) => { this._pauseResolve = resolve; });
  }
  resume() {
    if (!this.pauseInfo) return;
    this.pauseInfo = null; this.status = 'running';
    this.say('Resumed by owner');
    this._pauseResolve?.(); this._pauseResolve = null;
  }

  /** Ask the owner. Resolves { ok, text? }. No answer within the timeout counts as NO. */
  requestApproval({ kind, what, text = '', window = '' }) {
    if (this.stopFlag) return Promise.resolve({ ok: false });
    const id = crypto.randomUUID().slice(0, 8);
    this.pending = { id, kind, what, text, window, at: new Date().toISOString() };
    this.status = 'waiting_approval';
    this.say(`APPROVAL NEEDED (${kind}): ${what}`);
    alertOwner({ title: 'Assistant needs your approval', body: `${what}${text ? `\n"${text.slice(0, 200)}"` : ''}\nOpen the control panel to approve or decline.` }).catch(() => {});
    return new Promise((resolve) => {
      const timer = setTimeout(() => this.resolveApproval(id, false), this.approvalTimeoutMs);
      this._approvalResolve = (r) => { clearTimeout(timer); resolve(r); };
    });
  }
  resolveApproval(id, ok, text) {
    if (!this.pending || this.pending.id !== id) return false;
    const done = this._approvalResolve;
    this.pending = null; this._approvalResolve = null;
    if (this.status === 'waiting_approval') this.status = 'running';
    this.say(ok ? 'Owner APPROVED' : 'Owner DECLINED');
    done?.({ ok: !!ok, text: text || undefined });
    return true;
  }
}
