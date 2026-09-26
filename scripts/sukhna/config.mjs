/* ------------------------------------------------------------------ *
 * Pipeline configuration.  Everything a re-run needs to be reproducible:
 * the area, the date, the grids, and every manual choice (each with where
 * it came from).  The world is flat, in real ENU metres (plan §3, §4).
 * ------------------------------------------------------------------ */

/** Overpass bounding box [south, west, north, east] (plan §3). */
export const BBOX = [30.72, 76.79, 30.77, 76.84];

export const OVERPASS = [
  'https://overpass-api.de/api/interpreter',
  'https://overpass.kumi.systems/api/interpreter',
];

/** Terrarium tiles (Mapzen / AWS Terrain Tiles), fetched per [bbox, zoom]. */
export const TERRAIN = {
  url: (z, x, y) => `https://s3.amazonaws.com/elevation-tiles-prod/terrarium/${z}/${x}/${y}.png`,
  sets: [
    { name: 'near', bbox: [30.70, 76.77, 30.80, 76.88], zoom: 13 }, // the lake basin grid
    { name: 'hills', bbox: [30.66, 76.72, 30.88, 77.00], zoom: 12 }, // the Shivalik front grid
    { name: 'ridges', bbox: [30.70, 76.70, 31.05, 77.15], zoom: 11 }, // far ridge rings (Kasauli, Morni)
  ],
};

/**
 * The promenade: the OSM way(s) chained, in order.  source: OSM
 * `way/1024118089`, highway=pedestrian, paved, foot=yes, bicycle=no,
 * motor_vehicle=no -- the walk on the dam from the Garden of Silence bridge
 * (east, s = 0) to the boat club viewpoint (west, s = L).
 */
export const PROMENADE_WAYS = [1024118089];

/** Grids, in ENU metres about the origin (the promenade midpoint). */
export const GRIDS = {
  // the lake basin: bbox of (lake + walk) grown by this margin, at this spacing
  near: { margin: 1300, step: 20 },
  // the Shivalik front, a fixed rectangle [e0, n0, e1, n1]
  hills: { rect: [-9000, -7000, 17000, 15000], step: 120 },
  // landuse classes over the near grid
  cover: { step: 10 },
};

/** Vector features are kept within this distance of the walk (m). */
export const KEEP = {
  buildingOutline: 350, // real footprint polygon (plus an oriented box for all)
  building: 1600,
  road: 1600,
  landuse: 99999, // clipped to the near grid instead
};

/** Far ridgeline rings: rays start where they leave the hill grid. */
export const RIDGES = {
  at: [0, 0.5, 1],
  eye: 4.2, // metres above the lake: walk (+2.5) plus eye height
  maxDist: 45000,
};

/** The walk centreline is smoothed and resampled at this spacing (m). */
export const SPINE_STEP = 4;

/**
 * The default morning (the user's decision): mid-January, the real clock,
 * the session opening at civil dawn, ~25 minutes before the real sunrise.
 * One constant; change the date here and re-run the build.
 */
export const DATE = { y: 2027, m: 1, d: 15 };
