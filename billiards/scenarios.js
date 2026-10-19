/* Close-up shot scenarios: two balls, a rail and a pocket, all set up so the cue
 * ball's line, the "ghost ball" contact position and the object ball's path to the
 * pocket are exact. Pure geometry + the physics engine; no rendering.
 *
 *   build(id, params) -> { world, cueId, objId, phi, power, a, b, ghost, contact, mouth, ... }
 *   run(built)        -> plays the shot to rest and reports what happened
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./physics.js'));
  else root.BilliardsScenarios = factory(root.BilliardsPhysics);
})(typeof self !== 'undefined' ? self : this, function (BP) {
'use strict';

const DEG = Math.PI / 180;

/* `controls` lists the sliders that make sense for the scenario; `d` the defaults. */
const DEFS = {
  straight: {
    name: 'Straight-in stun', kind: 'pot', target: 'corner',
    controls: ['objDist', 'dist', 'power', 'err'],
    d: { cut: 0, objDist: 0.60, dist: 0.55, power: 0.30, a: 0, b: 0, err: 0, comp: true },
    desc: 'A dead-centre hit on a straight-in shot at the corner pocket, struck at the centre of the cue ball (a "stun" shot).',
    watch: [
      'The white ball and the object ball are the same mass, so almost all of the cue ball’s speed is handed over and it stops nearly dead at contact.',
      'Because the balls are not perfectly bouncy (restitution 0.95) the cue ball keeps a sliver of speed: about 2.5 %.',
      'Turn on the ghost ball: the white ball’s centre must be exactly on the ghost when they touch, in line with the pocket.',
    ],
  },
  cut: {
    name: 'Cut shot', kind: 'pot', target: 'corner',
    controls: ['cut', 'objDist', 'dist', 'power', 'err'],
    d: { cut: 30, objDist: 0.60, dist: 0.55, power: 0.32, a: 0, b: 0, err: 0, comp: true },
    desc: 'The cue ball hits the object ball off-centre. The ghost ball shows exactly where the cue ball has to be at contact to send the object ball to the pocket.',
    watch: [
      'The object ball leaves along the line of centres (ghost ball → object ball), not along the direction the cue ball was travelling.',
      'The cue ball leaves roughly at right angles to that line (the 90° rule for a stun hit); with a 30° cut that is the “half-ball” hit.',
      'Drag “Cut angle” to change how full the hit is, or push “Aim error” to miss by a few millimetres and see where the object ball ends up.',
    ],
  },
  follow: {
    name: 'Follow (topspin)', kind: 'pot', target: 'open',
    controls: ['cut', 'dist', 'power', 'err'],
    d: { cut: 0, objDist: 0, dist: 0.50, power: 0.25, a: 0, b: 0.4, err: 0, comp: true },
    desc: 'Same straight hit, but the tip strikes the cue ball above centre so it spins forward.',
    watch: [
      'At contact the cue ball stops its forward motion — but its topspin is still turning, so the cloth drags it forward after the object ball has left.',
      'In the readout “Spin ratio” starts at +1 (rolling) and the cue ball’s dots keep rotating forward after the hit.',
      'Compare with the Draw scenario: only the tip position changed.',
    ],
  },
  draw: {
    name: 'Draw (backspin)', kind: 'pot', target: 'open',
    controls: ['cut', 'dist', 'power', 'err'],
    d: { cut: 0, objDist: 0, dist: 0.50, power: 0.35, a: 0, b: -0.45, err: 0, comp: true },
    desc: 'The tip strikes below centre: the cue ball is sliding with backspin when it hits.',
    watch: [
      'The cue ball stops at contact, then the backspin grips the cloth and pulls it back toward you.',
      'The dotted trail spacing shows speed: dots bunch up when the cue ball is slow and spread out when it is fast.',
      'Draw needs speed and a low tip position; try lowering the power to see it fail to return.',
    ],
  },
  throw: {
    name: 'Cut + english (throw)', kind: 'pot', target: 'open',
    controls: ['cut', 'dist', 'power', 'err'],
    d: { cut: 30, objDist: 0, dist: 0.50, power: 0.30, a: 0.45, b: 0, err: 0, comp: true },
    desc: 'A cut shot with side spin (right english). Friction between the two balls drags the object ball off the line of centres.',
    watch: [
      'The readout “Throw” is the angle between the object ball’s real path and the line of centres: that is the effect of the side spin.',
      'English also “squirts” the cue ball slightly the other way as it leaves the tip. “Compensate squirt” aims so that the cue ball still leaves on the line.',
      'Switch the English widget to the left and the throw changes direction.',
    ],
  },
  thin: {
    name: 'Thin cut', kind: 'pot', target: 'open',
    controls: ['cut', 'dist', 'power', 'err'],
    d: { cut: 55, objDist: 0, dist: 0.50, power: 0.40, a: 0, b: 0, err: 0, comp: true },
    desc: 'A very thin hit: the cue ball just clips the edge of the object ball.',
    watch: [
      'Only about one eighth of the ball is covered, so the object ball is nudged away slowly along the line of centres.',
      'The cue ball barely changes direction and keeps most of its speed: compare “Cue ball after” with the straight-in shot.',
      'Thin cuts are the least forgiving: a millimetre of aim error changes the cut angle by several degrees.',
    ],
  },
  rail: {
    name: 'Rail-hugging shot', kind: 'pot', target: 'corner', railHug: true,
    controls: ['cut', 'objDist', 'dist', 'power', 'err'],
    d: { cut: -18, objDist: 0.60, dist: 0.50, power: 0.28, a: 0, b: 0, err: 0, comp: true },
    desc: 'The object ball is touching the long cushion and is cut along the rail into the corner pocket.',
    watch: [
      'The object ball travels right along the cushion nose. Its centre must stay clear of the pocket jaws (the knuckle) to go in.',
      'The cut here is thin, so the cue ball keeps most of its speed and comes off at a shallow angle.',
      'Use the “Rail” camera for a low view along the cushion.',
    ],
  },
  bank: {
    name: 'Bank shot', kind: 'pot', target: 'bank',
    controls: ['cut', 'objDist', 'dist', 'power', 'err'],
    d: { cut: 15, objDist: 1.00, dist: 0.50, power: 0.30, a: 0, b: 0, err: 0, comp: true },
    desc: 'The object ball is banked off the far cushion toward the corner pocket. The dashed line is the perfect mirror-image path.',
    watch: [
      'The real ball does not follow the mirror line: it loses speed on the cushion and its path comes off shorter than the mirror angle.',
      'The “Rail” camera shows the contact point on the cushion nose: the contact is above the ball’s centre, which is what makes the rebound deviate.',
      'A harder bank changes the rebound angle: restitution is lower at high speed.',
    ],
  },
  cushion: {
    name: 'Cushion lab', kind: 'lab', target: 'none',
    controls: ['cut', 'dist', 'power'],
    d: { cut: 45, objDist: 0, dist: 0.60, power: 0.30, a: 0, b: 0.4, err: 0, comp: false },
    desc: 'A single ball into the long cushion. Choose the angle, speed and spin and compare the real rebound with the perfect mirror.',
    watch: [
      '“Cut angle” here is the angle of incidence from the cushion’s normal. The dashed line is what a perfect mirror would do.',
      'Side spin (left or right english) changes the angle: the cushion grips the ball and the spin turns into sideways speed.',
      'Top and back spin also change speed and angle because the contact is above the ball’s centre.',
    ],
  },
};

const ORDER = ['straight', 'cut', 'thin', 'follow', 'draw', 'throw', 'rail', 'bank', 'cushion'];

function rot(x, y, a) { const c = Math.cos(a), s = Math.sin(a); return [x * c - y * s, x * s + y * c]; }
function unit(x, y) { const l = Math.hypot(x, y) || 1; return [x / l, y / l]; }

function insideTable(P, x, y) {
  return x > P.Rc + 0.002 && x < P.L - P.Rc - 0.002 && y > P.Rc + 0.002 && y < P.W - P.Rc - 0.002;
}

function build(id, params) {
  const def = DEFS[id];
  const prm = Object.assign({}, def.d, params || {});
  const w = new BP.World('pool');
  const P = w.P, R = P.R, Rc = P.Rc, L = P.L, W = P.W;
  const aC = P.cornerMouth / Math.SQRT2;
  const mouth = [L - aC / 2, aC / 2];                     // bottom-right corner pocket, mouth midpoint
  const out = {
    id: id, def: def, params: prm, world: w, cueId: 0, objId: null, P: P,
    ghost: null, contact: null, mouth: null, ideal: null, bankPoint: null,
    focus: null, axis: 0, cut: prm.cut, fullness: null, hit: null,
  };

  if (def.kind === 'lab') {
    const alpha = prm.cut * DEG;
    const dir = [Math.sin(alpha), -Math.cos(alpha)];
    const H = [1.4, Rc];                                   // aim point on the bottom cushion (centre path)
    const C = [H[0] - dir[0] * prm.dist, H[1] - dir[1] * prm.dist];
    out.cue = w.addBall(0, C[0], C[1], { cue: true, color: '#f4f1e6', label: 'cue' });
    out.phiLine = Math.atan2(dir[1], dir[0]);
    out.phi = out.phiLine;
    out.axis = out.phiLine;
    out.focus = { x: H[0], y: 0.12 };
    out.bankPoint = { x: H[0], y: 0 };
    out.ideal = BP.traceIdeal(w, C[0], C[1], dir[0], dir[1], [], 1, 20);
    out.power = prm.power; out.a = prm.a; out.b = prm.b;
    out.start = C;
    tilt(out.cue);
    return out;
  }

  // ---- object ball position and the point it should travel toward
  let O, T, u;
  if (def.target === 'corner') {
    if (def.railHug) O = [L - prm.objDist, Rc + 0.0004];
    else {
      const bearing = 135 * DEG;
      O = [mouth[0] + prm.objDist * Math.cos(bearing), mouth[1] + prm.objDist * Math.sin(bearing)];
    }
    T = mouth; u = unit(T[0] - O[0], T[1] - O[1]);
    out.mouth = { x: mouth[0], y: mouth[1] };
  } else if (def.target === 'bank') {
    O = [L - prm.objDist, 0.40];
    const topY = W - Rc;
    const Tm = [mouth[0], 2 * topY - mouth[1]];            // pocket mirrored in the cushion
    u = unit(Tm[0] - O[0], Tm[1] - O[1]);
    T = mouth;
    out.mouth = { x: mouth[0], y: mouth[1] };
    out.ideal = BP.traceIdeal(w, O[0], O[1], u[0], u[1], [], 1, 20);
    out.bankPoint = { x: out.ideal.xs[1], y: W };
  } else {
    O = [1.55, W / 2];
    u = [1, 0]; T = [O[0] + 1.5, O[1]];
  }

  // ---- ghost ball and cue-ball start
  const G = [O[0] - 2 * R * u[0], O[1] - 2 * R * u[1]];
  const c = rot(u[0], u[1], prm.cut * DEG);                // cue ball travel direction (line)
  let dist = prm.dist, C;
  for (let i = 0; i < 40; i++) {
    C = [G[0] - c[0] * dist, G[1] - c[1] * dist];
    if (insideTable(P, C[0], C[1])) break;
    dist *= 0.93;
  }
  const perp = [-c[1], c[0]];
  const aim = [G[0] + perp[0] * prm.err / 1000, G[1] + perp[1] * prm.err / 1000];
  const phiLine = Math.atan2(aim[1] - C[1], aim[0] - C[0]);
  const squirt = prm.comp ? P.squirtK * prm.a : 0;

  out.cue = w.addBall(0, C[0], C[1], { cue: true, color: '#f4f1e6', label: 'cue' });
  out.obj = w.addBall(1, O[0], O[1], { color: '#f2c200', number: 1, stripe: false });
  out.objId = 1;
  out.obj.q = [Math.SQRT1_2, 0, -Math.SQRT1_2, 0];         // number facing up
  tilt(out.cue);
  out.ghost = { x: G[0], y: G[1] };
  out.contact = { x: O[0] - u[0] * R, y: O[1] - u[1] * R };
  out.u = u; out.target = { x: T[0], y: T[1] };
  out.phiLine = phiLine;
  out.phi = phiLine - squirt;
  out.axis = phiLine;
  out.start = C;
  out.power = prm.power; out.a = prm.a; out.b = prm.b;
  out.cutDeg = Math.abs(Math.acos(Math.max(-1, Math.min(1, c[0] * u[0] + c[1] * u[1]))) / DEG);
  out.fullness = 1 - Math.sin(out.cutDeg * DEG);
  out.focus = { x: (G[0] + O[0]) / 2, y: (G[1] + O[1]) / 2 };
  return out;
}

function tilt(ball) {
  const q = [0.93, 0.18, 0.22, 0.2], n = Math.hypot(q[0], q[1], q[2], q[3]);
  ball.q = q.map(function (v) { return v / n; });
}

/** Play the shot to rest. Returns what happened (used by tests and by the UI for validation). */
function run(b, maxTime) {
  const w = b.world, P = w.P;
  BP.strikeBall(b.cue, b.phi, b.power, b.a, b.b, P);
  w.events.length = 0;
  const t0 = w.time;
  let firstBall = null, first = null;
  while (w.anyMoving() && w.time - t0 < (maxTime || 40)) {
    w.step(0.0005);
    for (let i = 0; i < w.events.length; i++) {
      const e = w.events[i];
      if (e.type === 'ball' && !first) first = { t: w.time, cue: { vx: b.cue.vx, vy: b.cue.vy }, obj: b.obj ? { vx: b.obj.vx, vy: b.obj.vy } : null };
    }
    w.events.length = 0;
  }
  return {
    objPotted: !!(b.obj && b.obj.pocketed >= 0),
    cuePotted: b.cue.pocketed >= 0,
    contact: first,
    time: w.time - t0,
  };
}

return { DEFS: DEFS, ORDER: ORDER, build: build, run: run };
});
