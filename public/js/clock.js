/**
 * Estimates the server clock on the client (NTP-style).
 *
 * Every ping carries the client's send time; the pong returns it along with
 * the server time. offset = serverTime - (sendTime + rtt/2). Samples with the
 * lowest round-trip time are the most trustworthy, so we average the best
 * half of the last ten and ease towards that value.
 *
 * All countdowns, race timers and interpolation are driven from `now()`, so
 * every client in the world sees "GO" at the same instant regardless of
 * latency.
 */
export class ServerClock {
  constructor(net) {
    this.net = net;
    this.offset = 0;
    this.rtt = null;
    this.samples = [];
    this.timer = null;
    this.onUpdate = null;
    net.on('pong', (m) => this.onPong(m));
  }

  /** Rough first estimate from the welcome packet (assumes ~0 latency). */
  seed(serverTime) {
    if (this.samples.length === 0) this.offset = serverTime - Date.now();
  }

  start(intervalMs = 2000) {
    this.stop();
    this.samples.length = 0;
    this.ping();
    // a quick burst first so the estimate settles before the first race
    setTimeout(() => this.ping(), 300);
    setTimeout(() => this.ping(), 700);
    this.timer = setInterval(() => this.ping(), intervalMs);
  }

  stop() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  ping() {
    this.net.send({ type: 'ping', t: Date.now() });
  }

  onPong({ t, st }) {
    const now = Date.now();
    const rtt = now - t;
    const off = st - (t + rtt / 2);

    this.samples.push({ rtt, off });
    if (this.samples.length > 10) this.samples.shift();

    const sorted = [...this.samples].sort((a, b) => a.rtt - b.rtt);
    const best = sorted.slice(0, Math.max(1, Math.ceil(sorted.length / 2)));
    const target = best.reduce((s, x) => s + x.off, 0) / best.length;

    // snap while warming up, then ease so the race clock never jumps visibly
    this.offset += (target - this.offset) * (this.samples.length < 3 ? 1 : 0.3);
    this.rtt = rtt;
    if (this.onUpdate) this.onUpdate(this);
  }

  now() {
    return Date.now() + this.offset;
  }
}
