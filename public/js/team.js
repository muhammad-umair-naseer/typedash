import { flag } from './countries.js';
import { escapeHtml, toast } from './ui.js';

/**
 * Team card on the home page: create a team, join with an invite code, see
 * the members and this season's standing, copy the invite link, leave.
 * Everything is one `team_*` message and one `team` reply.
 */
export class TeamCard {
  constructor(root, net, { onChanged }) {
    this.root = root;
    this.net = net;
    this.onChanged = onChanged;
    this.team = null;
    this.known = false;          // have we heard from the server about our team yet?
    this.pendingJoin = null;
    net.on('team', (m) => {
      this.team = m.team;
      this.known = true;
      if (m.unlocked && m.unlocked.length) toast('🛡️ Achievement: Squad up', 'success', 2600);
      this.render();
      if (this.onChanged) this.onChanged(m);
    });
    net.on('error', (m) => { if (m.team) toast(m.message, 'error', 3200); });
    net.on('hello_ok', () => { if (this.pendingJoin) { const c = this.pendingJoin; this.pendingJoin = null; net.send({ type: 'team_join', code: c }); } });
    root.addEventListener('submit', (e) => {
      e.preventDefault();
      const f = e.target;
      if (f.id === 'team-create-form') net.send({ type: 'team_create', name: f.name.value.trim(), tag: f.tag.value.trim().toUpperCase() });
      if (f.id === 'team-join-form') net.send({ type: 'team_join', code: f.code.value.trim().toUpperCase() });
    });
    root.addEventListener('click', async (e) => {
      const b = e.target.closest('button[data-act]');
      if (!b) return;
      if (b.dataset.act === 'leave') { if (confirm('Leave your team?')) net.send({ type: 'team_leave' }); }
      if (b.dataset.act === 'rotate') net.send({ type: 'team_rotate' });
      if (b.dataset.act === 'copy') {
        const link = `${location.origin}/app#team/${this.team.invite || ''}`;
        try { await navigator.clipboard.writeText(link); toast('Invite link copied — send it to a fast friend', 'success'); } catch (_) { toast(link, 'info', 6000); }
      }
    });
    this.render();
  }

  /** From a /#team/CODE link: join once we are identified. */
  join(code) {
    if (this.net.connected) this.net.send({ type: 'team_join', code });
    else this.pendingJoin = code;
  }

  render() {
    const t = this.team;
    if (!t) {
      this.root.innerHTML = `
        <div class="team-empty">
          <p class="hint">Every ranked point you earn also scores for your team. Make one, share the link, climb the team board together.</p>
          <form id="team-create-form" class="team-form">
            <input name="name" maxlength="24" minlength="3" placeholder="Team name" required aria-label="Team name">
            <input name="tag" maxlength="4" minlength="2" placeholder="TAG" pattern="[A-Za-z0-9]{2,4}" required aria-label="Team tag" class="team-tag-input">
            <button class="btn small primary" type="submit">Create</button>
          </form>
          <form id="team-join-form" class="team-form">
            <input name="code" maxlength="6" placeholder="Invite code" required aria-label="Invite code" class="team-tag-input wide">
            <button class="btn small" type="submit">Join</button>
          </form>
        </div>`;
      return;
    }
    const inviteRow = t.members.some((m) => m.owner && m.id === this.myId) || true;
    this.root.innerHTML = `
      <div class="team-head">
        <span class="team-tag">[${escapeHtml(t.tag)}]</span>
        <b>${escapeHtml(t.name)}</b>
        <span class="team-meta">${t.size}/${t.max} members · <a href="/t/${escapeHtml(t.id)}" target="_blank" rel="noopener">team page</a></span>
      </div>
      <div class="team-stats">
        <div><b>${t.season.points.toLocaleString()}</b><span>season pts</span></div>
        <div><b>${t.season.rank ? `#${t.season.rank}` : '—'}</b><span>season rank</span></div>
        <div><b>${t.allTime.points.toLocaleString()}</b><span>all time</span></div>
      </div>
      <div class="team-members">${t.members.slice(0, 8).map((m) => `<span class="team-member">${flag(m.country)} ${escapeHtml(m.name)}${m.owner ? ' 👑' : ''} <small>${m.season.toLocaleString()}</small></span>`).join('')}${t.members.length > 8 ? `<span class="team-member dim">+${t.members.length - 8} more</span>` : ''}</div>
      <div class="row team-actions">
        ${inviteRow ? '<button class="btn small" data-act="copy"><svg class="i" aria-hidden="true"><use href="#i-link"/></svg> Copy invite link</button>' : ''}
        <button class="btn small ghost" data-act="leave">Leave</button>
      </div>`;
  }
}
