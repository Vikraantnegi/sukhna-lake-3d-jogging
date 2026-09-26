/* ------------------------------------------------------------------ *
 * Who is out on the dam (plan §6): each type is a row of numbers.
 *
 *   body     ranges for the parametric body (people/body.js)
 *   dress    colour tables and clothing choices, picked per person
 *   gait     style for people/gait.js
 *   speed    [min, max] m/s on the walk; 0 for stationary types
 *   weight   how common, before time of day scales the whole crowd
 *   group    how many move together (students in pairs, couples)
 *   act      what stationary people do (stretch, yoga, laugh, sit, photo, vend)
 *
 * Colours are dress, not skin: skin tones come from one shared table.
 * ------------------------------------------------------------------ */

export const SKIN = [0x8d5a3b, 0xa06a45, 0xb07a55, 0xc08b63, 0x7a4b30, 0x9b6647];
export const HAIR = [0x1b1715, 0x2a2320, 0x3a302a, 0x6f6a66, 0xbdb8b2];

const BRIGHT = [0xe8542f, 0x3f7fd0, 0x2fa37a, 0xf2c230, 0xd84a6a, 0x8f6fb5, 0x2b3040, 0xf4f2ec];
const TRACK = [0x2b3040, 0x1f3a6e, 0x6e1f2b, 0x2f4f3a, 0x3a3a42, 0x5a2e6e];
const SALWAR = [0xd84a6a, 0xe07a9a, 0xf2c230, 0x2fa37a, 0x6f8fd0, 0xe8a060, 0xb03a5a, 0xf4f0e6];
const MUTED = [0x8a8a7a, 0x6b6a60, 0x9a9486, 0x4f5560, 0x7a6a58, 0xcfc8b8];
const TURBAN = [0x1f3a6e, 0xd23b35, 0xf08a2e, 0x2b2b2b, 0xf2c230, 0xe07a9a, 0x2fa37a];
const SHOES = [0xf2f2f2, 0x2b2b2b, 0xd9d9d9, 0x3f7fd0, 0xe8542f];

export const TYPES = {
  jogger_fast: {
    body: { height: [1.68, 1.84], shoulder: [0.22, 0.25], girth: [0.9, 1.0] },
    dress: { top: BRIGHT, bottom: [0x1f2430, 0x2b3040, 0x1b1d24], shoe: SHOES, sleeves: ['short', 'none'], legs: ['shorts', 'long'], headwear: ['none', 'none', 'cap', 'patka'] },
    gait: { stride: 1.1 }, speed: [3.2, 3.9], weight: 3, group: 1,
  },
  jogger: {
    body: { height: [1.58, 1.8], shoulder: [0.2, 0.24], girth: [0.95, 1.1] },
    dress: { top: BRIGHT, bottom: TRACK, shoe: SHOES, sleeves: ['short', 'long'], legs: ['long', 'shorts'], headwear: ['none', 'none', 'cap', 'patka'] },
    gait: {}, speed: [2.4, 3.1], weight: 5, group: 1,
  },
  students: {
    body: { height: [1.6, 1.8], shoulder: [0.2, 0.23], girth: [0.9, 1.0] },
    dress: { top: BRIGHT, bottom: TRACK, shoe: SHOES, sleeves: ['short'], legs: ['long', 'shorts'], headwear: ['none', 'none', 'cap'] },
    gait: {}, speed: [2.3, 2.8], weight: 3, group: 2,
  },
  brisk: {
    body: { height: [1.58, 1.8], shoulder: [0.2, 0.25], girth: [1.0, 1.2] },
    dress: { top: [...BRIGHT, ...MUTED], bottom: TRACK, shoe: SHOES, sleeves: ['short', 'long'], legs: ['long'], headwear: ['none', 'cap'] },
    gait: { armSwing: 1.4, stiff: 0.2 }, speed: [1.5, 1.85], weight: 5, group: 1,
  },
  elderly_couple: {
    body: { height: [1.52, 1.72], shoulder: [0.2, 0.23], girth: [1.05, 1.25], stoop: [0.08, 0.18] },
    dress: { top: [...MUTED, 0xe6e0d4], bottom: MUTED, shoe: [0x2b2b2b, 0xd9d9d9], sleeves: ['long'], legs: ['long'], headwear: ['none', 'none', 'monkey'], hair: [3, 4] },
    gait: { stride: 0.7, armSwing: 0.5, handsBehind: true, bounce: 0.4 }, speed: [0.85, 1.1], weight: 2, group: 2,
  },
  uncle: {
    body: { height: [1.62, 1.78], shoulder: [0.22, 0.25], girth: [1.2, 1.4] },
    dress: { top: TRACK, bottom: TRACK, shoe: SHOES, sleeves: ['long'], legs: ['long'], headwear: ['none', 'cap', 'monkey'], hair: [0, 3, 4] },
    gait: { armSwing: 1.5, stiff: 0.35 }, speed: [1.3, 1.6], weight: 4, group: 1,
  },
  auntie: {
    body: { height: [1.5, 1.66], shoulder: [0.19, 0.22], girth: [1.1, 1.35] },
    dress: { top: SALWAR, bottom: SALWAR, shoe: [0xf2f2f2, 0xd9d9d9, 0x3f7fd0], sleeves: ['long'], legs: ['long'], long: true, headwear: ['dupatta', 'dupatta', 'none'] },
    gait: { armSwing: 1.1 }, speed: [1.1, 1.45], weight: 4, group: 1,
  },
  sikh_patka: {
    body: { height: [1.65, 1.85], shoulder: [0.22, 0.25], girth: [0.95, 1.15] },
    dress: { top: BRIGHT, bottom: TRACK, shoe: SHOES, sleeves: ['short', 'long'], legs: ['long', 'shorts'], headwear: ['patka'], headwearColor: TURBAN },
    gait: {}, speed: [2.4, 3.2], weight: 2, group: 1,
  },
  sikh_turban: {
    body: { height: [1.66, 1.84], shoulder: [0.22, 0.26], girth: [1.05, 1.3] },
    dress: { top: [0xf4f2ec, ...MUTED, ...TRACK], bottom: [0xf4f2ec, ...TRACK], shoe: SHOES, sleeves: ['long'], legs: ['long'], long: [true, false], headwear: ['turban'], headwearColor: TURBAN },
    gait: { armSwing: 1.2, stiff: 0.15 }, speed: [1.3, 1.7], weight: 3, group: 1,
  },
  dog_walker: {
    body: { height: [1.6, 1.78], shoulder: [0.2, 0.24], girth: [1.0, 1.2] },
    dress: { top: [...MUTED, ...BRIGHT], bottom: TRACK, shoe: SHOES, sleeves: ['long'], legs: ['long'], headwear: ['none', 'cap'] },
    gait: { armSwing: 0.6 }, speed: [1.1, 1.3], weight: 1, group: 1, dog: true,
  },
  // ------------------------- stationary -------------------------
  stretcher: { body: { height: [1.6, 1.82] }, dress: { top: BRIGHT, bottom: TRACK, shoe: SHOES, sleeves: ['short'], legs: ['long', 'shorts'], headwear: ['none', 'patka'] }, gait: {}, speed: [0, 0], act: 'stretch' },
  yoga: { body: { height: [1.52, 1.78], girth: [0.95, 1.2] }, dress: { top: [0xf4f2ec, 0xe8a060, ...SALWAR], bottom: [0xf4f2ec, ...TRACK], shoe: [0xc08b63], sleeves: ['short', 'long'], legs: ['long'], headwear: ['none'] }, gait: {}, speed: [0, 0], act: 'yoga' },
  laugh: { body: { height: [1.55, 1.78], girth: [1.05, 1.35], stoop: [0.02, 0.12] }, dress: { top: [0xf4f2ec, ...MUTED, ...SALWAR], bottom: [...MUTED, ...TRACK], shoe: SHOES, sleeves: ['long'], legs: ['long'], headwear: ['none', 'monkey', 'turban', 'dupatta'], headwearColor: TURBAN, hair: [0, 3, 4] }, gait: {}, speed: [0, 0], act: 'laugh' },
  sitter: { body: { height: [1.55, 1.8], girth: [1.0, 1.3] }, dress: { top: [...MUTED, ...SALWAR], bottom: MUTED, shoe: SHOES, sleeves: ['long'], legs: ['long'], headwear: ['none', 'monkey', 'turban', 'dupatta'], headwearColor: TURBAN, hair: [0, 3, 4] }, gait: {}, speed: [0, 0], act: 'sit' },
  photographer: { body: { height: [1.65, 1.8] }, dress: { top: [0x3a3f48, 0x6b7a5a], bottom: [0x2b3040], shoe: [0x2b2b2b], sleeves: ['long'], legs: ['long'], headwear: ['cap'] }, gait: {}, speed: [0, 0], act: 'photo' },
  vendor: { body: { height: [1.62, 1.75], girth: [1.0, 1.2] }, dress: { top: [0xf4f2ec, 0xcfc8b8], bottom: [0x6b6a60], shoe: [0x2b2b2b], sleeves: ['long'], legs: ['long'], headwear: ['none', 'monkey'] }, gait: {}, speed: [0, 0], act: 'vend' },
};

/** Types that walk or run the walk, for spawning. */
export const MOVERS = ['jogger_fast', 'jogger', 'students', 'brisk', 'elderly_couple', 'uncle', 'auntie', 'sikh_patka', 'sikh_turban', 'dog_walker'];

/** Build a body row for one person of a type, from a seeded rng. */
export function personRow(type, rng) {
  const T = TYPES[type];
  const pick = (v, d) => (Array.isArray(v) ? v[Math.floor(rng() * v.length)] : v ?? d);
  const range = (r, d) => (Array.isArray(r) ? r[0] + (r[1] - r[0]) * rng() : d);
  const b = T.body || {}, dr = T.dress || {};
  const hairIdx = dr.hair ? pick(dr.hair) : Math.floor(rng() * 3);
  return {
    height: range(b.height, 1.7), shoulder: range(b.shoulder, 0.22), girth: range(b.girth, 1), stoop: range(b.stoop, 0),
    skin: SKIN[Math.floor(rng() * SKIN.length)], hair: HAIR[hairIdx],
    top: pick(dr.top, 0x888888), bottom: pick(dr.bottom, 0x333333), shoe: pick(dr.shoe, 0xeeeeee),
    sleeves: pick(dr.sleeves, 'long'), legs: pick(dr.legs, 'long'), long: pick(dr.long, false), tights: 0x1b1d24,
    headwear: pick(dr.headwear, 'none'), headwearColor: pick(dr.headwearColor, 0xd23b35), dupattaColor: pick(SALWAR),
  };
}
