/**
 * The "game feel" layer on top of the typing race: combos, nitro, score and
 * golden words. Runs entirely on the client so feedback is instant; the server
 * only sanity-clamps the reported numbers (progress and ranking never depend
 * on any of this).
 *
 * Rules
 *  - Every correct keystroke adds to the combo; a wrong one resets it.
 *  - Combo tiers (10/25/50/100) raise the score multiplier and trigger a pop.
 *  - Nitro meter fills with flawless words. When full, nitro fires for
 *    NITRO_MS: x2 score, flames on your car, everyone in the lobby sees it.
 *  - Golden words (chosen by the server) pay a big bonus when typed flawlessly.
 */
export const NITRO_MS = 3200;
export const NITRO_WORDS = 5;   // flawless words to fill the meter

export const COMBO_TIERS = [
  { at: 10,  label: '10 words in a row',  mult: 1.25 },
  { at: 25,  label: '25 in a row — nice',  mult: 1.5 },
  { at: 50,  label: '50 in a row — double points', mult: 2 },
  { at: 100, label: '100 in a row — triple points', mult: 3 },
];

export class RaceGame {
  constructor() { this.reset(); }

  reset() {
    this.combo = 0;
    this.bestCombo = 0;
    this.score = 0;
    this.meter = 0;          // 0..1
    this.nitroUntil = 0;
    this.nitros = 0;
    this.golden = 0;
    this.goldenTotal = 0;
    this.bonus = new Set();
    this.tier = 0;
    this.words = 0;
    this.flawlessWords = 0;
  }

  start(bonusWords = []) {
    this.reset();
    this.bonus = new Set(bonusWords);
    this.goldenTotal = this.bonus.size;
  }

  get nitro() { return performance.now() < this.nitroUntil; }

  /** Fraction of the current nitro burst remaining (1 → 0), or 0. */
  get nitroLeft() {
    const left = this.nitroUntil - performance.now();
    return left > 0 ? left / NITRO_MS : 0;
  }

  get multiplier() {
    let m = 1;
    for (const t of COMBO_TIERS) if (this.combo >= t.at) m = t.mult;
    return m * (this.nitro ? 2 : 1);
  }

  /**
   * Feed a keystroke result from TypingArea. Returns a list of events for the
   * UI: {type:'combo', label}, {type:'nitro'}, {type:'golden', word}, {type:'word'}.
   */
  onKey({ ok, added, wordDone }) {
    const events = [];
    if (!added) return events;

    if (ok) {
      this.combo += 1;
      this.bestCombo = Math.max(this.bestCombo, this.combo);
      this.score += Math.round(10 * this.multiplier);
      const tierIdx = COMBO_TIERS.reduce((acc, t, i) => (this.combo >= t.at ? i + 1 : acc), 0);
      if (tierIdx > this.tier) {
        this.tier = tierIdx;
        events.push({ type: 'combo', label: COMBO_TIERS[tierIdx - 1].label, tier: tierIdx });
      }
    } else {
      if (this.combo >= 10) events.push({ type: 'combo_break', combo: this.combo });
      this.combo = 0;
      this.tier = 0;
      this.meter = Math.max(0, this.meter - 1 / (NITRO_WORDS * 2)); // a typo costs half a word of charge
    }

    if (wordDone) {
      this.words += 1;
      if (wordDone.flawless) {
        this.flawlessWords += 1;
        this.score += 40;
        events.push({ type: 'word', index: wordDone.index });
        if (this.bonus.has(wordDone.index)) {
          this.golden += 1;
          this.score += 250;
          events.push({ type: 'golden', index: wordDone.index });
        }
        if (!this.nitro) {
          this.meter = Math.min(1, this.meter + 1 / NITRO_WORDS);
          if (this.meter >= 1) {
            this.meter = 0;
            this.nitroUntil = performance.now() + NITRO_MS;
            this.nitros += 1;
            events.push({ type: 'nitro' });
          }
        }
      } else if (this.bonus.has(wordDone.index)) {
        events.push({ type: 'golden_miss', index: wordDone.index });
      }
    }
    return events;
  }

  /** Finish bonus, applied once when the server confirms the finish. */
  finish(rank, accuracy, errors = null) {
    const place = rank === 1 ? 1000 : rank === 2 ? 600 : rank === 3 ? 400 : 200;
    const flawless = errors != null ? errors === 0 : accuracy >= 100;
    const clean = flawless ? 500 : accuracy >= 98 ? 200 : 0;
    this.score += place + clean;
    this.nitroUntil = 0;
    return { place, clean };
  }
}
