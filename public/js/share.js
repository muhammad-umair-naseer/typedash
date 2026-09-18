import { toast } from './ui.js';

/**
 * Share dialog: link + card image for a settled result (race, practice or
 * daily) or for a player profile. The server renders the card once and
 * caches it; here we only show it and hand it to the share sheet or the
 * clipboard.
 */
export class ShareDialog {
  constructor(root, net) {
    this.root = root;
    this.net = net;
    this.current = null;
    this.img = root.querySelector('#share-img');
    this.text = root.querySelector('#share-text');
    this.btnNative = root.querySelector('#share-native');
    this.btnLink = root.querySelector('#share-copy-link');
    this.btnImage = root.querySelector('#share-copy-image');
    root.querySelector('#share-close').addEventListener('click', () => this.close());
    root.addEventListener('click', (e) => { if (e.target === root) this.close(); });
    this.btnNative.hidden = typeof navigator.share !== 'function';
    this.btnNative.addEventListener('click', () => this.native());
    this.btnLink.addEventListener('click', () => this.copyLink());
    this.btnImage.addEventListener('click', () => this.copyImage());
    net.on('share', (m) => this.show(m));
  }

  /** Ask the server to publish a result (it remembers settled results for a while). */
  open(resultId) {
    if (!this.net.send({ type: 'share', resultId })) toast('Reconnecting — try again in a moment', 'warn');
  }

  openProfile(accountId) {
    if (!accountId) return;
    const url = `${location.origin}/u/${accountId}`;
    this.show({ url, image: `${location.origin}/og/u/${accountId}.png`, text: `My TypeDash profile — race me: ${url}`, kind: 'profile' });
  }

  show({ url, image, text }) {
    this.current = { url, image, text };
    this.img.src = image;
    this.text.textContent = text;
    this.root.hidden = false;
  }

  close() {
    this.root.hidden = true;
  }

  async native() {
    try {
      await navigator.share({ title: 'TypeDash', text: this.current.text, url: this.current.url });
    } catch (_) { /* user dismissed the sheet */ }
  }

  async copyLink() {
    try {
      await navigator.clipboard.writeText(this.current.text);
      toast('Copied — paste it anywhere links unfurl', 'success');
    } catch (_) {
      toast(this.current.url, 'info', 6000);
    }
  }

  async copyImage() {
    try {
      const blob = await (await fetch(this.current.image, { cache: 'force-cache' })).blob();
      if (!window.ClipboardItem || blob.type !== 'image/png') throw new Error('unsupported');
      await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]);
      toast('Card copied as an image', 'success');
    } catch (_) {
      window.open(this.current.image, '_blank', 'noopener');
    }
  }
}
