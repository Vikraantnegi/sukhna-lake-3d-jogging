/* ------------------------------------------------------------------ *
 * The real sun, from the NOAA solar-position equations (the ones behind
 * the NOAA Solar Calculator; accurate to well under a degree between
 * 1800 and 2100).  No dependencies, so the build scripts in
 * scripts/sukhna/ import this same file.
 *
 * Angles in degrees.  Azimuth is measured clockwise from true north, so
 * 90 is east.  Elevation includes a standard refraction correction.
 * ------------------------------------------------------------------ */

const D2R = Math.PI / 180;
const R2D = 180 / Math.PI;

/** Sukhna Lake: the middle of the dam promenade. */
export const SUKHNA = { lat: 30.7365, lon: 76.8185, tz: 5.5 };

/** Julian day for a JS Date (UTC based). */
function julianDay(date) {
  return date.getTime() / 86400000 + 2440587.5;
}

/**
 * Sun position for a moment (a JS Date, i.e. an absolute instant) at a
 * place.  Returns { azimuth, elevation } in degrees, plus the declination
 * and the equation of time (minutes) for callers that want them.
 */
export function sunPosition(date, lat = SUKHNA.lat, lon = SUKHNA.lon) {
  const jc = (julianDay(date) - 2451545) / 36525;
  const L0 = (280.46646 + jc * (36000.76983 + jc * 0.0003032)) % 360;
  const M = 357.52911 + jc * (35999.05029 - 0.0001537 * jc);
  const e = 0.016708634 - jc * (0.000042037 + 0.0000001267 * jc);
  const C = Math.sin(M * D2R) * (1.914602 - jc * (0.004817 + 0.000014 * jc)) +
    Math.sin(2 * M * D2R) * (0.019993 - 0.000101 * jc) + Math.sin(3 * M * D2R) * 0.000289;
  const trueLong = L0 + C;
  const omega = 125.04 - 1934.136 * jc;
  const lambda = trueLong - 0.00569 - 0.00478 * Math.sin(omega * D2R);
  const eps0 = 23 + (26 + (21.448 - jc * (46.815 + jc * (0.00059 - jc * 0.001813))) / 60) / 60;
  const eps = eps0 + 0.00256 * Math.cos(omega * D2R);
  const decl = Math.asin(Math.sin(eps * D2R) * Math.sin(lambda * D2R)) * R2D;
  const y = Math.tan((eps / 2) * D2R) ** 2;
  const eqTime = 4 * R2D * (y * Math.sin(2 * L0 * D2R) - 2 * e * Math.sin(M * D2R) +
    4 * e * y * Math.sin(M * D2R) * Math.cos(2 * L0 * D2R) -
    0.5 * y * y * Math.sin(4 * L0 * D2R) - 1.25 * e * e * Math.sin(2 * M * D2R));

  const utcMin = date.getUTCHours() * 60 + date.getUTCMinutes() + date.getUTCSeconds() / 60 + date.getUTCMilliseconds() / 60000;
  let tst = (utcMin + eqTime + 4 * lon) % 1440;
  if (tst < 0) tst += 1440;
  const ha = tst / 4 < 0 ? tst / 4 + 180 : tst / 4 - 180;

  const cosZ = Math.sin(lat * D2R) * Math.sin(decl * D2R) + Math.cos(lat * D2R) * Math.cos(decl * D2R) * Math.cos(ha * D2R);
  const zen = Math.acos(Math.min(1, Math.max(-1, cosZ))) * R2D;
  let elev = 90 - zen;

  // atmospheric refraction (NOAA's piecewise fit)
  let refr = 0;
  if (elev <= 85) {
    const te = Math.tan(elev * D2R);
    if (elev > 5) refr = 58.1 / te - 0.07 / te ** 3 + 0.000086 / te ** 5;
    else if (elev > -0.575) refr = 1735 + elev * (-518.2 + elev * (103.4 + elev * (-12.79 + elev * 0.711)));
    else refr = -20.772 / te;
    refr /= 3600;
  }
  elev += refr;

  const az = Math.atan2(
    Math.sin(ha * D2R),
    Math.cos(ha * D2R) * Math.sin(lat * D2R) - Math.tan(decl * D2R) * Math.cos(lat * D2R)
  ) * R2D + 180;

  return { azimuth: (az + 360) % 360, elevation: elev, declination: decl, eqTime };
}

/** A Date for local clock time `hours` (fractional) on y-m-d in time zone `tz`. */
export function localDate(y, m, d, hours, tz = SUKHNA.tz) {
  return new Date(Date.UTC(y, m - 1, d, 0, 0, 0) + (hours - tz) * 3600000);
}

/**
 * The local clock time (hours) at which the sun's elevation crosses `elev`
 * (rising if `rising`), found by bisection on the day's curve.  -0.833 is
 * sunrise (upper limb, standard refraction); -6 is civil dawn.
 */
export function crossing(y, m, d, elev, rising = true, lat = SUKHNA.lat, lon = SUKHNA.lon, tz = SUKHNA.tz) {
  const f = (h) => sunPosition(localDate(y, m, d, h, tz), lat, lon).elevation - elev;
  // solar noon is near 12:00 + (tz*15 - lon)*4 min; bracket each half-day
  const noon = 12 + (tz * 15 - lon) / 15;
  let a = rising ? noon - 12 : noon, b = rising ? noon : noon + 12;
  if (Math.sign(f(a)) === Math.sign(f(b))) return NaN;
  for (let i = 0; i < 50; i++) {
    const c = (a + b) / 2;
    if (Math.sign(f(c)) === Math.sign(f(a))) a = c; else b = c;
  }
  return (a + b) / 2;
}

/** "07:21" for 7.35 hours. */
export function hhmm(hours) {
  const t = Math.round(hours * 60);
  return `${String(Math.floor(t / 60) % 24).padStart(2, '0')}:${String(t % 60).padStart(2, '0')}`;
}
