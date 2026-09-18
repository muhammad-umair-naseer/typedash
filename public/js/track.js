import { flag } from './countries.js';
import { carSvg } from './cars.js';
import { medal } from './ui.js';

const clamp01 = (v) => Math.max(0, Math.min(1, v));

/**
 * Renders one lane per racer. Positions are written every animation frame via
 * `render(getFraction)`, using only `transform` so the browser can composite
 * without layout work. Cars carry their own skin, nitro flames, emote bubbles
 * and floating score pops so everything travels with the car.
 */
export class Track {
  constructor(root) {
    this.root = root;
    this.lanes = new Map();
    this.roadW = 0;
    this.carW = 0;
    this.localId = null;
    window.addEventListener('resize', () => this.measure());
  }

  setPlayers(players, localId) {
    this.localId = localId;
    const ids = new Set(players.map((p) => p.id));

    for (const [id, lane] of this.lanes) {
      if (!ids.has(id)) {
        lane.el.classList.add('leaving');
        setTimeout(() => lane.el.remove(), 300);
        this.lanes.delete(id);
      }
    }

    players.forEach((p, i) => {
      let lane = this.lanes.get(p.id);
      if (!lane) {
        lane = this.createLane(p);
        this.lanes.set(p.id, lane);
      }
      lane.el.style.order = i;
      lane.el.classList.toggle('me', p.id === localId);
      lane.el.style.setProperty('--c', p.color);
      lane.name.textContent = p.tag ? `[${p.tag}] ${p.name}` : p.name;
      lane.flag.textContent = flag(p.country);
      lane.bot.hidden = !p.isBot;
      lane.bot.textContent = p.role === 'pacer' ? 'ROBOT' : p.role === 'ghost' ? 'REPLAY' : 'COMPUTER';
      lane.el.classList.toggle('pacer', p.role === 'pacer');
      lane.el.classList.toggle('ghost', p.role === 'ghost');
      lane.you.hidden = p.id !== localId;
      if (lane.skin !== (p.skin || 'dash')) {
        lane.skin = p.skin || 'dash';
        lane.carArt.innerHTML = carSvg(lane.skin);
      }
    });
    this.measure();
  }

  createLane(p) {
    const el = document.createElement('div');
    el.className = 'lane';
    el.dataset.id = p.id;
    el.innerHTML = `
      <div class="lane-info">
        <span class="flag"></span>
        <span class="name"></span>
        <span class="tag bot" hidden>COMPUTER</span>
        <span class="tag you" hidden>YOU</span>
      </div>
      <div class="lane-road">
        <div class="lane-fill"></div>
        <div class="speed-lines"></div>
        <div class="finish-line"></div>
        <div class="car"><div class="car-art"></div><div class="car-fx"></div></div>
      </div>
      <div class="lane-stats">
        <div class="wpm-box"><span class="wpm">0</span><small>a min</small></div>
        <span class="pct">0%</span>
        <span class="rank"></span>
      </div>`;
    const car = el.querySelector('.car');
    const carArt = el.querySelector('.car-art');
    this.root.appendChild(el);
    requestAnimationFrame(() => el.classList.add('in'));
    return {
      el,
      name: el.querySelector('.name'),
      flag: el.querySelector('.flag'),
      bot: el.querySelector('.tag.bot'),
      you: el.querySelector('.tag.you'),
      road: el.querySelector('.lane-road'),
      fill: el.querySelector('.lane-fill'),
      car,
      carArt,
      fx: el.querySelector('.car-fx'),
      wpm: el.querySelector('.wpm'),
      pct: el.querySelector('.pct'),
      rank: el.querySelector('.rank'),
      skin: null,
      x: 0,
      lastF: 0,
      moving: false,
      nitro: false,
      revTimer: null,
    };
  }

  measure() {
    const first = this.lanes.values().next().value;
    if (!first) return;
    this.roadW = first.road.clientWidth;
    this.carW = first.car.offsetWidth;
  }

  updateMeta(id, { wpm, pct, rank, finished, nitro } = {}) {
    const l = this.lanes.get(id);
    if (!l) return;
    if (wpm != null) l.wpm.textContent = wpm;
    if (pct != null) l.pct.textContent = `${Math.round(pct * 100)}%`;
    if (rank != null) {
      l.rank.textContent = medal(rank);
      l.el.classList.toggle('on-podium', rank <= 3);
    }
    if (finished) l.el.classList.add('finished');
    if (nitro != null) this.setNitro(id, nitro);
  }

  setNitro(id, on) {
    const l = this.lanes.get(id);
    if (!l || l.nitro === !!on) return;
    l.nitro = !!on;
    l.el.classList.toggle('nitro', l.nitro);
  }

  /** Floating text that rises from the car (score pops, combo tiers). */
  pop(id, text, cls = '') {
    const l = this.lanes.get(id);
    if (!l) return;
    const node = document.createElement('div');
    node.className = `car-pop ${cls}`;
    node.textContent = text;
    l.fx.appendChild(node);
    setTimeout(() => node.remove(), 1400);
  }

  /** Engine rev: a quick shake + exhaust puff before the race starts. */
  rev(id) {
    const l = this.lanes.get(id);
    if (!l) return;
    l.el.classList.remove('revving');
    void l.el.offsetWidth;
    l.el.classList.add('revving');
    clearTimeout(l.revTimer);
    l.revTimer = setTimeout(() => l.el.classList.remove('revving'), 420);
  }

  /** Emoji speech bubble above the car. */
  emote(id, e) {
    const l = this.lanes.get(id);
    if (!l) return;
    const old = l.fx.querySelector('.emote');
    if (old) old.remove();
    const node = document.createElement('div');
    node.className = 'emote';
    node.textContent = e;
    l.fx.appendChild(node);
    setTimeout(() => node.remove(), 2200);
  }

  reset() {
    for (const l of this.lanes.values()) {
      l.rank.textContent = '';
      l.wpm.textContent = '0';
      l.pct.textContent = '0%';
      l.el.classList.remove('finished', 'on-podium', 'moving', 'nitro');
      l.nitro = false;
      l.x = 0;
      l.lastF = 0;
      l.fx.innerHTML = '';
      l.car.style.transform = 'translate3d(0,0,0)';
      l.fill.style.transform = 'scaleX(0)';
    }
  }

  /**
   * @param {(id:string)=>number} getFraction progress 0..1 for a racer
   * @param {boolean} racing whether wheels should spin
   */
  render(getFraction, racing) {
    if (!this.roadW) this.measure();
    const travel = Math.max(0, this.roadW - this.carW);
    for (const [id, l] of this.lanes) {
      const f = clamp01(getFraction(id));
      const x = f * travel;
      const moving = racing && Math.abs(x - l.x) > 0.02 && f < 1;
      if (Math.abs(x - l.x) > 0.005) {
        l.car.style.transform = `translate3d(${x.toFixed(2)}px,0,0)`;
        l.x = x;
      }
      if (Math.abs(f - l.lastF) > 0.0005) {
        l.fill.style.transform = `scaleX(${f.toFixed(4)})`;
        l.lastF = f;
      }
      if (moving !== l.moving) {
        l.el.classList.toggle('moving', moving);
        l.moving = moving;
      }
    }
  }
}
