'use strict';
const Player = require('./Player');
const { randomId } = require('./util');

// name, country
const ROSTER = [
  ['Aria', 'US'], ['Kenji', 'JP'], ['Lucia', 'ES'], ['Omar', 'EG'], ['Sven', 'SE'],
  ['Priya', 'IN'], ['Mateo', 'BR'], ['Zara', 'PK'], ['Liam', 'AU'], ['Chloe', 'FR'],
  ['Yusuf', 'TR'], ['Hana', 'KR'], ['Diego', 'MX'], ['Fatima', 'SA'], ['Noah', 'CA'],
  ['Ingrid', 'DE'], ['Amara', 'NG'], ['Wei', 'CN'], ['Elena', 'IT'], ['Tariq', 'AE'],
  ['Sofia', 'AR'], ['Bao', 'VN'], ['Nadia', 'ID'], ['Finn', 'IE'], ['Ayesha', 'BD'],
  ['Marek', 'PL'], ['Thabo', 'ZA'], ['Mei', 'SG'], ['Rafael', 'PT'], ['Leila', 'MA'],
];

/**
 * A simulated typist. Progress is advanced on the server tick with a target
 * WPM, random speed bursts, a start-reaction delay and occasional "typo" pauses
 * so the movement looks human rather than linear.
 */
class Bot extends Player {
  constructor({ name, country, targetWpm }) {
    super({ id: 'bot_' + randomId(8), name, country, isBot: true });
    this.targetWpm = targetWpm;
    this.cps = (targetWpm * 5) / 60; // chars per second
    this.resetRace();
  }

  resetRace() {
    super.resetRace();
    this.frac = 0;
    this.pauseUntil = 0;
    this.burst = 1;
    this.reactionDelay = 250 + Math.random() * 800;
    this.accuracy = 92 + Math.round(Math.random() * 7);
    this.nitroUntil = 0;
    this.combo = 0;
    this.skin = ['dash', 'bolt', 'hatch', 'muscle', 'flame', 'pickup', 'rocket'][Math.floor(Math.random() * 7)];
  }

  tick(now, dt, startAt, passageLen) {
    if (this.finished) return;
    if (now - startAt < this.reactionDelay) return;
    if (now < this.pauseUntil) return;

    if (Math.random() < 0.02) { // brief hesitation / correcting a typo
      this.pauseUntil = now + 250 + Math.random() * 900;
      this.combo = 0;
      this.bestCombo = Math.max(this.bestCombo, this.combo);
      return;
    }
    if (Math.random() < 0.08) this.burst = 0.75 + Math.random() * 0.5;

    // flair: bots occasionally hit nitro too, so lanes light up even in a bot race
    this.nitro = now < this.nitroUntil;
    if (!this.nitro && this.combo > 30 && Math.random() < 0.015) {
      this.nitroUntil = now + 2500;
      this.nitro = true;
    }

    this.frac += (this.cps * this.burst * (this.nitro ? 1.12 : 1) * dt) / 1000;
    const n = Math.floor(this.frac);
    if (n > 0) {
      this.frac -= n;
      this.correct = Math.min(passageLen, this.correct + n);
      this.typed = this.correct;
      this.keystrokes += n;
      this.combo += n;
      this.bestCombo = Math.max(this.bestCombo, this.combo);
      this.score += n * (10 + Math.min(20, Math.floor(this.combo / 10) * 2)) * (this.nitro ? 2 : 1);
    }
  }
}

/**
 * Create `count` bots whose names are not in `usedNames` (lower-cased set).
 */
function makeBots(count, usedNames = new Set()) {
  const pool = ROSTER.filter(([n]) => !usedNames.has(n.toLowerCase()));
  // Fisher-Yates shuffle
  for (let i = pool.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [pool[i], pool[j]] = [pool[j], pool[i]];
  }
  return pool.slice(0, count).map(([name, country]) => new Bot({
    name,
    country,
    targetWpm: Math.round(32 + Math.random() * 58), // 32 .. 90 WPM
  }));
}

module.exports = { Bot, makeBots };
