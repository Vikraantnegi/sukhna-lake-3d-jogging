/* ------------------------------------------------------------------ *
 * Pipeline configuration.  Everything a re-run needs to be reproducible:
 * the area, the date, the tolerances, and every manual choice (each with
 * where it came from).
 * ------------------------------------------------------------------ */

/** Overpass bounding box [south, west, north, east] (plan §3). */
export const BBOX = [30.72, 76.79, 30.77, 76.84];

export const OVERPASS = [
  'https://overpass-api.de/api/interpreter',
  'https://overpass.kumi.systems/api/interpreter',
];

/** Terrarium tiles (Mapzen / AWS Terrain Tiles). */
export const TERRAIN = {
  url: (z, x, y) => `https://s3.amazonaws.com/elevation-tiles-prod/terrarium/${z}/${x}/${y}.png`,
  // Shivalik front, Morni and Kasauli ridges (plan §3)
  bbox: [30.70, 76.70, 31.05, 77.15],
  zoom: 11,
  // finer tiles around the lake, for the hill field
  nearBbox: [30.72, 76.79, 30.80, 76.88],
  nearZoom: 13,
};

/**
 * The promenade: the OSM way(s) chained into the loop, in order.  source:
 * OSM `way/1024118089`, highway=pedestrian, paved, foot=yes, bicycle=no,
 * motor_vehicle=no -- the walk on the dam from the Garden of Silence
 * bridge (east) to the boat club viewpoint (west).  The loop runs east to
 * west so the lake is at +z without mirroring the map (plan, Progress).
 */
export const PROMENADE_WAYS = [1024118089];

/** The stylised stretch that closes the loop (plan §4). */
export const L_JOIN = 40;

/** Straightening map (lib/straighten.mjs). */
export const MAP = {
  Rb: 8000, // radius of the mapped disc around the promenade's chord midpoint
  levels: [100, 25, 5],
  fineMargin: 450, // fine-grid margin around the lake + promenade
  farShoreZ: 170, // the lake's median far-shore distance lands at this z
};

/** Planet lattices written into the data file. */
export const LATTICE = {
  cover: { dx: 5, dz: 5, z0: -320, z1: 320 },
  dem: { dx: 8, dz: 8, z0: 40, z1: 360 },
};

/** Ridgeline viewpoints (fractions of the promenade) and distance bands. */
export const RIDGES = {
  at: [0, 0.25, 0.5, 0.75, 1],
  eye: 7.1, // metres above the lake: promenade crest (+5.5) plus eye height
  layers: [
    { name: 'near', d0: 400, d1: 4000 },
    { name: 'mid', d0: 4000, d1: 12000 },
    { name: 'far', d0: 12000, d1: 40000 },
  ],
};

/**
 * The default morning (the user's decision): mid-January, the real clock,
 * the session opening about 25 minutes before the real sunrise.
 * One constant; change the date here and re-run the build.
 */
export const DATE = { y: 2027, m: 1, d: 15 };
