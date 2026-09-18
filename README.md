# ⚡ TypeDash

A real-time multiplayer typing **game** — not a typing test. You race four other cars
through the same passage while chaining combos, charging nitro and grabbing golden
words, and every race feeds a worldwide ranking system with daily streaks, monthly
seasons and teams. When nobody is around you practise against a pacer or the ghost
of the world record, or take on the daily challenge everybody else is typing.

Node.js + WebSockets on the server, vanilla ES modules on the client. One runtime
dependency (`ws`) plus an optional image rasteriser for share cards, no build step,
no framework, no sign-up.

```bash
npm install
npm start          # http://localhost:4000
```

**Design rule: the load is on the client.** Practice runs, the daily challenge, ghost
playback and the embeddable widget all run entirely in the browser; the server sees
one message when a run ends. Only live multiplayer needs the server to tick, and even
there it only relays 10 Hz snapshots. Rendered pages and cards are cached.

---

## What it does

**The race.** Up to 5 racers share one passage. Everyone's car moves in real time,
the local car is predicted instantly and remote cars are interpolated, so the track
glides instead of stuttering regardless of ping. Empty seats fill with bots so the
first visitor never stares at an empty lobby. Rooms are matched by **language and
mode** (prose / code / numbers).

**The game layer.**

| Mechanic | Rule |
| --- | --- |
| Combo | Consecutive correct keys. Tiers at 10 / 25 / 50 / 100 raise the score multiplier; one wrong key resets it. |
| Nitro | Every flawless word charges the meter. Full meter fires a boost: double score, flames on your car, and every other player in the room sees it. |
| Golden words | Three words per race glow gold. Type one with no mistakes for a big bonus. |
| Emotes & revving | Tap a reaction mid-race; mash keys before the start to rev your engine. |
| Garage | Nine car skins unlocked by level, shown to everyone in the lobby. |

**Practice mode (runs in your browser).** Hit *Practice solo* and you are typing
within two seconds: no lobby, no waiting, no socket traffic during the run. Race a
fixed-speed pacer (35 to 110 WPM, or your own best), the **ghost of the world
record** on that passage, or your own personal best. When you finish, the browser
sends the server one result with a progress timeline; the server checks it against
the typing-rate ceiling and the timestamp it took when the run started, then records
it. Practice keeps your daily streak alive and counts your typing volume, but it
never awards ranked points and never touches the racing boards — those stay about
racing.

**Daily challenge.** One passage per UTC day, the same for everyone, with the same
golden words (a seeded pick). Everybody plays it in practice mode; your first
verified finished run is the one that counts, so it is one shot, like a crossword.
Today's board lives next to the world rankings, the pacer is the replay of today's
leader, and a daily streak grows for every consecutive day you complete it.

**Ghost replays.** Every verified finished run (multiplayer, practice or daily) leaves
a progress timeline. The fastest per passage is the world record; each account keeps
its best on its last eight passages. Ghosts are played back client-side as a
translucent car — "beat my ghost" links from share cards put a friend in a race
against your exact run.

**Progression and ranking.**

- **Ranked points** are computed *server-side* from validated race stats (distance,
  WPM, accuracy, placement, golden words, best combo) and multiplied by your streak
  bonus. The client's score/combo/nitro counters are cosmetic.
- **Worldwide boards**: Points, Speed, Combo, Wins, Streak, Golden, plus Daily, Teams
  and Countries — each in a **global** or **your country** scope, with **All time /
  This season / This week / Today** windows where they make sense. Your own row is
  always returned, even if you're rank 4,812.
- **Seasons**: the points race restarts every calendar month. When a month ends the
  season is archived with ranks and everyone in the top 100 gets a badge; all-time
  points are untouched, so a newcomer always has a board they can climb this month.
- **Daily streaks**: play on consecutive days to build a streak. Each day adds +5% to
  every point you earn, capped at +50%. Miss a day and it resets. Practice counts.
- **Achievements** (40) are evaluated on the server, so they follow your account.
- **Rivals**: every pair of humans who race together keeps a permanent head-to-head
  record.
- **Teams**: create one, share the invite link, and every ranked point a member earns
  counts for the team. Tags show next to names in every lobby. Countries work the
  same way with no setup — every point also counts for your flag.

**Sharing.** Every settled result can become a share page (`/r/:id`) with a rendered
card that unfurls in Discord, WhatsApp or X with your numbers on it; profiles
(`/u/:id`) and teams (`/t/:id`) have pages and cards too. Practice share pages link to
racing the sharer's ghost.

**Reminders.** Opt in from the streak box and the server sends a Web Push nudge in
your evening if your streak is about to end, and (optionally) in the morning when the
daily is up. Implemented on Node's `crypto` — no dependency.

**Playing with friends.** Create a private room, share the invite link (`/#CODE`), and
race. Private rooms are **friendlies**: they don't award ranked points (so the global
board stays an open field), but they *do* keep your streak alive, update your
head-to-head records, and track a running series score for the room. Flip
`RANKED_PRIVATE=1` if you'd rather have them count.

**Put it on your site.** One script tag embeds a self-contained race that links back:

```html
<script src="https://your-host/embed.js" data-passage="trains" data-pacer="50"></script>
```

**Accounts without sign-up.** On first connect the server mints an account id plus a
secret token; the browser stores them and replays them on every connect. Only the
token's SHA-256 hash is stored server-side. Everything persists to a JSON file with
atomic writes. The game installs as a PWA and works on phones (the keyboard is
raised inside a tap so it is ready at GO).

---

## Architecture

```
server/
  index.js         HTTP: static, API, server-rendered pages, cards; WebSocket router
  Room.js          race state machine, snapshots, anti-cheat, race settlement
  RoomManager.js   matchmaking by language/mode, room lifecycle, tick loop
  Player.js Bot.js racer models (bots simulate human pacing: bursts, typo pauses, nitro)
  accounts.js      identity, points, streaks, seasons counters, achievements, rivals
  leaderboards.js  boards (category × window × scope) with caching, ranks, external sources
  achievements.js  achievement catalogue (scoped: race / solo / daily / season / team / any)
  passages.js      catalogue loader; passages/*.js hold the original texts per language/mode
  solo.js          practice runs: start stamp + one-shot validation of the submitted result
  daily.js         daily challenge: seeded passage per day, one scored attempt, boards
  ghosts.js        ghost timelines: world records + bounded personal bests
  seasons.js       monthly season rollover, archive, badges
  teams.js         teams and country standings (aggregated boards)
  share.js         result ids → share pages; og.js renders the 1200×630 cards (SVG → PNG)
  pages.js         server-rendered HTML: share/profile/team pages, leaderboard, practice, daily, embed
  notify.js        Web Push: VAPID + RFC 8291 encryption, reminder scheduler
  countries.js progression.js   server copies of client tables (parity-tested)
  fonts/           Inter + Space Grotesk (OFL) for deterministic card rendering
  store.js         JSON persistence: in-memory dataset, debounced atomic flush
  config.js        every tunable, overridable by env var
public/
  js/main.js       orchestrator      js/net.js      socket + backoff reconnect
  js/solo.js       practice engine   js/daily.js    daily strip
  js/share.js      share dialog      js/team.js     team card
  js/push.js       reminders         js/embed.js    the embeddable widget
  js/clock.js      NTP-style sync    js/interp.js   snapshot interpolation
  js/track.js      lanes and cars    js/typing.js   passage rendering + word tracking
  js/game.js       combo/nitro/score js/account.js  identity + level curve
  js/boards.js     ranking UI        js/skins.js    car catalogue
  js/cars.js background.js confetti.js audio.js countries.js ui.js
  sw.js manifest.webmanifest icons/  PWA shell (stale-while-revalidate assets, push handlers)
  embed-loader.js  served as /embed.js
test/                                one end-to-end suite per module (see Testing)
scripts/make-icons.js                regenerates public/icons from the bolt mark
```

### Keeping the track smooth

1. The server owns the race. It ticks at 10 Hz and broadcasts a compact snapshot
   (`{id, chars, wpm, accuracy, finished, rank, nitro, score}` per racer) stamped with
   **server time**.
2. Clients estimate the server clock NTP-style (ping/pong, best-half-RTT offset,
   eased), so a 300 ms player and a 20 ms player see "GO" at the same instant.
3. Remote racers render at `serverNow − 150 ms`, interpolated between the two
   bracketing snapshots, with bounded forward extrapolation if one goes missing.
4. Your own car is predicted locally on every keystroke and eased exponentially, so
   typing feels instant while everyone else stays perfectly smooth.
5. Progress uploads are throttled to 25 Hz, with a 250 ms heartbeat so a dropped
   packet can never strand your car short of the line.

Practice runs keep their own local clock and never touch the socket while racing:
the pacer and ghost are pure functions of elapsed time.

### Anti-cheat

The server recomputes everything that matters: progress is clamped to the passage,
rate-limited to `MAX_CPS` (~360 WPM), and WPM/accuracy are derived from the server's
own clock. A modified client can inflate its cosmetic score, never its position,
placement or ranked points.

Practice and daily runs are validated after the fact with the same ceiling: the
submitted timeline must be monotonic and never exceed `MAX_CPS` between samples, the
reported time cannot exceed the time since the server stamped GO, and the numbers the
account keeps (WPM, accuracy) are recomputed from chars, time and keystrokes. Only
*verified* runs (stamped, with a timeline) count for the daily board and ghost records.

---

## Protocol

**Client → server:** `hello {name, country, skin, accountId, token}` ·
`quick {lang, category}` · `create {lang, category}` · `join {code}` · `leave` ·
`start {bots}` · `progress {c,t,k,e,n,s,x,g,z}` · `chat {text}` · `emote {e}` · `rev` ·
`board {category, window, scope}` · `ping {t}` ·
`solo_start {passageId, mode}` · `solo_done {passageId, mode, chars, time, keystrokes, errors, golden, bestCombo, nitros, score, pacerWpm, pacerKind, timeline}` ·
`share {resultId}` · `team_create {name, tag}` · `team_join {code}` · `team_leave` · `team_rotate` · `team_info` ·
`push_subscribe {subscription, prefs, tzOffset}` · `push_unsubscribe {endpoint}`

**Server → client:** `welcome {id, serverTime, online, achievements, boards, config}` ·
`account {id, token, created, profile, standings}` · `hello_ok` · `room {...full state}` ·
`snap {t, p[]}` · `finished {...}` ·
`race_result {points, ranked, streak, unlocked, profile, standings, series, resultId, ghost, solo?, daily?}` ·
`board {category, window, scope, entries, me, inTop, total}` · `share {id, url, image, text}` ·
`team {team, unlocked, profile}` · `push {subscribed, devices, prefs}` ·
`chat` · `emote` · `rev` · `player_left` · `left` · `online` · `pong` · `error`

`room` is a single authoritative message used for every transition, so a late joiner
or a reconnecting client resyncs from one payload. A practice run emits the same
`room` / `finished` messages locally (flagged `solo: true`), so the whole race screen
is shared.

### HTTP

| Path | What |
| --- | --- |
| `/api/passages` | the catalogue (cached, ETag) — what practice mode and the widget pull |
| `/api/daily[?me=]` `/api/ghost?passage=[&me=]` `/api/records` `/api/season[?me=]` `/api/team/:id` `/api/push/key` `/api/board` `/api/stats` | JSON |
| `/leaderboard` `/leaderboard/:CC` `/practice` `/practice/:id` `/daily` | server-rendered, crawlable pages (30–60 s cache) |
| `/u/:id` `/t/:id` `/r/:id` | profile, team and share pages with Open Graph / Twitter cards |
| `/og/site.png` `/og/daily.png` `/og/u/:id.png` `/og/r/:id.png` | rendered cards (PNG with `@resvg/resvg-js`, SVG without) |
| `/embed` `/embed.js` | the widget and its loader |
| `/robots.txt` `/sitemap.xml` `/manifest.webmanifest` `/sw.js` | discovery + PWA |

Unknown paths still load the app but answer **404**, so search engines never index
junk URLs.

---

## Configuration

Everything in `server/config.js` reads from the environment.

| Variable | Default | Meaning |
| --- | --- | --- |
| `PORT` | 4000 | HTTP/WS port |
| `DATA_FILE` | `data/typedash.json` | where accounts, rankings, ghosts, shares and seasons persist |
| `PUBLIC_ORIGIN` | *(from the request)* | absolute origin for cards, canonical URLs and the sitemap, e.g. `https://typedash.app` |
| `TICK_MS` | 100 | snapshot rate (10 Hz) |
| `MAX_PLAYERS` | 5 | racers per room (humans + bots) |
| `BOT_FILL_TO` | 4 | bots top a public room up to this many racers |
| `LOBBY_WAIT_MS` | 12000 | how long a public lobby waits for humans |
| `COUNTDOWN_MS` | 5000 | countdown before GO |
| `RESULTS_MS` | 12000 | results screen before the next race |
| `AFTER_FIRST_FINISH_MS` | 60000 | race ends this long after the winner |
| `MAX_CPS` | 30 | accepted typing-rate ceiling (~360 WPM), also for submitted practice runs |
| `MAX_PAYLOAD` | 16384 | largest accepted socket message |
| `BONUS_WORDS` | 3 | golden words per race |
| `RANKED_PRIVATE` | `0` | set `1` to make private rooms award ranked points |
| `BOARD_SIZE` | 25 | rows per ranking board |
| `SOLO_STREAK` | `1` | practice runs keep the daily streak alive (`0` to disable) |
| `SOLO_START_SLACK_MS` | 2500 | tolerance between the start stamp and a submitted run's time |
| `DAILY_EPOCH` | `2026-09-01` | the day of Daily #1 |
| `DAILY_ATTEMPTS` | 1 | scored attempts per day (1 = your first finished run counts) |
| `DAILY_KEEP_DAYS` | 60 | days of daily results kept on disk |
| `SEASON_EPOCH` | `2026-09` | the month of Season 1 |
| `SEASON_KEEP` | 24 | archived seasons kept |
| `SHARE_KEEP` | 5000 | newest share links kept |
| `TEAM_MAX_MEMBERS` | 50 | members per team |
| `VAPID_SUBJECT` | `mailto:hello@typedash.local` | contact for push services |
| `VAPID_PUBLIC` / `VAPID_PRIVATE` | *(generated)* | push keys; generated into the data file when unset |
| `PUSH_TICK_MS` | 600000 | reminder scheduler cadence |
| `PUSH_STREAK_HOUR` / `PUSH_DAILY_HOUR` | 18 / 10 | local hours for the streak and daily reminders |

---

## Testing

```bash
npm test              # every suite below, in order
npm run test:race     # race lifecycle, anti-cheat, private rooms, chat
npm run test:rank     # points, boards, streaks, friendlies, persistence, reconnect
npm run test:solo     # practice submissions: validation, rejections, board isolation
npm run test:daily    # seeded daily, one scored attempt, daily board + streak
npm run test:ghost    # timelines from races/practice, records, bounded PBs, leader ghost
npm run test:share    # result ids, share pages + cards, profile pages, level-curve parity
npm run test:pages    # leaderboard/practice/daily pages, robots, sitemap, home OG tags
npm run test:seasons  # monthly counters, rollover archive, badges
npm run test:teams    # create/join/leave, team + country boards, trophies
npm run test:lang     # catalogue, language-aware matchmaking, polyglot
npm run test:push     # RFC 8291 vector, VAPID, deliveries to a fake push service, scheduler
npm run test:browser  # real Chrome: practice, share, ghosts, daily, languages, teams
npm run test:mobile   # iPhone emulation: keyboard readiness, layout, PWA surface
npm run test:embed    # the widget inside a third-party iframe
npm run simulate -- 8 # 8 simulated players against localhost (load test)
```

The three browser suites drive the locally installed Chrome through `puppeteer-core`
(a dev dependency; nothing is downloaded) and skip themselves when no Chrome is
found. `test/simulate.js` also takes `URL=wss://your-host` and `RACES=n`. Simulated
players create real accounts, so point a load test at a throwaway `DATA_FILE`.

---

## Deploying

Any host that supports WebSockets works — Render, Railway, Fly.io, a VPS behind nginx.
Things to get right:

1. **Persist the data file.** Mount a volume and set `DATA_FILE` to a path on it
   (the Dockerfile uses `/data`). Without it, rankings, ghosts, seasons and the
   generated push keys reset on every redeploy.
2. **Serve over HTTPS.** The client picks `wss://` automatically on an HTTPS origin,
   so the proxy in front just needs `Upgrade`/`Connection` headers passed through.
   Web Push and PWA installation require HTTPS too.
3. **Set `PUBLIC_ORIGIN`** so cards, canonical URLs and the sitemap carry your real
   domain even behind a proxy (`X-Forwarded-Proto`/`Host` are honoured otherwise).
4. **Run exactly one instance.** Rooms, the tick loop and matchmaking live in that
   process's memory, and accounts live in one JSON file. Two instances behind a load
   balancer means two separate worlds: players on different instances never meet, and
   both processes write the same data file. Scale up (a bigger box), not out — the tick
   is 10 Hz over five racers, so one core carries a lot of rooms. Going wider would mean
   moving rooms behind a shared bus and the store into Postgres/Redis first.
5. **Cards need the optional rasteriser.** `npm install` pulls `@resvg/resvg-js`
   (prebuilt for Linux, macOS, Windows, including Alpine/musl). If it is missing the
   cards are served as SVG, which some unfurlers ignore. Fonts are bundled, so
   rendering needs no system fonts.

```bash
docker build -t typedash .
docker run -p 4000:4000 -e PUBLIC_ORIGIN=https://typedash.example -v typedash-data:/data typedash
```

`GET /healthz` for liveness, `GET /api/stats` for online/room/account/embed counts,
and `GET /api/board?category=points&window=all&scope=global` to read any board over HTTP.

---

## Ideas worth building next

- Tournaments: scheduled brackets with a fixed passage set and a bracket page.
- Spectating: watch a live room from its share link.
- Per-language daily challenges and country-vs-country weekend events.
- Typing lessons that feed the same engine: a guided ladder from home row to code.

MIT licensed. Passages are original writing for this game.
