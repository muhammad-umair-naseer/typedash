/**
 * Tiny WebSocket client with typed message dispatch and exponential-backoff
 * reconnect. Server messages are JSON objects with a `type` field; each type
 * is emitted as an event.
 */
export class Net {
  constructor(url = null) {
    this.url = url || `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}`;
    this.ws = null;
    this.handlers = new Map();
    this.connected = false;
    this.retries = 0;
    this.reconnectTimer = null;
  }

  on(type, fn) {
    if (!this.handlers.has(type)) this.handlers.set(type, []);
    this.handlers.get(type).push(fn);
    return this;
  }

  emit(type, data) {
    const hs = this.handlers.get(type);
    if (!hs) return;
    for (const h of hs) {
      try { h(data); } catch (err) { console.error(`[net:${type}]`, err); }
    }
  }

  connect() {
    clearTimeout(this.reconnectTimer);
    let ws;
    try {
      ws = new WebSocket(this.url);
    } catch (err) {
      this.scheduleReconnect();
      return;
    }
    this.ws = ws;

    ws.onopen = () => {
      this.connected = true;
      this.retries = 0;
      this.emit('open');
    };
    ws.onmessage = (ev) => {
      let msg;
      try { msg = JSON.parse(ev.data); } catch (_) { return; }
      if (msg && typeof msg.type === 'string') this.emit(msg.type, msg);
    };
    ws.onclose = () => {
      const wasConnected = this.connected;
      this.connected = false;
      this.emit('close', { wasConnected });
      this.scheduleReconnect();
    };
    ws.onerror = () => { /* onclose follows */ };
  }

  scheduleReconnect() {
    const delay = Math.min(8000, 400 * 2 ** this.retries++);
    this.reconnectTimer = setTimeout(() => this.connect(), delay);
  }

  send(obj) {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return false;
    this.ws.send(JSON.stringify(obj));
    return true;
  }
}
