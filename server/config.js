'use strict';

const num = (key, def) => {
  const v = process.env[key];
  return v === undefined || v === '' || Number.isNaN(Number(v)) ? def : Number(v);
};

module.exports = {
  PORT: num('PORT', 4000),

  // --- real-time sync ---
  TICK_MS: num('TICK_MS', 100),            // server snapshot rate (10 Hz)

  // --- rooms ---
  MAX_PLAYERS: num('MAX_PLAYERS', 5),      // racers per room (humans + bots)
  BOT_FILL_TO: num('BOT_FILL_TO', 4),      // public rooms are topped up with bots to this many racers
  LOBBY_WAIT_MS: num('LOBBY_WAIT_MS', 12000),   // how long a public lobby waits for more humans
  COUNTDOWN_MS: num('COUNTDOWN_MS', 5000),      // 5-4-3-2-1 before GO
  RACE_TIMEOUT_MS: num('RACE_TIMEOUT_MS', 150000),
  AFTER_FIRST_FINISH_MS: num('AFTER_FIRST_FINISH_MS', 60000), // race ends this long after the winner finishes
  HUMANS_DONE_GRACE_MS: num('HUMANS_DONE_GRACE_MS', 3500),    // once every human is done, let bots wrap up briefly
  RESULTS_MS: num('RESULTS_MS', 12000),    // results screen before the next race in the same room

  // --- game layer ---
  BONUS_WORDS: num('BONUS_WORDS', 3),      // golden words per race (flawless typing = bonus score)
  MAX_SCORE_PER_CHAR: 80,                  // ceiling for client-reported score (sanity clamp)
  EMOTE_MIN_INTERVAL_MS: 700,
  REV_MIN_INTERVAL_MS: 320,

  // --- accounts, ranking & streaks ---
  DATA_FILE: process.env.DATA_FILE || 'data/typedash.json',
  RANKED_PRIVATE: process.env.RANKED_PRIVATE === '1',  // friendlies are unranked by default
  STREAK_BONUS_STEP: 0.05,                 // +5% points per day of streak
  STREAK_BONUS_CAP: 0.5,                   // ...capped at +50%
  BOARD_SIZE: num('BOARD_SIZE', 25),       // rows returned per ranking board
  BOARD_CACHE_MS: num('BOARD_CACHE_MS', 3000),
  BOARD_PUSH_MS: num('BOARD_PUSH_MS', 5000),
  MAX_RIVALS: 40,

  // --- solo / practice ---
  // Runs happen entirely in the browser (passage, countdown, pacer, timing);
  // the server only stamps the start and validates the one submitted result.
  SOLO_TIMELINE_MAX: 400,                  // progress samples accepted per submitted run
  SOLO_START_SLACK_MS: num('SOLO_START_SLACK_MS', 2500), // tolerance between the start stamp and the reported time
  SOLO_STREAK: process.env.SOLO_STREAK !== '0', // practice runs keep the daily streak alive

  // --- public URLs (share pages, cards, sitemap) ---
  PUBLIC_ORIGIN: (process.env.PUBLIC_ORIGIN || '').replace(/\/$/, ''),  // e.g. https://typedash.app; derived from the request when unset
  SHARE_KEEP: num('SHARE_KEEP', 5000),       // newest share links kept on disk

  // --- push reminders (server/notify.js) ---
  VAPID_SUBJECT: process.env.VAPID_SUBJECT || 'mailto:hello@typedash.local',
  VAPID_PUBLIC: process.env.VAPID_PUBLIC || '',     // base64url; generated and stored on first run when unset
  VAPID_PRIVATE: process.env.VAPID_PRIVATE || '',
  PUSH_TICK_MS: num('PUSH_TICK_MS', 600000),        // scheduler cadence (10 min)
  PUSH_STREAK_HOUR: num('PUSH_STREAK_HOUR', 18),    // local hour from which a streak-at-risk reminder may go out
  PUSH_DAILY_HOUR: num('PUSH_DAILY_HOUR', 10),      // local hour for the (opt-in) daily challenge reminder
  PUSH_MAX_SUBS: 5,                                 // subscriptions per account (devices)

  // --- teams ---
  TEAM_MAX_MEMBERS: num('TEAM_MAX_MEMBERS', 50),
  TEAM_NAME_MAX: 24,

  // --- seasons (monthly points race, archived on rollover) ---
  SEASON_EPOCH: process.env.SEASON_EPOCH || '2026-09',   // the month of Season 1
  SEASON_KEEP: num('SEASON_KEEP', 24),                   // archived seasons kept

  // --- daily challenge ---
  DAILY_EPOCH: process.env.DAILY_EPOCH || '2026-09-01',   // the day of Daily #1
  DAILY_ATTEMPTS: num('DAILY_ATTEMPTS', 1),  // scored attempts per day (1 = your first finished run counts)
  DAILY_KEEP_DAYS: num('DAILY_KEEP_DAYS', 60), // how many past days of results to keep on disk

  // --- anti-cheat / limits ---
  MAX_CPS: num('MAX_CPS', 30),             // chars per second ceiling (~360 WPM) for accepted progress
  MAX_PAYLOAD: num('MAX_PAYLOAD', 16384),  // largest accepted WebSocket message (solo results carry a timeline)
  MAX_NAME_LEN: 16,
  MAX_CHAT_LEN: 140,
  CHAT_MIN_INTERVAL_MS: 500,
  LEADERBOARD_SIZE: 10,           // legacy session board (fastest WPM today)
};
