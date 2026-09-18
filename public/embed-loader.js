/* TypeDash embed loader.
 *   <script src="https://YOUR-TYPEDASH-HOST/embed.js" data-passage="trains" data-pacer="50"></script>
 * Drops a responsive TypeDash typing race right where the tag is. */
(function () {
  var me = document.currentScript;
  if (!me) return;
  var origin = new URL(me.src).origin;
  var q = new URLSearchParams();
  if (me.dataset.passage) q.set('passage', me.dataset.passage);
  if (me.dataset.pacer) q.set('pacer', me.dataset.pacer);
  q.set('ref', location.hostname || 'unknown');
  var frame = document.createElement('iframe');
  frame.src = origin + '/embed?' + q.toString();
  frame.title = 'TypeDash typing race';
  frame.setAttribute('loading', 'lazy');
  frame.style.cssText = 'width:100%;max-width:' + (me.dataset.width || '720px') + ';height:' + (me.dataset.height || '420px') + ';border:0;border-radius:16px;display:block;background:#f7f4ef;';
  frame.allow = 'clipboard-write';
  me.parentNode.insertBefore(frame, me.nextSibling);
  window.addEventListener('message', function (e) {
    if (e.origin !== origin || !e.data || e.data.type !== 'typedash:height' || e.source !== frame.contentWindow) return;
    frame.style.height = Math.max(240, Math.min(1200, e.data.height + 4)) + 'px';
  });
})();
