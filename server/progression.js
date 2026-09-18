'use strict';

/**
 * The level curve and titles. Keep in sync with public/js/account.js — the
 * client draws the XP bar from the same numbers; the server only needs them
 * for profile pages and share cards (test/run-share-test.js checks parity).
 */
const TITLES = [
  [1, 'Rookie'], [3, 'Cadet'], [5, 'Racer'], [8, 'Turbo'], [11, 'Nitro Head'],
  [14, 'Speed Demon'], [18, 'Keyboard Ace'], [22, 'Blazer'], [27, 'Legend'], [35, 'Immortal'],
];

/** Cumulative ranked points needed to *reach* a level (level 1 = 0). */
function pointsForLevel(level) {
  if (level <= 1) return 0;
  return Math.round(400 * Math.pow(level - 1, 1.6));
}

function levelForPoints(points) {
  let lvl = 1;
  while (pointsForLevel(lvl + 1) <= points) lvl++;
  return lvl;
}

function titleFor(level) {
  let t = TITLES[0][1];
  for (const [min, name] of TITLES) if (level >= min) t = name;
  return t;
}

module.exports = { TITLES, pointsForLevel, levelForPoints, titleFor };
