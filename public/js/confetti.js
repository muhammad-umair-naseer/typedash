const COLORS = ['#ffd166', '#4cc9f0', '#ff4d6d', '#3ddc97', '#fbbf24', '#ff9e00', '#ffffff'];

export class Confetti {
  constructor(canvas) {
    this.c = canvas;
    this.ctx = canvas.getContext('2d');
    this.parts = [];
    this.running = false;
    this.resize();
    window.addEventListener('resize', () => this.resize());
  }

  resize() {
    // backing store in device pixels, drawing coordinates in CSS pixels
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    this.w = window.innerWidth;
    this.h = window.innerHeight;
    this.c.width = Math.floor(this.w * dpr);
    this.c.height = Math.floor(this.h * dpr);
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  burst(count = 220) {
    const w = this.w;
    for (let i = 0; i < count; i++) {
      const side = i % 2 === 0 ? -1 : 1;
      this.parts.push({
        x: w / 2 + side * (w * 0.25) + (Math.random() - 0.5) * 60,
        y: this.h * 0.55,
        vx: -side * (3 + Math.random() * 7) + (Math.random() - 0.5) * 4,
        vy: -(9 + Math.random() * 9),
        g: 0.28 + Math.random() * 0.12,
        w: 6 + Math.random() * 6,
        h: 4 + Math.random() * 6,
        rot: Math.random() * Math.PI,
        vr: (Math.random() - 0.5) * 0.3,
        color: COLORS[i % COLORS.length],
        life: 140 + Math.random() * 60,
      });
    }
    if (!this.running) {
      this.running = true;
      requestAnimationFrame(() => this.loop());
    }
  }

  loop() {
    const { ctx, w, h } = this;
    ctx.clearRect(0, 0, w, h);
    for (const p of this.parts) {
      p.vy += p.g;
      p.vx *= 0.99;
      p.x += p.vx;
      p.y += p.vy;
      p.rot += p.vr;
      p.life--;
      ctx.save();
      ctx.translate(p.x, p.y);
      ctx.rotate(p.rot);
      ctx.globalAlpha = Math.max(0, Math.min(1, p.life / 40));
      ctx.fillStyle = p.color;
      ctx.fillRect(-p.w / 2, -p.h / 2, p.w, p.h);
      ctx.restore();
    }
    this.parts = this.parts.filter((p) => p.life > 0 && p.y < h + 20);
    if (this.parts.length) requestAnimationFrame(() => this.loop());
    else {
      this.running = false;
      ctx.clearRect(0, 0, w, h);
    }
  }
}
