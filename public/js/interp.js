/**
 * Time-based interpolation buffer for one remote racer.
 *
 * The server sends progress snapshots stamped with server time at ~10 Hz.
 * Instead of jumping to each new value (which stutters, especially when
 * packets bunch up), the renderer asks for the value at
 * `serverNow - INTERP_DELAY` and we linearly interpolate between the two
 * snapshots bracketing that instant. With a delay of ~1.5 ticks there is
 * almost always a later snapshot to interpolate towards, so motion is smooth
 * and remains faithful to what actually happened.
 *
 * If the buffer runs dry (packet loss, hitch) we extrapolate briefly along the
 * last known velocity, bounded so a stalled player never runs away.
 */
export class Interpolator {
  constructor(maxSamples = 24) {
    this.samples = [];
    this.maxSamples = maxSamples;
    this.last = 0;
  }

  reset() {
    this.samples.length = 0;
    this.last = 0;
  }

  push(t, v) {
    const s = this.samples;
    if (s.length && t <= s[s.length - 1].t) {
      s[s.length - 1].v = v; // out-of-order / duplicate stamp: overwrite
      return;
    }
    s.push({ t, v });
    if (s.length > this.maxSamples) s.shift();
  }

  valueAt(t) {
    const s = this.samples;
    const n = s.length;
    if (n === 0) return this.last;

    if (t <= s[0].t) return (this.last = s[0].v);

    if (t >= s[n - 1].t) {
      const a = s[n - 1];
      const b = s[n - 2];
      if (!b) return (this.last = a.v);
      const vel = Math.max(0, (a.v - b.v) / Math.max(1, a.t - b.t)); // progress per ms, forward only
      const dt = Math.min(t - a.t, 250);                                 // never extrapolate > 250 ms
      return (this.last = Math.min(1, a.v + vel * dt));
    }

    // binary search for the bracketing pair
    let lo = 0;
    let hi = n - 1;
    while (hi - lo > 1) {
      const mid = (lo + hi) >> 1;
      if (s[mid].t <= t) lo = mid; else hi = mid;
    }
    const a = s[lo];
    const b = s[hi];
    const f = (t - a.t) / (b.t - a.t);
    return (this.last = a.v + (b.v - a.v) * f);
  }
}
