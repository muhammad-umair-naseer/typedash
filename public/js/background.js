/**
 * Full-screen animated backdrop for the light theme: a soft nebula glow above a
 * perspective grid that scrolls towards the viewer. `setSpeed()` is driven by
 * the local racer's WPM so the world visibly accelerates as you type faster.
 */
export class Background {
  constructor(canvas) {
    this.c = canvas;
    this.ctx = canvas.getContext('2d');
    this.speed = 0.3;
    this.targetSpeed = 0.3;
    this.offset = 0;
    this.stars = [];
    this.last = performance.now();
    this.reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    this.resize();
    window.addEventListener('resize', () => this.resize());
    document.addEventListener('visibilitychange', () => { this.last = performance.now(); });
    requestAnimationFrame((t) => this.loop(t));
  }

  resize() {
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    this.w = window.innerWidth;
    this.h = window.innerHeight;
    this.c.width = Math.floor(this.w * dpr);
    this.c.height = Math.floor(this.h * dpr);
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const count = Math.floor((this.w * this.h) / 9000);
    this.stars = Array.from({ length: count }, () => ({
      x: Math.random() * this.w,
      y: Math.random() * this.h * 0.62,
      r: Math.random() * 1.3 + 0.3,
      p: Math.random() * Math.PI * 2,
      s: 0.5 + Math.random() * 1.5,
    }));
  }

  setSpeed(v) {
    this.targetSpeed = v;
  }

  loop(t) {
    const dt = Math.min(64, t - this.last);
    this.last = t;
    this.speed += (this.targetSpeed - this.speed) * 0.04;
    if (!this.reduced) this.offset = (this.offset + (this.speed * dt) / 1000) % 1;
    this.draw(t);
    requestAnimationFrame((tt) => this.loop(tt));
  }

  draw(t) {
    const { ctx, w, h } = this;
    ctx.clearRect(0, 0, w, h);

    // soft motes
    for (const s of this.stars) {
      const tw = 0.55 + 0.45 * Math.sin(t / 900 * s + s.p);
      ctx.globalAlpha = 0.14 + 0.16 * tw;
      ctx.fillStyle = '#f59e0b';
      ctx.beginPath();
      ctx.arc(s.x, s.y, s.r, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;

    // light source (soft violet-white)
    const hy = h * 0.66;
    const cx = w / 2;
    const sunR = Math.min(w, h) * 0.16;
    const sun = ctx.createRadialGradient(cx, hy - sunR * 0.35, sunR * 0.1, cx, hy - sunR * 0.35, sunR);
    sun.addColorStop(0, 'rgba(255, 255, 255, .9)');
    sun.addColorStop(0.35, 'rgba(253, 224, 175, .35)');
    sun.addColorStop(1, 'rgba(253, 224, 175, 0)');
    ctx.fillStyle = sun;
    ctx.beginPath();
    ctx.arc(cx, hy - sunR * 0.35, sunR, 0, Math.PI * 2);
    ctx.fill();

    // horizon glow
    const glow = ctx.createLinearGradient(0, hy - 40, 0, hy + 60);
    glow.addColorStop(0, 'rgba(13, 159, 196, 0)');
    glow.addColorStop(0.5, 'rgba(13, 159, 196, .07)');
    glow.addColorStop(1, 'rgba(13, 159, 196, 0)');
    ctx.fillStyle = glow;
    ctx.fillRect(0, hy - 40, w, 100);

    // perspective grid
    ctx.lineWidth = 1;
    const rows = 14;
    for (let i = 0; i <= rows; i++) {
      let f = (i / rows + this.offset) % 1;
      const y = hy + (h - hy) * f * f;
      ctx.strokeStyle = `rgba(217, 119, 6, ${0.03 + 0.14 * f})`;
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(w, y);
      ctx.stroke();
    }
    const cols = 9;
    for (let k = -cols; k <= cols; k++) {
      const xBottom = cx + k * (w / 4.5);
      const g = ctx.createLinearGradient(cx, hy, xBottom, h);
      g.addColorStop(0, 'rgba(13, 159, 196, 0)');
      g.addColorStop(1, 'rgba(13, 159, 196, .1)');
      ctx.strokeStyle = g;
      ctx.beginPath();
      ctx.moveTo(cx, hy);
      ctx.lineTo(xBottom, h);
      ctx.stroke();
    }

    // fade the grid under the content
    const fade = ctx.createLinearGradient(0, hy, 0, h);
    fade.addColorStop(0, 'rgba(252, 249, 244, 0)');
    fade.addColorStop(1, 'rgba(252, 249, 244, .55)');
    ctx.fillStyle = fade;
    ctx.fillRect(0, hy, w, h - hy);
  }
}