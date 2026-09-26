import * as THREE from 'three';

/* ------------------------------------------------------------------ *
 * The parametric body (plan §6), shared by the player and the NPCs.
 *
 * Like the reference's vehicles, a person is a row of numbers: height,
 * builds, limb ratios, posture, clothing and colours.  From that row the
 * parts are derived -- pelvis, torso, neck, head, hair or headwear, upper
 * and lower arms, hands, thighs, shins and shoes -- each one a unit shape
 * scaled by its own matrix.  `poseBody` is forward kinematics: given the
 * row and a pose (joint angles from people/gait.js) it writes one matrix
 * per part, relative to the person's root (feet on the ground, facing -z).
 *
 * The player builds a Mesh per part from those matrices; the crowd writes
 * the same matrices into one InstancedMesh per part (people/crowd.js), so
 * a whole crowd costs one draw call per part type however many people.
 * ------------------------------------------------------------------ */

/** Part order: the index is the part's slot in every pose array. */
export const PARTS = [
  'pelvis', 'torso', 'neck', 'head', 'hair',
  'upperArmL', 'lowerArmL', 'handL', 'upperArmR', 'lowerArmR', 'handR',
  'thighL', 'shinL', 'footL', 'thighR', 'shinR', 'footR',
  'headwear', 'dupatta', 'eyes',
];
export const P = Object.fromEntries(PARTS.map((n, i) => [n, i]));

/** Unit shapes: every part is one of these, scaled per person and per frame. */
function capsule() {
  // a unit capsule hanging down from the origin (the joint) to y = -1
  const g = new THREE.CapsuleGeometry(0.5, 1, 3, 8);
  g.scale(1, 0.5, 1); // total height 1 (cylinder 0.5 + caps 0.25 each)
  g.translate(0, -0.5, 0);
  return g;
}
function ellipsoid() { return new THREE.IcosahedronGeometry(0.5, 2); }
function shoe() {
  const g = new THREE.BoxGeometry(1, 1, 1);
  g.translate(0, 0.5, -0.25); // toe forward (-z)
  return g;
}
function turban() {
  // layered wrap: a squashed torus over a dome
  const a = new THREE.TorusGeometry(0.42, 0.2, 6, 14);
  a.rotateX(Math.PI / 2);
  a.translate(0, 0.05, 0);
  const b = new THREE.SphereGeometry(0.46, 12, 8, 0, Math.PI * 2, 0, Math.PI / 2);
  b.translate(0, 0.08, 0);
  const merged = mergeTwo(a, b);
  return merged;
}
function patka() {
  // a snug cloth cap with a knot on top (the jogger's patka)
  const cap = new THREE.SphereGeometry(0.52, 12, 8, 0, Math.PI * 2, 0, Math.PI * 0.55);
  const knot = new THREE.SphereGeometry(0.22, 8, 6);
  knot.translate(0, 0.42, -0.05);
  return mergeTwo(cap, knot);
}
function mergeTwo(a, b) {
  const A = a.index ? a.toNonIndexed() : a, B = b.index ? b.toNonIndexed() : b;
  for (const g of [A, B]) if (g.attributes.uv) g.deleteAttribute('uv');
  const pos = new Float32Array(A.attributes.position.array.length + B.attributes.position.array.length);
  pos.set(A.attributes.position.array); pos.set(B.attributes.position.array, A.attributes.position.array.length);
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.computeVertexNormals();
  return g;
}
function eyes() {
  // two small dark eyes on the front of the head (-z), anime-simple
  const a = new THREE.IcosahedronGeometry(0.5, 1), c = a.clone();
  a.scale(0.13, 0.2, 0.08); a.translate(-0.2, 0.05, -0.47);
  c.scale(0.13, 0.2, 0.08); c.translate(0.2, 0.05, -0.47);
  return mergeTwo(a, c);
}
function dupatta() {
  // a scarf over the shoulders: a curved band
  const g = new THREE.TorusGeometry(0.5, 0.12, 5, 12, Math.PI * 1.25);
  g.rotateX(Math.PI / 2);
  g.rotateY(Math.PI * 0.62);
  return g;
}

let GEOS = null;
/** One geometry per part type (shared by every body and every crowd pool). */
export function partGeometries() {
  if (GEOS) return GEOS;
  const cap = capsule(), ell = ellipsoid(), sh = shoe();
  GEOS = PARTS.map((name) => {
    if (name === 'head' || name === 'pelvis' || name === 'hair') return ell;
    if (name.startsWith('hand')) return ell;
    if (name.startsWith('foot')) return sh;
    if (name === 'headwear') return null; // chosen per person (see headwearGeometry)
    if (name === 'dupatta') return dupatta();
    if (name === 'eyes') return eyes();
    return cap;
  });
  return GEOS;
}
export const HEADWEAR = { none: null, cap: 'cap', patka: 'patka', turban: 'turban', monkey: 'monkey', dupatta: 'dupatta' };
const HW_GEO = {};
export function headwearGeometry(kind) {
  if (!kind || kind === 'none' || kind === 'dupatta') return null;
  if (HW_GEO[kind]) return HW_GEO[kind];
  if (kind === 'turban') HW_GEO[kind] = turban();
  else if (kind === 'patka') HW_GEO[kind] = patka();
  else if (kind === 'monkey') HW_GEO[kind] = new THREE.SphereGeometry(0.56, 12, 8, 0, Math.PI * 2, 0, Math.PI * 0.72);
  else { // cap: crown plus a peak
    const crown = new THREE.SphereGeometry(0.52, 12, 6, 0, Math.PI * 2, 0, Math.PI / 2);
    const peak = new THREE.CylinderGeometry(0.42, 0.42, 0.05, 12, 1, false, Math.PI * 0.5, Math.PI);
    peak.translate(0, 0.02, -0.18);
    HW_GEO[kind] = mergeTwo(crown, peak);
  }
  return HW_GEO[kind];
}

/* -------------------------------- types -------------------------------- */

/**
 * A person as a row of numbers (and a few names).  Units are metres and
 * fractions of height.  `top`/`bottom`/`sleeves`/`legs` decide which parts
 * take clothing colours and which take skin.
 */
export function makeBody(row = {}) {
  const b = {
    height: 1.72, shoulder: 0.23, hip: 0.19, girth: 1.0, legRatio: 0.53, armRatio: 0.44, headSize: 1.0, stoop: 0,
    skin: 0xb07a55, hair: 0x2a2320, top: 0x3f7fd0, bottom: 0x2f2f3a, shoe: 0xeeeeee, headwearColor: 0xd23b35, dupattaColor: 0xe07a9a,
    sleeves: 'short', legs: 'long', headwear: 'none', long: false, // long: kurta or shawl covering the thighs
    ...row,
  };
  return b;
}

/* -------------------------------- pose -------------------------------- */

const _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _e = new THREE.Euler(), _v = new THREE.Vector3(), _s = new THREE.Vector3();
const joint = () => new THREE.Matrix4();

/** A rest pose: every angle zero.  Gait fills these fields (radians, metres). */
export function restPose() {
  return {
    bounce: 0, lean: 0, twist: 0, sway: 0, headPitch: 0,
    hipL: 0, kneeL: 0, ankleL: 0, hipR: 0, kneeR: 0, ankleR: 0,
    shoulderL: 0, elbowL: 0, shoulderR: 0, elbowR: 0, armOutL: 0.08, armOutR: 0.08,
    sit: 0, // 0 standing, 1 sitting (hips bent 90°, knees bent 90°)
  };
}

/**
 * Forward kinematics: write one matrix per part (relative to the root:
 * feet at y = 0, facing -z) into `out` (an array of Matrix4, length
 * PARTS.length).  Parts a person does not have get a zero-scale matrix.
 */
export function poseBody(b, pose, out) {
  const H = b.height, g = b.girth;
  // hip height = legLen; the shoe (0.07 m) sits under the ankle, so thigh + shin = legLen - 0.07
  const legLen = H * b.legRatio, thighLen = (legLen - 0.07) * 0.52, shinLen = (legLen - 0.07) * 0.48;
  const torsoLen = H * 0.3, neckLen = H * 0.04, headR = H * 0.068 * b.headSize;
  const upperArm = H * b.armRatio * 0.43, lowerArm = H * b.armRatio * 0.4;
  const hipY = legLen + pose.bounce - pose.sit * (thighLen * 0.95);

  // pelvis: position, heading twist, sway
  const pelvis = joint().compose(_v.set(pose.sway, hipY, 0), _q.setFromEuler(_e.set(0, pose.twist * 0.5, 0)), _s.set(1, 1, 1));
  set(out, P.pelvis, pelvis, 0, 0.02, 0, 0, b.hip * 2.2 * g, H * 0.12, b.hip * 1.35 * g);

  // torso leans forward from the pelvis
  const chest = pelvis.clone().multiply(joint().makeRotationFromEuler(_e.set(-pose.lean - b.stoop, pose.twist, 0)));
  const torsoTop = chest.clone().multiply(joint().makeTranslation(0, torsoLen, 0));
  set(out, P.torso, chest, 0, 0, 0, 0, b.shoulder * 2.1 * g, torsoLen * 1.05, b.hip * 1.3 * g, true);
  const neck = torsoTop.clone().multiply(joint().makeRotationFromEuler(_e.set(b.stoop * 0.8 + pose.lean * 0.5 - pose.headPitch, 0, 0)));
  set(out, P.neck, neck, 0, -0.02, 0, 0, H * 0.055, neckLen + 0.06, H * 0.055, true);
  const head = neck.clone().multiply(joint().makeTranslation(0, neckLen + headR * 0.95, 0));
  set(out, P.head, head, 0, 0, -0.01, 0, headR * 2, headR * 2.25, headR * 2.1);
  set(out, P.eyes, head, 0, 0, -0.01, 0, headR * 2, headR * 2.25, headR * 2.1);
  // hair: a darker cap on the back and top of the head (hidden under most headwear)
  if (b.headwear === 'turban' || b.headwear === 'patka' || b.headwear === 'monkey') zero(out, P.hair);
  else set(out, P.hair, head, 0, headR * 0.28, headR * 0.12, 0, headR * 2.08, headR * 1.7, headR * 2.1);
  const hwGeo = b.headwear !== 'none' && b.headwear !== 'dupatta';
  if (hwGeo) {
    const sc = b.headwear === 'turban' ? 1.15 : b.headwear === 'monkey' ? 1.05 : 1.02;
    set(out, P.headwear, head, 0, b.headwear === 'turban' ? headR * 0.25 : headR * 0.18, 0, 0, headR * 2 * sc, headR * 2 * sc, headR * 2 * sc);
  } else zero(out, P.headwear);
  if (b.headwear === 'dupatta') set(out, P.dupatta, torsoTop, 0, -0.02, 0.02, 0, b.shoulder * 1.6, 0.6, b.hip * 1.4);
  else zero(out, P.dupatta);

  // arms: shoulders at the torso top, swinging in pitch, a little out, elbows bent forward
  for (const [side, sh, el, ao, U, Lo, Ha] of [[-1, pose.shoulderL, pose.elbowL, pose.armOutL, P.upperArmL, P.lowerArmL, P.handL], [1, pose.shoulderR, pose.elbowR, pose.armOutR, P.upperArmR, P.lowerArmR, P.handR]]) {
    const sj = torsoTop.clone().multiply(joint().makeTranslation(side * b.shoulder * g, -0.04, 0))
      .multiply(joint().makeRotationFromEuler(_e.set(sh, 0, side * ao)));
    set(out, U, sj, 0, 0, 0, 0, H * 0.052 * g, upperArm, H * 0.052 * g);
    const ej = sj.clone().multiply(joint().makeTranslation(0, -upperArm, 0)).multiply(joint().makeRotationFromEuler(_e.set(el, 0, 0)));
    set(out, Lo, ej, 0, 0, 0, 0, H * 0.042 * g, lowerArm, H * 0.042 * g);
    const hj = ej.clone().multiply(joint().makeTranslation(0, -lowerArm, 0));
    set(out, Ha, hj, 0, -0.03, 0, 0, H * 0.05, H * 0.06, H * 0.04);
  }

  // legs: hips swing in pitch, knees fold back, ankles keep the shoe flat-ish
  for (const [side, hp, kn, an, T, S, F] of [[-1, pose.hipL, pose.kneeL, pose.ankleL, P.thighL, P.shinL, P.footL], [1, pose.hipR, pose.kneeR, pose.ankleR, P.thighR, P.shinR, P.footR]]) {
    const hj = pelvis.clone().multiply(joint().makeTranslation(side * b.hip * 0.55 * g, -0.03, 0))
      .multiply(joint().makeRotationFromEuler(_e.set(hp + pose.sit * Math.PI * 0.5, 0, 0)));
    set(out, T, hj, 0, 0, 0, 0, H * 0.078 * g, thighLen, H * 0.08 * g);
    const kj = hj.clone().multiply(joint().makeTranslation(0, -thighLen, 0)).multiply(joint().makeRotationFromEuler(_e.set(-kn - pose.sit * Math.PI * 0.5, 0, 0)));
    set(out, S, kj, 0, 0, 0, 0, H * 0.06 * g, shinLen, H * 0.06 * g);
    const aj = kj.clone().multiply(joint().makeTranslation(0, -shinLen, 0)).multiply(joint().makeRotationFromEuler(_e.set(an, 0, 0)));
    set(out, F, aj, 0, -0.07, 0.02, 0, 0.1, 0.08, 0.26);
  }
  return out;
}

/** out[i] = parent · T(x, y, z) · S(sx, sy, sz)  (capsules hang from their joint). */
function set(out, i, parent, x, y, z, _r, sx, sy, sz, upward = false) {
  // `upward` parts (torso, neck) grow up from their joint: the hanging capsule
  // is turned over with a half-turn, never mirrored -- a negative scale would
  // turn an *instance* inside out (three only fixes the winding per object)
  const m = out[i];
  m.copy(parent).multiply(_m.makeTranslation(x, y, z));
  if (upward) m.multiply(_m.makeRotationX(Math.PI));
  m.multiply(_m.makeScale(sx, sy, sz));
}
function zero(out, i) { out[i].makeScale(0, 0, 0); }

/** Which colour each part takes, from the row. */
export function partColours(b) {
  const skin = b.skin, top = b.top, bottom = b.bottom;
  const longTop = b.long;
  return PARTS.map((name) => {
    switch (name) {
      case 'pelvis': return longTop ? top : bottom;
      case 'torso': return top;
      case 'neck': case 'head': return skin;
      case 'hair': return b.hair;
      case 'upperArmL': case 'upperArmR': return b.sleeves === 'none' ? skin : top;
      case 'lowerArmL': case 'lowerArmR': return b.sleeves === 'long' ? top : skin;
      case 'handL': case 'handR': return skin;
      case 'thighL': case 'thighR': return longTop ? top : bottom;
      case 'shinL': case 'shinR': return b.legs === 'shorts' ? (b.tights ?? skin) : bottom;
      case 'footL': case 'footR': return b.shoe;
      case 'headwear': return b.headwearColor;
      case 'dupatta': return b.dupattaColor;
      case 'eyes': return 0x221c1c;
      default: return 0xffffff;
    }
  });
}

/* ------------------------------ outfits ------------------------------ */

/** The player's three outfits (plan §6), chosen on the start card. */
export const OUTFITS = [
  { name: 'Tee & track pants', row: { top: 0xe8542f, bottom: 0x2b3040, shoe: 0xf2f2f2, sleeves: 'short', legs: 'long' } },
  { name: 'Patka, tee & shorts', row: { top: 0x2f6fb0, bottom: 0x1f2430, tights: 0x1b1d24, shoe: 0xf2c230, sleeves: 'short', legs: 'shorts', headwear: 'patka', headwearColor: 0xf08a2e, hair: 0x1b1715 } },
  { name: 'Hoodie & joggers', row: { top: 0x6b7a5a, bottom: 0x3a3f48, shoe: 0xd9d9d9, sleeves: 'long', legs: 'long' } },
];
