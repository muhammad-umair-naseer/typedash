'use strict';

/**
 * Ghost replays. A ghost is the progress timeline of a real run —
 * [[msSinceGo, correctChars], ...] — that the browser plays back as a
 * translucent car, so a solo visitor can race the world record on a passage
 * (or their own best) instead of a fixed-speed pacer. Playback is entirely
 * client-side; the server only stores timelines and hands them out.
 *
 * Kept on disk:
 *   wr[passageId]            the fastest verified run on each passage
 *   pb[accountId][passageId] each account's best, capped at PB_PASSAGES
 *                            passages (least recently set is dropped) and
 *                            downsampled, so the store stays small.
 */
const WR_SAMPLES = 400;
const PB_SAMPLES = 120;
const PB_PASSAGES = 8;

/** Downsample a [[t,c],...] timeline to at most `max` points, always keeping the first and last. */
function thin(timeline, max) {
  if (!Array.isArray(timeline)) return [];
  const src = timeline.map(([t, c]) => [t | 0, c | 0]);
  if (src.length <= max) return src;
  const out = [];
  const step = (src.length - 1) / (max - 1);
  for (let i = 0; i < max; i++) out.push(src[Math.round(i * step)]);
  return out;
}

class Ghosts {
  constructor(store) {
    this.store = store;
    this.data = store.data.ghosts || (store.data.ghosts = { wr: {}, pb: {} });
    this.data.wr ||= {};
    this.data.pb ||= {};
  }

  ghost(acc, r, max) {
    return {
      accountId: acc.id, name: acc.name, country: acc.country, skin: acc.skin,
      wpm: r.wpm, accuracy: r.accuracy, time: r.time, at: Date.now(), timeline: thin(r.timeline, max),
    };
  }

  /**
   * Offer a verified, finished run with a timeline. Returns what it changed
   * and what stood before, so callers can tell "beat the record" from
   * "set the record": { wr, pb, prevWr, prevPb }.
   */
  consider(acc, r) {
    const out = { wr: false, pb: false, prevWr: null, prevPb: null };
    if (!acc || !r || !r.finished || !r.verified || !Array.isArray(r.timeline) || r.timeline.length < 2 || !(r.wpm > 0)) return out;
    const id = r.passageId;
    const prevWr = this.data.wr[id] || null;
    const mine = (this.data.pb[acc.id] ||= {});
    const prevPb = mine[id] || null;
    out.prevWr = prevWr ? { name: prevWr.name, wpm: prevWr.wpm, accountId: prevWr.accountId } : null;
    out.prevPb = prevPb ? { wpm: prevPb.wpm } : null;

    if (!prevPb || r.wpm > prevPb.wpm) {
      mine[id] = this.ghost(acc, r, PB_SAMPLES);
      out.pb = true;
      const ids = Object.keys(mine);
      if (ids.length > PB_PASSAGES) {
        ids.sort((a, b) => mine[a].at - mine[b].at);
        delete mine[ids[0]];
      }
    }
    if (!prevWr || r.wpm > prevWr.wpm) {
      this.data.wr[id] = this.ghost(acc, r, WR_SAMPLES);
      out.wr = true;
    }
    if (out.pb || out.wr) this.store.touch();
    return out;
  }

  wr(passageId) { return this.data.wr[passageId] || null; }
  pb(accountId, passageId) { return (this.data.pb[accountId] || {})[passageId] || null; }

  /** Public view of a ghost for /api/ghost (no account id). */
  pub(g, meId = null) {
    if (!g) return null;
    return { name: g.name, country: g.country, skin: g.skin, wpm: g.wpm, accuracy: g.accuracy, time: g.time, at: g.at, mine: !!meId && g.accountId === meId, timeline: g.timeline };
  }

  /** Every world record, fastest first (for the records / practice pages). */
  records() {
    return Object.entries(this.data.wr)
      .map(([passageId, g]) => ({ passageId, name: g.name, country: g.country, skin: g.skin, wpm: g.wpm, accuracy: g.accuracy, time: g.time, at: g.at }))
      .sort((a, b) => b.wpm - a.wpm);
  }
}

module.exports = { Ghosts, thin, WR_SAMPLES, PB_SAMPLES, PB_PASSAGES };
