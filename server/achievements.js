'use strict';

/**
 * Achievements are evaluated on the server from race stats it validated
 * itself, so they survive a device change and cannot be handed out by a
 * modified client. The catalogue (id/icon/name/desc) is shipped to clients in
 * the `welcome` message so the UI never hard-codes it.
 *
 * check(acc, r) — `acc` is the account after the race was applied, `r` is the
 * race summary: { rank, wpm, accuracy, errors, finished, chars, golden,
 * goldenTotal, bestCombo, nitros, lane, racers, ranked, hour }.
 *
 * scope — which kind of run may unlock it: 'race' (multiplayer, the default),
 * 'solo' (practice runs), or 'any'. Practice runs are computed in the browser,
 * so anything that would cheapen a racing badge stays race-only.
 */
const ACHIEVEMENTS = [
  { id: 'first_race', icon: '🏁', name: 'Engine started', desc: 'Finish your first race', check: (a) => a.races >= 1 },
  { id: 'first_win', icon: '🥇', name: 'Checkered flag', desc: 'Win a race', check: (a) => a.wins >= 1 },
  { id: 'podium_5', icon: '🏆', name: 'Regular', desc: 'Finish in the top three, five times', check: (a) => a.podiums >= 5 },
  { id: 'wpm_60', icon: '💨', name: 'Cruising', desc: 'Finish a race at 60 words a minute or more', check: (a) => a.bestWpm >= 60 },
  { id: 'wpm_80', icon: '🚀', name: 'Blistering', desc: 'Finish a race at 80 words a minute or more', check: (a) => a.bestWpm >= 80 },
  { id: 'wpm_100', icon: '⚡', name: 'Triple digits', desc: 'Finish a race at 100 words a minute or more', check: (a) => a.bestWpm >= 100 },
  { id: 'combo_50', icon: '🔥', name: 'On fire', desc: 'Type 50 letters in a row with no mistakes', check: (a) => a.bestCombo >= 50 },
  { id: 'combo_100', icon: '☄️', name: 'Untouchable', desc: 'Type 100 letters in a row with no mistakes', check: (a) => a.bestCombo >= 100 },
  { id: 'flawless', icon: '💎', name: 'Flawless', desc: 'Finish a race without typing a single wrong letter', check: (a, r) => r.finished && r.errors === 0 },
  { id: 'golden_all', icon: '✨', name: 'Midas', desc: 'Get all three bonus words in one race', check: (a, r) => r.goldenTotal > 0 && r.golden === r.goldenTotal },
  { id: 'nitro_3', icon: '🧨', name: 'Boost junkie', desc: 'Fill the boost bar three times in one race', check: (a, r) => r.nitros >= 3 },
  { id: 'lane_five', icon: '🎯', name: 'Back of the grid', desc: 'Win a race from the bottom row', check: (a, r) => r.rank === 1 && r.lane >= 5 },
  { id: 'races_10', icon: '🛣️', name: 'Road trip', desc: 'Finish 10 races', check: (a) => a.races >= 10 },
  { id: 'races_50', icon: '🌍', name: 'World tour', desc: 'Finish 50 races', check: (a) => a.races >= 50 },
  { id: 'chars_10k', icon: '⌨️', name: 'Ten thousand', desc: 'Type 10,000 characters', scope: 'any', check: (a) => a.chars >= 10000 },
  { id: 'night_owl', icon: '🦉', name: 'Night owl', desc: 'Finish a race between midnight and 4 am', check: (a, r) => r.hour >= 0 && r.hour < 4 },
  { id: 'points_10k', icon: '💰', name: 'Point collector', desc: 'Collect 10,000 points', check: (a) => a.points >= 10000 },
  { id: 'points_50k', icon: '👑', name: 'Hall of fame', desc: 'Collect 50,000 points', check: (a) => a.points >= 50000 },
  { id: 'streak_3', icon: '📅', name: 'Habit forming', desc: 'Play on 3 days in a row', scope: 'any', check: (a) => a.streak >= 3 },
  { id: 'streak_7', icon: '🗓️', name: 'Seven day streak', desc: 'Play on 7 days in a row', scope: 'any', check: (a) => a.streak >= 7 },
  { id: 'streak_30', icon: '🔒', name: 'Unbreakable', desc: 'Play on 30 days in a row', scope: 'any', check: (a) => a.streak >= 30 },
  { id: 'friendly_5', icon: '🤝', name: 'Good company', desc: 'Finish five private games with other people', check: (a) => a.friendlies >= 5 },
  { id: 'rival_win_5', icon: '⚔️', name: 'Nemesis', desc: 'Beat the same person five times', check: (a) => Object.values(a.rivals || {}).some((r) => r.w >= 5) },
  // --- practice ---
  { id: 'solo_first', icon: '🏃', name: 'Warm-up lap', desc: 'Finish a go on your own', scope: 'solo', check: (a) => a.solo && a.solo.finished >= 1 },
  { id: 'solo_10', icon: '📈', name: 'Grinder', desc: 'Finish ten goes on your own', scope: 'solo', check: (a) => a.solo && a.solo.finished >= 10 },
  { id: 'pacer_beat', icon: '🏎️', name: 'Pace setter', desc: 'Beat the robot when typing on your own', scope: 'solo', check: (a, r) => !!r.beatPacer },
  { id: 'solo_flawless', icon: '🧊', name: 'Ice cold', desc: 'Type on your own with no mistakes at all', scope: 'solo', check: (a, r) => r.finished && r.errors === 0 },
  { id: 'ghost_beat', icon: '👻', name: 'Ghostbuster', desc: 'Beat a replay of somebody else\'s run', scope: 'solo', check: (a, r) => !!r.beatGhost },
  // --- seasons (evaluated when a season is archived) ---
  { id: 'season_top100', icon: '🎖️', name: 'Season veteran', desc: 'Finish a month in the top 100', scope: 'season', check: (a) => (a.badges || []).some((b) => b.rank <= 100) },
  { id: 'season_top10', icon: '🏵️', name: 'Seasonal contender', desc: 'Finish a month in the top 10', scope: 'season', check: (a) => (a.badges || []).some((b) => b.rank <= 10) },
  { id: 'season_win', icon: '🌟', name: 'Season champion', desc: 'Come first for a whole month', scope: 'season', check: (a) => (a.badges || []).some((b) => b.rank === 1 && !b.team) },
  { id: 'team_top3', icon: '🏰', name: 'Dynasty', desc: 'Your team finishes a month in the top three', scope: 'season', check: (a) => (a.badges || []).some((b) => b.team && b.rank <= 3) },
  // --- languages and modes ---
  { id: 'polyglot', icon: '🗣️', name: 'Polyglot', desc: 'Type in three different languages', scope: 'any', check: (a) => Object.keys(a.langs || {}).length >= 3 },
  { id: 'coder', icon: '💻', name: 'Syntax highlighter', desc: 'Finish one of the code paragraphs', scope: 'any', check: (a, r) => r.finished && r.category === 'code' },
  { id: 'numbers', icon: '🔢', name: 'Number cruncher', desc: 'Finish one of the numbers and symbols paragraphs', scope: 'any', check: (a, r) => r.finished && r.category === 'numbers' },
  // --- teams ---
  { id: 'team_join', icon: '🛡️', name: 'Squad up', desc: 'Join or create a team', scope: 'team', check: (a) => !!a.team },
  { id: 'wr_set', icon: '🌐', name: 'Record holder', desc: 'Be the fastest person ever on a paragraph', scope: 'any', check: (a, r) => !!r.setWr },
  // --- daily challenge (evaluated after the daily entry is recorded) ---
  { id: 'daily_first', icon: '📰', name: 'Daily driver', desc: "Finish today's paragraph", scope: 'daily', check: (a) => a.daily && a.daily.count >= 1 },
  { id: 'daily_7', icon: '🗞️', name: 'Week of dailies', desc: 'Complete the daily challenge 7 days in a row', scope: 'daily', check: (a) => a.daily && a.daily.streak >= 7 },
  { id: 'daily_30', icon: '🏛️', name: 'Daily legend', desc: 'Complete the daily challenge 30 days in a row', scope: 'daily', check: (a) => a.daily && a.daily.streak >= 30 },
];

const CATALOGUE = ACHIEVEMENTS.map(({ id, icon, name, desc, scope }) => ({ id, icon, name, desc, scope: scope || 'race' }));

module.exports = { ACHIEVEMENTS, CATALOGUE };
