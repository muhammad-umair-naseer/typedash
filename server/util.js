'use strict';
const crypto = require('crypto');

// No 0/O/1/I so room codes are easy to read out loud.
const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

function randomId(len = 10) {
  return crypto.randomBytes(len).toString('base64url').slice(0, len);
}

function roomCode(len = 5) {
  const bytes = crypto.randomBytes(len);
  let s = '';
  for (let i = 0; i < len; i++) s += CODE_ALPHABET[bytes[i] % CODE_ALPHABET.length];
  return s;
}

function clamp(v, lo, hi) {
  return Math.max(lo, Math.min(hi, v));
}

function sanitizeText(raw, maxLen) {
  if (typeof raw !== 'string') return '';
  // strip control chars and angle brackets, collapse whitespace
  return raw
    .replace(/[\u0000-\u001f\u007f<>]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, maxLen);
}

function sanitizeCountry(raw) {
  if (typeof raw !== 'string') return 'UN';
  const c = raw.toUpperCase();
  return /^[A-Z]{2}$/.test(c) ? c : 'UN';
}

function sanitizeSkin(raw, allowed, fallback = 'dash') {
  return typeof raw === 'string' && allowed.includes(raw) ? raw : fallback;
}

function pick(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}

module.exports = { randomId, roomCode, clamp, sanitizeText, sanitizeCountry, sanitizeSkin, pick };
