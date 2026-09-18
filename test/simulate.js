'use strict';
/**
 * Spawns N simulated human players that connect, quick-match, and type the
 * passage at a random speed. Useful for smoke tests and load tests.
 *
 *   node test/simulate.js 8                       # 8 players against localhost:4000
 *   URL=wss://typedash.example.com node test/simulate.js 20
 *   RACES=2 node test/simulate.js 4               # disconnect after 2 finished races
 */
const WebSocket = require('ws');

const N = Number(process.argv[2] || 4);
const URL = process.env.URL || 'ws://localhost:4000';
const RACES = Number(process.env.RACES || 0); // 0 = run forever

let finishedRaces = 0;

function spawn(i) {
  const ws = new WebSocket(URL);
  const tag = `Sim${i}`;
  let passage = '';
  let state = null;
  let correct = 0;
  let timer = null;
  const wpm = 30 + Math.random() * 70;
  const cps = (wpm * 5) / 60;
  let pingTimer = null;
  let bestRtt = Infinity;

  const send = (o) => ws.readyState === 1 && ws.send(JSON.stringify(o));

  ws.on('open', () => {
    send({ type: 'hello', name: tag, country: ['PK', 'SA', 'US', 'DE', 'JP', 'BR'][i % 6] });
    send({ type: 'quick' });
    pingTimer = setInterval(() => send({ type: 'ping', t: Date.now() }), 2000);
  });

  ws.on('message', (raw) => {
    const m = JSON.parse(raw);
    if (m.type === 'pong') {
      bestRtt = Math.min(bestRtt, Date.now() - m.t);
    } else if (m.type === 'room') {
      if (m.passage) passage = m.passage;
      if (m.state !== state) {
        state = m.state;
        console.log(`[${tag}] room ${m.code} -> ${state} (${m.players.length} racers, target ${wpm.toFixed(0)} WPM, rtt ${Number.isFinite(bestRtt) ? bestRtt : '?'} ms)`);
        if (state === 'racing') startTyping();
        if (state === 'finished') {
          clearInterval(timer);
          if (i === 0) {
            console.log('--- results ---');
            for (const r of m.results) {
              console.log(`  #${r.rank} ${r.name.padEnd(10)} ${String(r.wpm).padStart(3)} WPM  ${r.accuracy}%  ${r.finished ? (r.time / 1000).toFixed(1) + 's' : Math.round(r.progress * 100) + '%'}${r.isBot ? '  (bot)' : ''}`);
            }
            finishedRaces++;
            if (RACES && finishedRaces >= RACES) {
              console.log(`Done after ${finishedRaces} race(s).`);
              process.exit(0);
            }
          }
        }
      }
    } else if (m.type === 'error') {
      console.log(`[${tag}] error: ${m.message}`);
    }
  });

  ws.on('close', () => { clearInterval(timer); clearInterval(pingTimer); });
  ws.on('error', (e) => console.log(`[${tag}] socket error`, e.message));

  function startTyping() {
    correct = 0;
    clearInterval(timer);
    const step = Math.max(1, Math.round(cps / 10)); // per 100 ms
    timer = setInterval(() => {
      if (!passage) return;
      correct = Math.min(passage.length, correct + step);
      send({ type: 'progress', c: correct, t: correct, k: correct, e: 0 });
      if (correct >= passage.length) clearInterval(timer);
    }, 100);
  }
}

for (let i = 0; i < N; i++) setTimeout(() => spawn(i), i * 150);
