/* Billiards physics engine — rigid-body, fixed-step, full 3-D spin.
 *
 * Coordinates: metres, x along the long axis, y along the short axis, z up
 * (right-handed, so seen from above x points right and y points up the screen).
 * The origin is the bottom-left corner of the playing area, measured between
 * the cushion noses.
 *
 * What is modelled
 *   - Ball on cloth: sliding friction (exact analytic slide -> roll transition,
 *     slip decays at 7/2·µg), rolling resistance, vertical-axis spin decay.
 *   - Ball-ball: inelastic impulse with Coulomb friction at the contact point
 *     (throw + spin transfer), speed dependent friction coefficient
 *     (Alciatore's fit), exact time-of-impact correction.
 *   - Ball-cushion: contact point sits above the ball centre at the cushion
 *     nose height, so the contact normal is tilted; solved as a small
 *     sequential-impulse problem with cushion friction, table friction and a
 *     speed dependent restitution (after Han 2005 / Mathavan et al. 2010).
 *   - Cue strike: level cue, tip offset (a,b) -> speed, topspin/backspin,
 *     side spin and squirt.
 *   - Pockets: the cushions end in point knuckles; a ball is potted when its
 *     centre crosses the line between the two knuckles of a mouth.
 *
 * Not modelled: ball hop / massé / jump shots (cue elevation), cloth nap,
 * tip miscues, table slope, ball roundness, temperature/humidity.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.BilliardsPhysics = factory();
})(typeof self !== 'undefined' ? self : this, function () {
'use strict';

const G = 9.81;
const SQRT3 = Math.sqrt(3);
const TWO_PI = Math.PI * 2;

/* ------------------------------------------------------------------ specs */

const COMMON = {
  muSlide: 0.20,          // ball-cloth sliding friction
  muRoll: 0.010,          // rolling resistance (decel = muRoll * g)
  spinDecay: 9.0,         // rad/s^2, vertical-axis (english) spin decay
  eBall: 0.95,            // ball-ball restitution
  muCushion: 0.14,        // ball-cushion friction
  cushionFrac: 0.635,     // cushion nose height as a fraction of ball diameter
  cueMass: 0.54,          // kg
  eTip: 0.9,              // cue tip / ball restitution
  cueMaxSpeed: 7.0,       // m/s of the cue at power = 1
  squirtK: 0.07,          // rad of squirt per unit (offset / R)
};

const SPECS = {
  pool: Object.assign({}, COMMON, {
    key: 'pool', label: 'Pool (9 ft table)',
    L: 2.54, W: 1.27, R: 0.028575, m: 0.170,
    pockets: true, cornerMouth: 0.1175, sideMouth: 0.127,
  }),
  snooker: Object.assign({}, COMMON, {
    key: 'snooker', label: 'Snooker (12 ft table)',
    L: 3.569, W: 1.778, R: 0.02625, m: 0.1425,
    pockets: true, cornerMouth: 0.087, sideMouth: 0.100,
    muRoll: 0.014, cushionFrac: 0.66,
  }),
  carom: Object.assign({}, COMMON, {
    key: 'carom', label: 'Carom (3-cushion)',
    L: 2.84, W: 1.42, R: 0.03075, m: 0.210,
    pockets: false, muRoll: 0.006, eBall: 0.96,
  }),
};

function derive(spec) {
  const P = Object.assign({}, spec);
  P.I = 0.4 * P.m * P.R * P.R;
  const h = (P.cushionFrac * 2 - 1) * P.R;      // contact height above ball centre
  P.cushionSin = h / P.R;
  P.cushionCos = Math.sqrt(1 - P.cushionSin * P.cushionSin);
  P.Rc = P.R * P.cushionCos;                    // centre-to-nose distance at contact
  return P;
}

/* ------------------------------------------------------------------ table */

function makeTable(P) {
  const L = P.L, W = P.W;
  const rails = [];
  const knuckles = [];
  const pockets = [];
  function rail(x0, y0, x1, y1, nx, ny) {
    const dx = x1 - x0, dy = y1 - y0;
    rails.push({ x0, y0, x1, y1, dx, dy, len2: dx * dx + dy * dy, nx, ny });
  }
  if (!P.pockets) {
    rail(0, 0, L, 0, 0, 1);
    rail(0, W, L, W, 0, -1);
    rail(0, 0, 0, W, 1, 0);
    rail(L, 0, L, W, -1, 0);
  } else {
    const a = P.cornerMouth / Math.SQRT2;
    const hs = P.sideMouth / 2;
    rail(a, 0, L / 2 - hs, 0, 0, 1);
    rail(L / 2 + hs, 0, L - a, 0, 0, 1);
    rail(a, W, L / 2 - hs, W, 0, -1);
    rail(L / 2 + hs, W, L - a, W, 0, -1);
    rail(0, a, 0, W - a, 1, 0);
    rail(L, a, L, W - a, -1, 0);
    // corner pockets: ball centre potted once it crosses the knuckle-knuckle line
    [[0, 0, 1, 1], [L, 0, -1, 1], [0, W, 1, -1], [L, W, -1, -1]].forEach(function (c) {
      pockets.push({ kind: 'corner', cx: c[0], cy: c[1], sx: c[2], sy: c[3], a: a,
        // mouth segment endpoints, for drawing / ray tracing
        k0: [c[0] + c[2] * a, c[1]], k1: [c[0], c[1] + c[3] * a] });
    });
    pockets.push({ kind: 'side', cx: L / 2, cy: 0, sy: 1, hs: hs, k0: [L / 2 - hs, 0], k1: [L / 2 + hs, 0] });
    pockets.push({ kind: 'side', cx: L / 2, cy: W, sy: -1, hs: hs, k0: [L / 2 - hs, W], k1: [L / 2 + hs, W] });
  }
  rails.forEach(function (r) {
    knuckles.push([r.x0, r.y0], [r.x1, r.y1]);
  });
  return { L: L, W: W, rails: rails, pockets: pockets, knuckles: knuckles };
}

/** Index of the pocket the point (x,y) lies in, or -1. */
function pocketAt(table, P, x, y) {
  const ps = table.pockets;
  for (let i = 0; i < ps.length; i++) {
    const p = ps[i];
    if (p.kind === 'corner') {
      const dx = (x - p.cx) * p.sx, dy = (y - p.cy) * p.sy;
      if (dx + dy < p.a) return i;
    } else {
      if ((y - p.cy) * p.sy < 0 && Math.abs(x - p.cx) < p.hs + P.R) return i;
    }
  }
  return -1;
}

/* ------------------------------------------------------------------ balls */

function createBall(id, x, y, meta) {
  return {
    id: id, x: x, y: y, vx: 0, vy: 0, wx: 0, wy: 0, wz: 0,
    q: [1, 0, 0, 0],       // orientation (body -> world), for rendering only
    pocketed: -1,
    meta: meta || {},
  };
}

function isMoving(b) {
  return b.vx !== 0 || b.vy !== 0 || b.wx !== 0 || b.wy !== 0 || b.wz !== 0;
}

/** Advance one ball by dt on the cloth. Analytic within the step. */
function advanceBall(b, dt, P, spinOrientation) {
  if (b.vx === 0 && b.vy === 0 && b.wx === 0 && b.wy === 0 && b.wz === 0) return;
  const R = P.R;
  let rem = dt;
  const ux = b.vx - R * b.wy, uy = b.vy + R * b.wx;       // contact-point slip velocity
  const us = Math.hypot(ux, uy);
  if (us > 1e-7) {
    const k = P.muSlide * G;
    const ts = us / (3.5 * k);
    const h = Math.min(rem, ts);
    const ix = ux / us, iy = uy / us;
    b.x += b.vx * h - 0.5 * k * ix * h * h;
    b.y += b.vy * h - 0.5 * k * iy * h * h;
    b.vx -= k * ix * h;
    b.vy -= k * iy * h;
    const kw = 2.5 * k / R;
    b.wx -= kw * iy * h;
    b.wy += kw * ix * h;
    rem -= h;
    if (rem > 0) { b.wy = b.vx / R; b.wx = -b.vy / R; }    // slide finished: exact roll
  }
  if (rem > 0) {
    const sp = Math.hypot(b.vx, b.vy);
    if (sp > 1e-6) {
      const d = P.muRoll * G;
      const ts = sp / d;
      const h = Math.min(rem, ts);
      const ux2 = b.vx / sp, uy2 = b.vy / sp;
      const dist = sp * h - 0.5 * d * h * h;
      b.x += ux2 * dist;
      b.y += uy2 * dist;
      if (h >= ts) { b.vx = 0; b.vy = 0; b.wx = 0; b.wy = 0; }
      else {
        const s2 = sp - d * h;
        b.vx = ux2 * s2; b.vy = uy2 * s2;
        b.wy = b.vx / R; b.wx = -b.vy / R;
      }
    } else {
      b.vx = 0; b.vy = 0; b.wx = 0; b.wy = 0;
    }
  }
  if (b.wz !== 0) {
    const dw = P.spinDecay * dt;
    if (Math.abs(b.wz) <= dw) b.wz = 0; else b.wz -= Math.sign(b.wz) * dw;
  }
  if (spinOrientation) integrateOrientation(b, dt);
}

function integrateOrientation(b, dt) {
  const wx = b.wx, wy = b.wy, wz = b.wz;
  if (wx === 0 && wy === 0 && wz === 0) return;
  const q = b.q, qw = q[0], qx = q[1], qy = q[2], qz = q[3];
  const h = 0.5 * dt;
  let nw = qw + h * (-(wx * qx + wy * qy + wz * qz));
  let nx = qx + h * (qw * wx + (wy * qz - wz * qy));
  let ny = qy + h * (qw * wy + (wz * qx - wx * qz));
  let nz = qz + h * (qw * wz + (wx * qy - wy * qx));
  const inv = 1 / Math.sqrt(nw * nw + nx * nx + ny * ny + nz * nz);
  q[0] = nw * inv; q[1] = nx * inv; q[2] = ny * inv; q[3] = nz * inv;
}

/** Body->world rotation matrix (row-major 9) from the ball's quaternion. */
function rotationMatrix(q) {
  const w = q[0], x = q[1], y = q[2], z = q[3];
  return [
    1 - 2 * (y * y + z * z), 2 * (x * y - w * z), 2 * (x * z + w * y),
    2 * (x * y + w * z), 1 - 2 * (x * x + z * z), 2 * (y * z - w * x),
    2 * (x * z - w * y), 2 * (y * z + w * x), 1 - 2 * (x * x + y * y),
  ];
}

/* ------------------------------------------------------------- collisions */

/** Ball-ball friction coefficient vs. slip speed (Alciatore's fit). */
function muBallBall(slip) {
  return 0.00995 + 0.108 * Math.exp(-1.088 * slip);
}

/**
 * Collide two equal balls. Returns the approach speed, or 0 if there was no
 * collision. Does an exact time-of-impact rewind inside the step.
 */
function collideBalls(A, B, P, dt) {
  const R = P.R, D = 2 * R;
  let dx = B.x - A.x, dy = B.y - A.y;
  const d2 = dx * dx + dy * dy;
  if (d2 >= D * D) return 0;
  // relative velocity of B w.r.t. A
  const rvx = B.vx - A.vx, rvy = B.vy - A.vy;
  // rewind to the moment of first contact (positions only, linear in the step)
  let tau = 0;
  const aa = rvx * rvx + rvy * rvy;
  if (aa > 1e-12) {
    const bb = dx * rvx + dy * rvy;                 // d . w
    const disc = bb * bb - aa * (d2 - D * D);
    if (disc >= 0) {
      tau = (bb + Math.sqrt(disc)) / aa;            // time since contact
      if (tau < 0) tau = 0;
      if (tau > dt) tau = dt;
    }
  }
  const ax = A.x - A.vx * tau, ay = A.y - A.vy * tau;
  const bx = B.x - B.vx * tau, by = B.y - B.vy * tau;
  dx = bx - ax; dy = by - ay;
  let dist = Math.hypot(dx, dy);
  if (dist < 1e-9) { dx = 1; dy = 0; dist = 1; }
  const nx = dx / dist, ny = dy / dist;
  collideBalls.lastN = [nx, ny];                        // exact contact normal, for readouts
  const vn = (A.vx - B.vx) * nx + (A.vy - B.vy) * ny;   // >0 means approaching
  if (vn <= 0) {
    // separating or resting: only resolve overlap
    const pen = (D - Math.hypot(B.x - A.x, B.y - A.y)) / 2;
    if (pen > 0) {
      const ex = B.x - A.x, ey = B.y - A.y, el = Math.hypot(ex, ey) || 1;
      A.x -= ex / el * pen; A.y -= ey / el * pen;
      B.x += ex / el * pen; B.y += ey / el * pen;
    }
    return 0;
  }
  const m = P.m, I = P.I;
  const Jn = (1 + P.eBall) * 0.5 * m * vn;
  // slip velocity of the contact points (A's surface relative to B's)
  const sw0 = A.wx + B.wx, sw1 = A.wy + B.wy, sw2 = A.wz + B.wz;
  // (sw x n) with n = (nx, ny, 0)
  const cx = -sw2 * ny, cy = sw2 * nx, cz = sw0 * ny - sw1 * nx;
  let ux = (A.vx - B.vx) + R * cx, uy = (A.vy - B.vy) + R * cy;
  const uz = R * cz;
  const un = ux * nx + uy * ny;
  ux -= un * nx; uy -= un * ny;                     // in-plane tangential slip
  const tx = -ny, ty = nx;
  const ut = ux * tx + uy * ty;                     // component along t
  // friction: planar tangent sticks with K = 7/m, vertical with K = 5/m
  const slip = Math.hypot(ut, uz);
  let Ft = 0, Fz = 0;
  if (slip > 1e-9) {
    const stickT = m * ut / 7, stickZ = m * uz / 5;
    const mag = Math.hypot(stickT, stickZ);
    const lim = muBallBall(slip) * Jn;
    const sc = mag > lim ? lim / mag : 1;
    Ft = -stickT * sc;                              // impulse on A along t (opposes slip)
    Fz = -stickZ * sc;                              // impulse on A along z
  }
  // total impulse on A: P = -Jn n + Ft t + Fz z
  const Px = -Jn * nx + Ft * tx, Py = -Jn * ny + Ft * ty, Pz = Fz;
  A.vx += Px / m; A.vy += Py / m;
  B.vx -= Px / m; B.vy -= Py / m;
  // dw = (R n x P) / I  for both balls
  const rn = R / I;
  const dwx = rn * (ny * Pz - 0 * Py), dwy = rn * (0 * Px - nx * Pz), dwz = rn * (nx * Py - ny * Px);
  A.wx += dwx; A.wy += dwy; A.wz += dwz;
  B.wx += dwx; B.wy += dwy; B.wz += dwz;
  // restore positions: contact position + new velocity * tau
  A.x = ax + A.vx * tau; A.y = ay + A.vy * tau;
  B.x = bx + B.vx * tau; B.y = by + B.vy * tau;
  return vn;
}

function cushionRestitution(v) {
  const e = 0.39 + 0.257 * v - 0.044 * v * v;
  return e < 0.2 ? 0.2 : e;
}

/**
 * Impulse solve for a ball striking a cushion with horizontal inward normal
 * (nx, ny). Contact A is the cushion nose (above the ball centre), contact B is
 * the cloth under the ball. Returns the horizontal approach speed or 0.
 */
function cushionImpact(b, nx, ny, P) {
  const vh = -(b.vx * nx + b.vy * ny);
  if (vh <= 0) return 0;
  const R = P.R, m = P.m, I = P.I;
  const s = P.cushionSin, c = P.cushionCos;
  const rAx = -nx * R * c, rAy = -ny * R * c, rAz = R * s;
  const NAx = nx * c, NAy = ny * c, NAz = -s;
  const t1x = -ny, t1y = nx;                          // along the rail
  const t2x = nx * s, t2y = ny * s, t2z = c;          // up the nose
  let vx = b.vx, vy = b.vy, vz = 0;
  let wx = b.wx, wy = b.wy, wz = b.wz;
  const e = vh < 0.02 ? 0 : cushionRestitution(vh);
  const KT = 3.5 / m;                                 // friction effective mass^-1
  const muA = P.muCushion, muB = P.muSlide;
  // initial normal approach velocity at the nose
  const vcx0 = vx + (wy * rAz - wz * rAy);
  const vcy0 = vy + (wz * rAx - wx * rAz);
  const vcz0 = vz + (wx * rAy - wy * rAx);
  const vn0 = vcx0 * NAx + vcy0 * NAy + vcz0 * NAz;
  if (vn0 >= 0) return 0;
  const target = -e * vn0;
  let lnA = 0, l1A = 0, l2A = 0, lnB = 0, l1B = 0, l2B = 0;
  for (let it = 0; it < 40; it++) {
    // --- cushion normal (r parallel to N, so no torque)
    let vcx = vx + (wy * rAz - wz * rAy);
    let vcy = vy + (wz * rAx - wx * rAz);
    let vcz = vz + (wx * rAy - wy * rAx);
    let d = (target - (vcx * NAx + vcy * NAy + vcz * NAz)) * m;
    let nl = Math.max(0, lnA + d);
    d = nl - lnA; lnA = nl;
    vx += NAx * d / m; vy += NAy * d / m; vz += NAz * d / m;
    // --- cushion friction
    vcx = vx + (wy * rAz - wz * rAy);
    vcy = vy + (wz * rAx - wx * rAz);
    vcz = vz + (wx * rAy - wy * rAx);
    let d1 = -(vcx * t1x + vcy * t1y) / KT;
    let d2 = -(vcx * t2x + vcy * t2y + vcz * t2z) / KT;
    let n1 = l1A + d1, n2 = l2A + d2;
    const lim = muA * lnA, mag = Math.hypot(n1, n2);
    if (mag > lim) { const k = mag > 0 ? lim / mag : 0; n1 *= k; n2 *= k; }
    d1 = n1 - l1A; d2 = n2 - l2A; l1A = n1; l2A = n2;
    let Fx = d1 * t1x + d2 * t2x, Fy = d1 * t1y + d2 * t2y, Fz = d2 * t2z;
    vx += Fx / m; vy += Fy / m; vz += Fz / m;
    wx += (rAy * Fz - rAz * Fy) / I;
    wy += (rAz * Fx - rAx * Fz) / I;
    wz += (rAx * Fy - rAy * Fx) / I;
    // --- table normal (keeps vz >= 0 ... pinned to 0)
    d = -vz * m;
    nl = Math.max(0, lnB + d);
    d = nl - lnB; lnB = nl;
    vz += d / m;
    // --- table friction: contact point at (0,0,-R)
    const sx = vx - R * wy, sy = vy + R * wx;
    let e1 = -sx / KT, e2 = -sy / KT;
    let m1 = l1B + e1, m2 = l2B + e2;
    const limB = muB * lnB, magB = Math.hypot(m1, m2);
    if (magB > limB) { const k = magB > 0 ? limB / magB : 0; m1 *= k; m2 *= k; }
    e1 = m1 - l1B; e2 = m2 - l2B; l1B = m1; l2B = m2;
    vx += e1 / m; vy += e2 / m;
    wx += R * e2 / I;
    wy -= R * e1 / I;
  }
  b.vx = vx; b.vy = vy; b.wx = wx; b.wy = wy; b.wz = wz;
  return vh;
}

/**
 * Collide a ball with every cushion segment / knuckle. Returns the number of
 * cushion impacts (for counting bank shots). `onHit(speed)` is optional.
 */
function collideCushions(b, P, table, dt, onHit) {
  const Rc = P.Rc;
  let hits = 0;
  const rails = table.rails;
  for (let i = 0; i < rails.length; i++) {
    const r = rails[i];
    let t = ((b.x - r.x0) * r.dx + (b.y - r.y0) * r.dy) / r.len2;
    if (t < 0) t = 0; else if (t > 1) t = 1;
    const cx = r.x0 + t * r.dx, cy = r.y0 + t * r.dy;
    let ex = b.x - cx, ey = b.y - cy;
    const d2 = ex * ex + ey * ey;
    if (d2 >= Rc * Rc) continue;
    let nx, ny, dist = Math.sqrt(d2);
    if (t > 0 && t < 1) { nx = r.nx; ny = r.ny; dist = ex * nx + ey * ny; }
    else if (dist > 1e-9) { nx = ex / dist; ny = ey / dist; }
    else { nx = r.nx; ny = r.ny; }
    const vn = b.vx * nx + b.vy * ny;
    if (vn < 0) {
      // rewind to first contact, solve, replay the remainder of the step
      let tau = (Rc - dist) / -vn;
      if (tau > dt) tau = dt;
      b.x -= b.vx * tau; b.y -= b.vy * tau;
      if (!(t > 0 && t < 1)) {                 // knuckle: normal at the contact position
        let kx = b.x - cx, ky = b.y - cy;
        const kd = Math.hypot(kx, ky);
        if (kd > 1e-9) { nx = kx / kd; ny = ky / kd; }
      }
      const sp = cushionImpact(b, nx, ny, P);
      b.x += b.vx * tau; b.y += b.vy * tau;
      if (sp > 0) { hits++; if (onHit) onHit(sp); }
    }
    // final overlap resolution along the normal
    const px = b.x - cx, py = b.y - cy;
    const pd = (t > 0 && t < 1) ? px * nx + py * ny : Math.hypot(px, py);
    if (pd < Rc) { b.x += nx * (Rc - pd); b.y += ny * (Rc - pd); }
  }
  return hits;
}

/* ------------------------------------------------------------------- world */

function World(specKey, overrides) {
  const spec = Object.assign({}, SPECS[specKey], overrides || {});
  this.spec = spec;
  this.P = derive(spec);
  this.table = makeTable(this.P);
  this.balls = [];
  this.events = [];
  this.time = 0;
}

World.prototype.addBall = function (id, x, y, meta) {
  const b = createBall(id, x, y, meta);
  this.balls.push(b);
  return b;
};

World.prototype.ball = function (id) {
  for (let i = 0; i < this.balls.length; i++) if (this.balls[i].id === id) return this.balls[i];
  return null;
};

World.prototype.anyMoving = function () {
  for (let i = 0; i < this.balls.length; i++) {
    const b = this.balls[i];
    if (b.pocketed < 0 && isMoving(b)) return true;
  }
  return false;
};

World.prototype.step = function (dt) {
  const P = this.P, balls = this.balls, n = balls.length, ev = this.events;
  for (let i = 0; i < n; i++) {
    const b = balls[i];
    if (b.pocketed < 0) advanceBall(b, dt, P, true);
  }
  const D2 = 4 * P.R * P.R;
  for (let i = 0; i < n; i++) {
    const A = balls[i];
    if (A.pocketed >= 0) continue;
    for (let j = i + 1; j < n; j++) {
      const B = balls[j];
      if (B.pocketed >= 0) continue;
      const dx = B.x - A.x, dy = B.y - A.y;
      if (dx * dx + dy * dy >= D2) continue;
      const sp = collideBalls(A, B, P, dt);
      if (sp > 0) ev.push({ type: 'ball', a: A.id, b: B.id, speed: sp, t: this.time, nx: collideBalls.lastN[0], ny: collideBalls.lastN[1] });
    }
  }
  for (let i = 0; i < n; i++) {
    const b = balls[i];
    if (b.pocketed >= 0) continue;
    const id = b.id, t = this.time;
    collideCushions(b, P, this.table, dt, function (sp) { ev.push({ type: 'cushion', id: id, speed: sp, t: t }); });
    if (this.table.pockets.length) {
      const k = pocketAt(this.table, P, b.x, b.y);
      if (k >= 0) {
        const sp = Math.hypot(b.vx, b.vy);
        b.pocketed = k;
        b.vx = b.vy = b.wx = b.wy = b.wz = 0;
        ev.push({ type: 'pocket', id: b.id, pocket: k, speed: sp, t: this.time });
      }
    }
  }
  this.time += dt;
};

/** Run until everything stops (or maxTime). Returns elapsed sim time. */
World.prototype.settle = function (maxTime, dt) {
  const step = dt || 0.0005;
  const t0 = this.time;
  while (this.anyMoving() && this.time - t0 < (maxTime || 60)) this.step(step);
  return this.time - t0;
};

/* ------------------------------------------------------------- cue strike */

/** Cue-tip offset a (right) and b (up) are in units of R, |.| <= ~0.55. */
function strikeBall(ball, phi, power, a, b, P) {
  const V = Math.max(0, power) * P.cueMaxSpeed;
  const k = a * a + b * b;
  const F = (1 + P.eTip) * V * P.m / (P.m / P.cueMass + 1 + 2.5 * k);
  const v0 = F / P.m;
  const dir = phi + P.squirtK * a;               // right english squirts left (ccw)
  ball.vx = v0 * Math.cos(dir);
  ball.vy = v0 * Math.sin(dir);
  const w = 2.5 * v0 / P.R;
  ball.wx = -Math.sin(phi) * b * w;
  ball.wy = Math.cos(phi) * b * w;
  ball.wz = a * w;
  return v0;
}

/** Cue-ball speed produced by a stroke, for the UI. */
function strikeSpeed(power, a, b, P) {
  const V = power * P.cueMaxSpeed, k = a * a + b * b;
  return (1 + P.eTip) * V / (P.m / P.cueMass + 1 + 2.5 * k);
}

/* ------------------------------------------------------------ ray tracing */

/**
 * Follow a single ball through the real physics until it hits another ball,
 * is potted, stops, or exceeds the cushion / time limit. `statics` are the
 * other (stationary) balls. Returns a polyline plus how it ended.
 */
function simulatePath(world, start, statics, opts) {
  opts = opts || {};
  const P = world.P, table = world.table;
  const dt = opts.dt || 0.0005;
  const maxCushions = opts.maxCushions == null ? 3 : opts.maxCushions;
  const maxTime = opts.maxTime || 15;
  const b = { x: start.x, y: start.y, vx: start.vx, vy: start.vy, wx: start.wx, wy: start.wy, wz: start.wz, q: [1, 0, 0, 0] };
  const xs = [b.x], ys = [b.y], bi = [0];
  const D2 = 4 * P.R * P.R;
  let cushions = 0, end = { type: 'stopped' };
  let lastX = b.x, lastY = b.y;
  const spacing2 = 0.004 * 0.004;
  for (let t = 0; t < maxTime; t += dt) {
    const px = b.x, py = b.y;
    advanceBall(b, dt, P, false);
    // other balls
    let hit = null;
    for (let i = 0; i < statics.length; i++) {
      const s = statics[i];
      const dx = b.x - s.x, dy = b.y - s.y;
      if (dx * dx + dy * dy < D2) { hit = s; break; }
    }
    if (hit) {
      // back off along the step to the exact touching position
      const sx = b.x - px, sy = b.y - py;
      const fx = px - hit.x, fy = py - hit.y;
      const a = sx * sx + sy * sy, bb = fx * sx + fy * sy, cc = fx * fx + fy * fy - D2;
      let u = 1;
      if (a > 1e-18) { const disc = bb * bb - a * cc; if (disc >= 0) u = Math.max(0, Math.min(1, (-bb - Math.sqrt(disc)) / a)); }
      b.x = px + sx * u; b.y = py + sy * u;
      xs.push(b.x); ys.push(b.y); bi.push(cushions);
      end = { type: 'ball', id: hit.id, x: b.x, y: b.y, vx: b.vx, vy: b.vy, hit: hit };
      break;
    }
    const nh = collideCushions(b, P, table, dt, null);
    if (nh) {
      xs.push(b.x); ys.push(b.y); bi.push(cushions);   // hit vertex belongs to the segment that arrived
      cushions += nh;
      lastX = b.x; lastY = b.y;
      if (cushions > maxCushions) { end = { type: 'limit' }; break; }
    }
    if (table.pockets.length && pocketAt(table, P, b.x, b.y) >= 0) {
      xs.push(b.x); ys.push(b.y); bi.push(cushions);
      end = { type: 'pocket', pocket: pocketAt(table, P, b.x, b.y), x: b.x, y: b.y };
      break;
    }
    const ddx = b.x - lastX, ddy = b.y - lastY;
    if (ddx * ddx + ddy * ddy > spacing2) {
      xs.push(b.x); ys.push(b.y); bi.push(cushions);
      lastX = b.x; lastY = b.y;
    }
    if (b.vx === 0 && b.vy === 0) {
      xs.push(b.x); ys.push(b.y); bi.push(cushions);
      end = { type: 'stopped', x: b.x, y: b.y };
      break;
    }
  }
  if (end.type === 'stopped' && (b.vx !== 0 || b.vy !== 0)) end = { type: 'time' };
  return { xs: xs, ys: ys, bi: bi, end: end, cushions: cushions };
}

/**
 * Ideal (mirror) ray: straight lines, perfect reflections off the cushion
 * noses (inset by the contact radius), no spin, no friction. Stops at the first
 * ball (ghost ball position reported) or pocket.
 */
function traceIdeal(world, x, y, dx, dy, statics, maxBounces, maxLen) {
  const P = world.P, table = world.table, Rc = P.Rc, D = 2 * P.R;
  const len0 = Math.hypot(dx, dy);
  dx /= len0; dy /= len0;
  const xs = [x], ys = [y], bi = [0];
  let total = 0, bounces = 0;
  maxLen = maxLen || 60;
  let end = { type: 'limit' };
  const EPS = 1e-9;
  for (;;) {
    let bestT = Infinity, kind = null, nx = 0, ny = 0, ref = null;
    // rails, offset inward by Rc
    for (let i = 0; i < table.rails.length; i++) {
      const r = table.rails[i];
      const dn = dx * r.nx + dy * r.ny;
      if (dn >= 0) continue;
      const ox = r.x0 + r.nx * Rc, oy = r.y0 + r.ny * Rc;
      const t = ((ox - x) * r.nx + (oy - y) * r.ny) / dn;
      if (t < -EPS || t >= bestT) continue;
      const hx = x + dx * t - ox, hy = y + dy * t - oy;
      const u = (hx * r.dx + hy * r.dy) / r.len2;
      if (u < 0 || u > 1) continue;
      bestT = t; kind = 'rail'; nx = r.nx; ny = r.ny;
    }
    // knuckles (only meaningful when there are pockets)
    if (table.pockets.length) {
      for (let i = 0; i < table.knuckles.length; i++) {
        const k = table.knuckles[i];
        const fx = x - k[0], fy = y - k[1];
        const bb = fx * dx + fy * dy, cc = fx * fx + fy * fy - Rc * Rc;
        const disc = bb * bb - cc;
        if (disc < 0) continue;
        const t = -bb - Math.sqrt(disc);
        if (t < -EPS || t >= bestT) continue;
        const hx = fx + dx * t, hy = fy + dy * t;
        if (hx * dx + hy * dy >= 0) continue;                 // moving away
        bestT = t; kind = 'rail'; nx = hx / Rc; ny = hy / Rc;
      }
      // pocket mouths
      for (let i = 0; i < table.pockets.length; i++) {
        const p = table.pockets[i];
        const mx = p.k1[0] - p.k0[0], my = p.k1[1] - p.k0[1];
        const den = dx * my - dy * mx;
        if (Math.abs(den) < 1e-12) continue;
        const wx = p.k0[0] - x, wy = p.k0[1] - y;
        const t = (wx * my - wy * mx) / den;
        const u = (wx * dy - wy * dx) / den;
        if (t < -EPS || t >= bestT || u < 0 || u > 1) continue;
        // must be entering the pocket (moving outward through the mouth)
        const outx = p.kind === 'corner' ? -p.sx : 0, outy = p.kind === 'corner' ? -p.sy : -p.sy;
        if (dx * outx + dy * outy <= 0) continue;
        bestT = t; kind = 'pocket'; ref = i;
      }
    }
    // other balls
    for (let i = 0; i < statics.length; i++) {
      const s = statics[i];
      const fx = x - s.x, fy = y - s.y;
      const bb = fx * dx + fy * dy, cc = fx * fx + fy * fy - D * D;
      const disc = bb * bb - cc;
      if (disc < 0) continue;
      const t = -bb - Math.sqrt(disc);
      if (t < -EPS || t >= bestT) continue;
      if (bb >= 0) continue;                                  // moving away
      bestT = t; kind = 'ball'; ref = s;
    }
    if (bestT === Infinity) { end = { type: 'limit' }; break; }
    if (bestT < 0) bestT = 0;
    const hx = x + dx * bestT, hy = y + dy * bestT;
    total += bestT;
    xs.push(hx); ys.push(hy); bi.push(bounces);
    if (kind === 'ball') { end = { type: 'ball', id: ref.id, x: hx, y: hy, hit: ref }; break; }
    if (kind === 'pocket') { end = { type: 'pocket', pocket: ref, x: hx, y: hy }; break; }
    if (total > maxLen) { end = { type: 'limit' }; break; }
    bounces++;
    if (bounces > maxBounces) { end = { type: 'limit' }; break; }
    const dn = dx * nx + dy * ny;
    dx -= 2 * dn * nx; dy -= 2 * dn * ny;
    x = hx; y = hy;
  }
  return { xs: xs, ys: ys, bi: bi, end: end, bounces: bounces };
}

/* -------------------------------------------------------------- game setup */

const POOL_COLORS = ['#f2c200', '#1f4fc4', '#d32f2f', '#5b2a86', '#f27a0c', '#1a8a45', '#7d1d2d', '#16161a'];

function poolMeta(n) {
  if (n === 0) return { cue: true, color: '#f4f1e6', label: 'cue' };
  const c = POOL_COLORS[(n - 1) % 8];
  return { number: n, color: c, stripe: n > 8, value: 1 };
}

function rackRows(rows, apexX, cy, R) {
  const gap = 0.0002;
  const dx = SQRT3 * (R + gap / 2);
  const out = [];
  rows.forEach(function (row, i) {
    row.forEach(function (id, j) {
      out.push({ id: id, x: apexX + i * dx, y: cy + (j - (row.length - 1) / 2) * (2 * R + gap) });
    });
  });
  return out;
}

const GAMES = {
  eightball: { spec: 'pool', label: '8-Ball' },
  nineball: { spec: 'pool', label: '9-Ball' },
  snooker: { spec: 'snooker', label: 'Snooker' },
  carom: { spec: 'carom', label: '3-Cushion Carom' },
  practice: { spec: 'pool', label: 'Pool — practice (cue ball only)' },
};

const SNOOKER_COLOURS = {
  1: { color: '#c1121f', value: 1, name: 'red' },
  2: { color: '#f2c200', value: 2, name: 'yellow' },
  3: { color: '#17803a', value: 3, name: 'green' },
  4: { color: '#7a4a21', value: 4, name: 'brown' },
  5: { color: '#1f5bd6', value: 5, name: 'blue' },
  6: { color: '#ef8fb7', value: 6, name: 'pink' },
  7: { color: '#16161a', value: 7, name: 'black' },
};

/** Spot positions (colour value -> [x,y]) for snooker. */
function snookerSpots(P) {
  const L = P.L, W = P.W, cy = W / 2, baulk = 0.737, d = 0.292;
  return {
    2: [baulk, cy - d], 3: [baulk, cy + d], 4: [baulk, cy],
    5: [L / 2, cy], 6: [L * 0.75, cy], 7: [L - 0.324, cy],
  };
}

function createGame(gameKey) {
  const g = GAMES[gameKey];
  const world = new World(g.spec);
  const P = world.P, L = P.L, W = P.W, R = P.R, cy = W / 2;
  world.gameKey = gameKey;
  function add(id, x, y, meta) { return world.addBall(id, x, y, meta); }

  if (gameKey === 'eightball' || gameKey === 'nineball' || gameKey === 'practice') {
    add(0, L / 4, cy, poolMeta(0));
    if (gameKey === 'eightball') {
      const rows = [[1], [9, 2], [10, 8, 3], [11, 4, 12, 5], [7, 13, 6, 14, 15]];
      rackRows(rows, L * 0.75, cy, R).forEach(function (r) { add(r.id, r.x, r.y, poolMeta(r.id)); });
    } else if (gameKey === 'nineball') {
      const rows = [[1], [2, 3], [4, 9, 5], [6, 7], [8]];
      rackRows(rows, L * 0.75, cy, R).forEach(function (r) { add(r.id, r.x, r.y, poolMeta(r.id)); });
    }
  } else if (gameKey === 'snooker') {
    add(0, 0.737 - 0.15, cy + 0.06, { cue: true, color: '#f4f1e6', label: 'cue' });
    const spots = snookerSpots(P);
    Object.keys(spots).forEach(function (v) {
      const c = SNOOKER_COLOURS[v];
      add(100 + Number(v), spots[v][0], spots[v][1], { color: c.color, value: c.value, colour: true, spot: spots[v] });
    });
    const rows = [];
    let id = 1;
    for (let i = 0; i < 5; i++) { const row = []; for (let j = 0; j <= i; j++) row.push(id++); rows.push(row); }
    rackRows(rows, spots[6][0] + 2 * R + 0.0004, cy, R).forEach(function (r) {
      add(200 + r.id, r.x, r.y, { color: SNOOKER_COLOURS[1].color, value: 1, red: true });
    });
  } else if (gameKey === 'carom') {
    add(0, L / 4, cy - 0.18, { cue: true, color: '#f4f1e6', label: 'white', player: 0 });
    add(1, L / 4, cy + 0.18, { cue: true, color: '#f2d21b', label: 'yellow', player: 1 });
    add(2, L * 0.75, cy, { color: '#c1121f', label: 'red', object: true });
  }
  world.balls.forEach(function (b) {          // random resting orientation so numbers are not edge-on
    const u1 = Math.random(), u2 = Math.random() * TWO_PI, u3 = Math.random() * TWO_PI;
    const s1 = Math.sqrt(1 - u1), s2 = Math.sqrt(u1);
    b.q = [s2 * Math.cos(u3), s1 * Math.sin(u2), s1 * Math.cos(u2), s2 * Math.sin(u3)];
  });
  return world;
}

return {
  G: G, SPECS: SPECS, GAMES: GAMES, SNOOKER_COLOURS: SNOOKER_COLOURS,
  derive: derive, makeTable: makeTable, pocketAt: pocketAt,
  createBall: createBall, advanceBall: advanceBall, isMoving: isMoving,
  rotationMatrix: rotationMatrix, integrateOrientation: integrateOrientation,
  collideBalls: collideBalls, collideCushions: collideCushions, cushionImpact: cushionImpact,
  cushionRestitution: cushionRestitution, muBallBall: muBallBall,
  World: World, strikeBall: strikeBall, strikeSpeed: strikeSpeed,
  simulatePath: simulatePath, traceIdeal: traceIdeal,
  createGame: createGame, snookerSpots: snookerSpots,
};
});
