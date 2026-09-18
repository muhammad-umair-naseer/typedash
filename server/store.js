'use strict';
const fs = require('fs');
const path = require('path');

/**
 * Tiny JSON-file store. Keeps the whole dataset in memory and flushes it to
 * disk atomically (write temp + rename) on a debounce, plus on shutdown, so a
 * crash can never leave a half-written file. Good for thousands of accounts on
 * a single box; swap for SQLite/Postgres if the game ever outgrows that.
 */
class Store {
  constructor(file, { debounceMs = 1200 } = {}) {
    this.file = file;
    this.tmp = `${file}.tmp`;
    this.debounceMs = debounceMs;
    this.data = { version: 1, accounts: {} };
    this.timer = null;
    this.writing = false;
    this.pending = false;
    this.load();
    this.installShutdownHooks();
  }

  load() {
    try {
      const raw = fs.readFileSync(this.file, 'utf8');
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed === 'object' && parsed.accounts) this.data = parsed;
      console.log(`[store] loaded ${Object.keys(this.data.accounts).length} accounts from ${this.file}`);
    } catch (err) {
      if (err.code !== 'ENOENT') console.error('[store] could not read data file, starting empty:', err.message);
      fs.mkdirSync(path.dirname(this.file), { recursive: true });
    }
  }

  /** Mark the dataset dirty; the flush is coalesced. */
  touch() {
    if (this.timer) return;
    this.timer = setTimeout(() => { this.timer = null; this.flush(); }, this.debounceMs);
    this.timer.unref?.();
  }

  flush() {
    if (this.writing) { this.pending = true; return; }
    this.writing = true;
    const body = JSON.stringify(this.data);
    fs.writeFile(this.tmp, body, (err) => {
      if (err) {
        this.writing = false;
        return console.error('[store] write failed:', err.message);
      }
      fs.rename(this.tmp, this.file, (err2) => {
        this.writing = false;
        if (err2) console.error('[store] rename failed:', err2.message);
        if (this.pending) { this.pending = false; this.touch(); }
      });
    });
  }

  flushSync() {
    try {
      fs.writeFileSync(this.tmp, JSON.stringify(this.data));
      fs.renameSync(this.tmp, this.file);
    } catch (err) {
      console.error('[store] final write failed:', err.message);
    }
  }

  installShutdownHooks() {
    const bye = () => { this.flushSync(); process.exit(0); };
    process.once('SIGINT', bye);
    process.once('SIGTERM', bye);
    process.once('beforeExit', () => this.flushSync());
  }
}

module.exports = Store;
