/**
 * Car skins. Each skin = a body shape + an optional decal. Skins unlock with
 * level (see profile.js) and are purely cosmetic: every racer's chosen skin is
 * broadcast in room state so the whole lobby sees your garage pick.
 *
 * Keep the id list in sync with SKINS in server/index.js.
 */
export const SKINS = [
  { id: 'dash',    name: 'Dash',      body: 'sport',  decal: null,      unlock: 1,  blurb: 'Where everyone starts.' },
  { id: 'bolt',    name: 'Bolt',      body: 'sport',  decal: 'stripe',  unlock: 2,  blurb: 'Racing stripes. Officially 3% faster.' },
  { id: 'hatch',   name: 'Hatch',     body: 'hatch',  decal: null,      unlock: 3,  blurb: 'Small, round, unbothered.' },
  { id: 'muscle',  name: 'Muscle',    body: 'muscle', decal: null,      unlock: 5,  blurb: 'Hood scoop included.' },
  { id: 'flame',   name: 'Inferno',   body: 'muscle', decal: 'flames',  unlock: 7,  blurb: 'For people who never miss a key.' },
  { id: 'pickup',  name: 'Hauler',    body: 'pickup', decal: null,      unlock: 9,  blurb: 'Carries all your typos in the back.' },
  { id: 'checker', name: 'Podium',    body: 'sport',  decal: 'checker', unlock: 12, blurb: 'Earned on the finish line.' },
  { id: 'rocket',  name: 'Rocket',    body: 'rocket', decal: null,      unlock: 15, blurb: 'Rear wing. Zero downforce, all attitude.' },
  { id: 'nova',    name: 'Nova',      body: 'rocket', decal: 'stars',   unlock: 20, blurb: 'The endgame ride.' },
];

export const SKIN_BY_ID = Object.fromEntries(SKINS.map((s) => [s.id, s]));

export function skinFor(id) {
  return SKIN_BY_ID[id] || SKINS[0];
}
