import { toast } from './ui.js';

/**
 * Streak / daily reminders through Web Push. Everything here happens on the
 * user's say-so: the permission prompt only opens from a click, the
 * subscription is created by the browser, and the server just stores it.
 */
const b64uToBytes = (s) => { const b = atob(s.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(s.length / 4) * 4, '=')); return Uint8Array.from(b, (c) => c.charCodeAt(0)); };

export class PushReminders {
  constructor(net, { button, onState }) {
    this.net = net;
    this.button = button;
    this.onState = onState;
    this.supported = 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
    this.subscribed = false;
    this.devices = 0;
    net.on('push', (m) => { this.subscribed = !!m.subscribed; this.devices = m.devices || 0; this.render(); if (onState) onState(m); });
    if (button) button.addEventListener('click', () => (this.subscribed ? this.disable() : this.enable()));
    this.render();
  }

  /** The server tells us how many devices are registered (in the profile). */
  setFromProfile(profile) {
    if (profile && profile.push) { this.devices = profile.push.devices || 0; this.subscribed = this.devices > 0; }
    this.render();
  }

  render() {
    if (!this.button) return;
    const denied = this.supported && Notification.permission === 'denied';
    this.button.hidden = !this.supported || denied;
    this.button.innerHTML = `<svg class="i" aria-hidden="true"><use href="#i-bell"/></svg> ${this.subscribed ? 'Reminders on' : 'Remind me'}`;
    this.button.title = this.subscribed ? 'Streak reminders are on for this device — click to turn off' : 'Get a nudge in the evening if your streak is about to end';
  }

  async enable() {
    try {
      const perm = await Notification.requestPermission();
      if (perm !== 'granted') { toast('Notifications were not allowed — you can enable them in the browser settings', 'warn', 3600); this.render(); return; }
      const reg = await navigator.serviceWorker.ready;
      const { key } = await (await fetch('/api/push/key')).json();
      const sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: b64uToBytes(key) });
      const json = sub.toJSON();
      this.net.send({ type: 'push_subscribe', subscription: { endpoint: json.endpoint, keys: json.keys }, prefs: { streak: true, daily: true }, tzOffset: -new Date().getTimezoneOffset() });
      toast('🔔 Reminders on: streak at risk in the evening, and the daily in the morning', 'success', 3600);
    } catch (err) {
      toast('Could not enable reminders here', 'error');
    }
  }

  async disable() {
    try {
      const reg = await navigator.serviceWorker.ready;
      const sub = await reg.pushManager.getSubscription();
      if (sub) { this.net.send({ type: 'push_unsubscribe', endpoint: sub.endpoint }); await sub.unsubscribe(); }
      else this.net.send({ type: 'push_unsubscribe' });
      toast('Reminders off', 'info');
    } catch (_) { /* ignore */ }
  }
}
