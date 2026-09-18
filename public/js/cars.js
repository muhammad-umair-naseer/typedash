import { skinFor } from './skins.js';

let uid = 0;

/* Side-view bodies, facing right, in a 122x52 box. Wheels sit at x=30 and x=92. */
const BODIES = {
  sport: {
    body: 'M6 33 C6 27 10 24 16 23 L34 21 L46 10 C49 7 53 6 58 6 L84 6 C89 6 93 8 96 12 L104 21 L113 24 C117 25 119 28 119 32 L119 36 C119 39 117 40 114 40 L11 40 C8 40 6 38 6 36 Z',
    glass: 'M40 21 L49 12 C51 10 54 9 58 9 L80 9 C83 9 85 10 87 12 L94 21 Z',
    pillar: 'M67 9 L67 21',
    extra: '',
  },
  hatch: {
    body: 'M8 34 C8 28 12 25 18 24 L30 23 L36 12 C38 9 42 8 46 8 L88 8 C93 8 97 11 100 15 L107 24 L113 26 C117 27 119 30 119 34 L119 37 C119 39 117 40 114 40 L12 40 C9 40 8 38 8 36 Z',
    glass: 'M34 23 L39 13 C40 11 43 10 46 10 L86 10 C90 10 93 12 95 15 L100 23 Z',
    pillar: 'M64 10 L64 23',
    extra: '<rect x="22" y="12" width="12" height="3" rx="1.5" fill="rgba(0,0,0,.35)"/>',
  },
  muscle: {
    body: 'M6 34 C6 28 9 25 14 24 L32 22 L42 12 C44 9 47 8 51 8 L74 8 C78 8 81 10 83 13 L88 22 L112 24 C117 25 119 28 119 32 L119 36 C119 39 117 40 114 40 L11 40 C8 40 6 38 6 36 Z',
    glass: 'M36 22 L44 13 C45 11 48 10 51 10 L72 10 C75 10 77 11 79 13 L85 22 Z',
    pillar: 'M62 10 L62 22',
    extra: '<rect x="92" y="18" width="14" height="4" rx="1.5" fill="rgba(0,0,0,.45)"/><rect x="94" y="16" width="10" height="3" rx="1" fill="rgba(0,0,0,.3)"/>',
  },
  pickup: {
    body: 'M6 30 L6 36 C6 38 8 40 11 40 L114 40 C117 40 119 38 119 36 L119 30 C119 27 117 25 113 24 L104 22 L96 11 C94 8 91 7 87 7 L62 7 C58 7 56 9 56 12 L56 24 L12 26 C8 27 6 28 6 30 Z',
    glass: 'M60 22 L60 12 C60 10 61 9 63 9 L86 9 C88 9 90 10 91 12 L98 22 Z',
    pillar: 'M78 9 L78 22',
    extra: '<path d="M10 26 L52 24 L52 20 L10 21 Z" fill="rgba(0,0,0,.28)"/><rect x="8" y="28" width="46" height="2" fill="rgba(255,255,255,.18)"/>',
  },
  rocket: {
    body: 'M4 36 L4 33 C4 30 7 28 10 28 L36 27 L44 18 C47 14 51 13 56 13 L78 13 C83 13 87 15 90 19 L96 27 L114 29 C117 30 119 32 119 35 L119 37 C119 39 117 40 114 40 L9 40 C6 40 4 39 4 36 Z',
    glass: 'M42 27 L47 19 C49 16 52 15 56 15 L76 15 C79 15 82 16 84 19 L89 27 Z',
    pillar: 'M66 15 L66 27',
    extra: '<path d="M4 20 L22 20 L22 24 L12 24 L12 28 L6 28 Z" fill="var(--c)" stroke="rgba(0,0,0,.35)" stroke-width="1"/><path d="M4 20 L22 20 L22 22 L4 22 Z" fill="rgba(255,255,255,.35)"/>',
  },
};

const DECALS = {
  stripe: '<path d="M44 7 L52 7 L40 39 L32 39 Z M56 7 L62 7 L50 39 L44 39 Z" fill="rgba(255,255,255,.55)"/>',
  flames: '<path d="M10 32 L20 28 L24 32 L32 26 L36 31 L46 27 L44 33 L56 30 L52 35 L14 36 Z" fill="#ff9e00" opacity=".92"/><path d="M12 33 L20 30 L23 33 L31 29 L34 32 L42 30 L40 33 L16 35 Z" fill="#ffd166" opacity=".9"/>',
  checker: '<rect x="10" y="26" width="26" height="10" fill="url(#chk)" opacity=".9"/>',
  stars: '<path d="M22 15 l1.6 3.4 3.7.4-2.8 2.5.8 3.7-3.3-1.9-3.3 1.9.8-3.7-2.8-2.5 3.7-.4z" fill="#fff" opacity=".85"/><path d="M100 24 l1.2 2.5 2.7.3-2 1.8.6 2.7-2.5-1.4-2.5 1.4.6-2.7-2-1.8 2.7-.3z" fill="#fff" opacity=".8"/><path d="M60 32 l.9 1.9 2.1.2-1.6 1.4.5 2.1-1.9-1.1-1.9 1.1.5-2.1-1.6-1.4 2.1-.2z" fill="#fff" opacity=".7"/>',
};

/**
 * Side-view car for a skin id. Body colour comes from the CSS variable `--c`
 * on the lane. The `.nitro-flame` group is hidden until the lane gets the
 * `nitro` class.
 */
export function carSvg(skinId = 'dash') {
  const skin = skinFor(skinId);
  const b = BODIES[skin.body] || BODIES.sport;
  const id = `gloss-${++uid}`;
  const decal = skin.decal ? DECALS[skin.decal] || '' : '';
  return `
<svg viewBox="0 0 122 52" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
  <defs>
    <linearGradient id="${id}" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#fff" stop-opacity=".55"/>
      <stop offset=".45" stop-color="#fff" stop-opacity=".06"/>
      <stop offset="1" stop-color="#000" stop-opacity=".28"/>
    </linearGradient>
    <linearGradient id="${id}-fire" x1="1" y1="0" x2="0" y2="0">
      <stop offset="0" stop-color="#9be7ff"/>
      <stop offset=".35" stop-color="#ffd166"/>
      <stop offset=".7" stop-color="#ff7a00"/>
      <stop offset="1" stop-color="#ff2d55" stop-opacity="0"/>
    </linearGradient>
    <pattern id="chk" width="6" height="6" patternUnits="userSpaceOnUse">
      <rect width="3" height="3" fill="#fff"/><rect x="3" y="3" width="3" height="3" fill="#fff"/>
    </pattern>
  </defs>
  <g class="nitro-flame">
    <path d="M6 35 C-6 27 -20 31 -34 36 C-20 41 -6 45 6 37 Z" fill="url(#${id}-fire)" opacity=".95"/>
    <path d="M6 36 C-2 32 -10 34 -18 36 C-10 38 -2 40 6 36 Z" fill="#fff" opacity=".75"/>
  </g>
  <ellipse class="shadow" cx="62" cy="47" rx="54" ry="3.5" fill="rgba(0,0,0,.5)"/>
  <g class="car-body">
    <path d="${b.body}" fill="var(--c)"/>
    <path d="${b.body}" fill="url(#${id})"/>
    ${decal}
    ${b.extra}
    <path d="${b.glass}" fill="#d6f1ff" opacity=".92"/>
    <path d="${b.pillar}" stroke="var(--c)" stroke-width="2.2"/>
    <rect x="112" y="27" width="6.5" height="4" rx="1" fill="#fff5c2"/>
    <rect x="6" y="27" width="5" height="4" rx="1" fill="#ff3b3b"/>
    <path d="M13 36 H113" stroke="rgba(0,0,0,.28)" stroke-width="2"/>
  </g>
  <g class="wheel">
    <circle cx="30" cy="40" r="9.5" fill="#15151a"/>
    <circle cx="30" cy="40" r="5.2" fill="#d5d5df"/>
    <path d="M30 33 V47 M23 40 H37 M25 35 L35 45 M35 35 L25 45" stroke="#6b6b78" stroke-width="1.2"/>
  </g>
  <g class="wheel">
    <circle cx="92" cy="40" r="9.5" fill="#15151a"/>
    <circle cx="92" cy="40" r="5.2" fill="#d5d5df"/>
    <path d="M92 33 V47 M85 40 H99 M87 35 L97 45 M97 35 L87 45" stroke="#6b6b78" stroke-width="1.2"/>
  </g>
  <g class="exhaust">
    <circle cx="2" cy="37" r="2.5" fill="rgba(255,255,255,.35)"/>
    <circle cx="-5" cy="36" r="3.5" fill="rgba(255,255,255,.22)"/>
    <circle cx="-13" cy="35" r="4.5" fill="rgba(255,255,255,.1)"/>
  </g>
</svg>`;
}
