'use strict';

/**
 * A connected racer (human) or a simulated one (see Bot.js).
 * Holds the server-authoritative race state for this racer.
 */
class Player {
  constructor({ id, name = 'Guest', country = 'UN', ws = null, isBot = false }) {
    this.id = id;
    this.name = name;
    this.country = country;
    this.ws = ws;
    this.isBot = isBot;
    this.color = '#4cc9f0';
    this.skin = 'dash';   // car skin id (see public/js/skins.js); purely cosmetic
    this.tag = null;      // team tag shown next to the name (server/teams.js)
    this.account = null;  // persistent account record (server/accounts.js), humans only
    this.watching = null; // ranking board this client currently has open
    this.room = null;
    this.lastProgressAt = 0;
    this.flagged = 0; // number of progress updates that exceeded the rate ceiling
    this.resetRace();
  }

  resetRace() {
    this.correct = 0;      // length of the correctly typed prefix
    this.typed = 0;        // total characters currently in the input
    this.keystrokes = 0;   // characters inserted over the race
    this.errors = 0;       // inserted characters that were wrong
    this.wpm = 0;
    this.accuracy = 100;
    this.finished = false;
    this.finishTime = null;
    this.rank = null;
    // game layer (client-reported, sanity-clamped on the server; cosmetic + score only)
    this.score = 0;
    this.bestCombo = 0;
    this.nitro = false;
    this.nitros = 0;       // nitro bursts fired
    this.golden = 0;       // golden words hit
    // progress timeline [[msSinceGo, correct], ...], sampled at ~4 Hz for ghost replays
    this.timeline = [];
    this.lastSampleAt = 0;
    this.lastSampled = 0;
  }

  /** Static description broadcast in room state. */
  info() {
    return { id: this.id, name: this.name, country: this.country, isBot: this.isBot, color: this.color, skin: this.skin, tag: this.tag || undefined };
  }

  /** Compact per-tick snapshot. Short keys keep the 10 Hz payload tiny. */
  snap() {
    return { id: this.id, c: this.correct, w: this.wpm, a: this.accuracy, f: this.finished, r: this.rank, n: this.nitro ? 1 : 0, s: this.score };
  }

  send(msg) {
    this.sendRaw(JSON.stringify(msg));
  }

  sendRaw(str) {
    if (!this.ws || this.ws.readyState !== 1) return;
    try { this.ws.send(str); } catch (_) { /* socket is closing */ }
  }
}

module.exports = Player;
