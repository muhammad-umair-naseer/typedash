import { flag } from './countries.js';
import { escapeHtml } from './ui.js';

/**
 * Home-page strip for the Daily Challenge. Everything it shows comes from one
 * cached GET /api/daily; playing it is a practice run (solo.js) of today's
 * passage with today's golden words, so the run itself costs the server
 * nothing until the single result is submitted.
 */
const BOLT = '<svg class="i fill" aria-hidden="true"><use href="#i-bolt"/></svg>';

export class DailyCard {
  constructor(root, { onPlay, meId }) {
    this.root = root;
    this.onPlay = onPlay;
    this.meId = meId;
    this.data = null;
    this.render();
    root.addEventListener('click', (e) => {
      if (e.target.closest('#btn-daily') && this.data) this.onPlay(this.data);
    });
    setInterval(() => { if (this.data) this.render(); }, 60000); // keep the "resets in" text honest
  }

  async load() {
    try {
      const id = this.meId();
      const res = await fetch(`/api/daily${id ? `?me=${encodeURIComponent(id)}` : ''}`, { cache: 'no-store' });
      if (res.ok) this.data = await res.json();
    } catch (_) { /* offline: keep whatever we had */ }
    this.render();
    return this.data;
  }

  resetsIn() {
    const ms = Math.max(0, this.data.endsAt - Date.now());
    const h = Math.floor(ms / 3600000);
    const m = Math.floor((ms % 3600000) / 60000);
    return h > 0 ? `${h}h ${m}m` : `${m}m`;
  }

  render() {
    const d = this.data;
    if (!d) {
      this.root.innerHTML = `<div class="daily-head"><span class="daily-eyebrow">${BOLT} Today</span><b>Loading today's paragraph…</b></div>`;
      return;
    }
    const leader = d.top[0] || null;
    const me = d.me;
    const who = leader ? ` · best so far ${flag(leader.country)} ${escapeHtml(leader.name)} at ${leader.wpm} a min` : '';
    this.root.innerHTML = `
      <div class="daily-head">
        <span class="daily-eyebrow">${BOLT} Today</span>
        <b>#${d.number} · “${escapeHtml(d.passage.title)}”</b>
        <span class="daily-meta">${d.passage.words} words · ${d.players.toLocaleString()} have tried it · new one in ${this.resetsIn()}${who}</span>
      </div>
      <div class="daily-stats">
        ${me ? `<span class="daily-you">You: <b>${me.wpm} a min</b> · #${me.rank} of ${me.of}</span>` : '<span class="daily-you dim">Everyone gets the same one, and one proper go at it</span>'}
        <button class="btn small" id="btn-daily">${me ? 'Have another go' : 'Have a go'}</button>
      </div>`;
  }
}
