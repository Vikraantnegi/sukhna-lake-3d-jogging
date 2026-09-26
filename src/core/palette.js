/* Structure follows sakura-crossing's src/core/palette.js (one table for every
 * colour in the scene).  Copyright (c) 2026 Kenton Wang, MIT License -- see
 * THIRD_PARTY_LICENSES.md.  The colours themselves are Sukhna's: sampled
 * estimates from the photos in reference/ (see docs/plan.md §2), to be tuned
 * in the grade.
 *
 * This is the *base* palette, which is the bright-morning look (photo r2).
 * Phase 6 adds time-of-day keyframes on top of it (pre-dawn, sunrise, golden
 * hour, bright) and a registry of everything whose colour depends on the time.
 */
export const PAL = {
  // --- sky & atmosphere (r2: bright winter morning) ---
  skyTop: 0x6fa3f5,
  skyMid: 0xa9cdf5,
  skyHaze: 0xc9e0f7,
  cloud: 0xfbfaf6,
  cloudShade: 0xe2e6f0,
  fog: 0xc9dcee,           // morning haze; matches the sky's horizon so distance dissolves
  // ridge layers on the far shore (r6, r7): low-contrast blue-grey
  ridgeNear: 0x7d8aa3,
  ridgeFar: 0xa9b3c6,

  // --- light ---
  sun: 0xfff1d8,
  fill: 0xa9bdf5,
  hemiSky: 0xdcecff,
  hemiGround: 0xb6a6c6,

  // --- ink ---
  ink: 0x39324f,
  inkSoft: 0x4a4468,

  // --- ground (terrain vertex colours by OSM cover class) ---
  groundDry: 0xb3ad86,     // unclassified land: dry winter grass and earth
  grass: 0x7fa04f,         // embankment and verges (r2)
  grassDeep: 0x5f7a3a,
  scrub: 0x8a8f5a,         // Shivalik scrub forest, open ground
  golf: 0x8fb35a,
  built: 0xb9b1a3,         // city sectors: concrete, dust and street trees
  paved: 0x9c9ca3,
  pitch: 0xb48a62,
  wetland: 0x6f8f6a,
  lakeBed: 0x8a8a6e,
  ridgeRock: 0x9a9486,

  // --- promenade (r2, r8) ---
  asphalt: 0x8e9096,       // pale grey walk, no kerb paint
  cobble: 0x9a978d,        // parapet river cobbles
  cobbleLight: 0xb9b3a4,
  mortar: 0x6f6b63,
  pitching: 0xa5a39a,      // stone pitching on the embankment
  drawdown: 0xd8cdb5,      // cream boulders at the waterline
  drawdownWet: 0xa89f88,   // the damp line at the water's edge
  stoneDark: 0x7d7a72,
  concrete: 0xc9c4b8,      // Chandigarh béton brut, weathered
  concreteDark: 0x9e988c,
  lampPole: 0x3e4a46,
  benchFrame: 0x2f2f33,
  reed: 0x8a8a4e,
  reedDry: 0xb3a36a,
  palmFrond: 0x5f7f3a,
  path: 0xc2b49a,          // footways: compacted earth and pavers
  road: 0x6f7079,
  roadEdge: 0x8b8b90,

  // --- gardens and plaza (r1) ---
  paverRed: 0xc77d5e,
  paverRedDark: 0xb0664a,
  chainLink: 0x2f4a33,
  thatch: 0x5a4a3a,
  signBlue: 0x2f8fcf,
  benchWood: 0x8a4a32,

  // --- boat club (r7, r9, r2) ---
  jettyPaver: 0x8ea0b3,
  boatBlue: 0x3f7fd0,
  boatSky: 0x62a8e6,
  boatYellow: 0xf2c230,
  boatRed: 0xd23b35,
  boatOrange: 0xf08a2e,
  launchPink: 0xd84a6a,

  // --- water ---
  waterBright: 0x8c96a6,   // steel grey-mauve, bright morning (r2)
  waterEcho: 0x5d6b4a,     // treeline reflections (r2)
  waterKhaki: 0xc9b27a,    // turbid, at low sun (r8)

  // --- vegetation ---
  leaf: 0x5f7a3a,
  leafDeep: 0x3f5a2e,
  palmTrunk: 0xbdb8ad,
  trunk: 0x8a7a6a,

  // --- misc (used by the ported toon helpers) ---
  glassDark: 0x53627a,
  metal: 0xb8bcc6,
  metalDark: 0x878b96,
};
