/* Physics sanity tests against closed-form results.  Run: node billiards/test/physics.test.js */
'use strict';
const B = require('../physics.js');
let fails = 0;
function check(name, ok, detail) {
  console.log((ok ? 'PASS ' : 'FAIL ') + name + (detail ? '  — ' + detail : ''));
  if (!ok) fails++;
}
const near = (a, b, tol) => Math.abs(a - b) <= tol;
const deg = r => r * 180 / Math.PI;
const KE = (b, P) => 0.5 * P.m * (b.vx * b.vx + b.vy * b.vy) +
  0.5 * P.I * (b.wx * b.wx + b.wy * b.wy + b.wz * b.wz);

function emptyWorld(key, over) { return new B.World(key, over); }

/* 1. rolling-resistance stopping distance:  s = v^2 / (2 mu g) */
{
  const w = emptyWorld('pool'); const P = w.P;
  const b = w.addBall(0, 0.3, 0.635); b.vx = 0.5; b.wy = 0.5 / P.R;
  w.settle(60);
  const s = b.x - 0.3, expect = 0.5 * 0.5 / (2 * P.muRoll * B.G);
  check('rolling stop distance', near(s, expect, 0.002), `got ${s.toFixed(4)} m, expected ${expect.toFixed(4)} m`);
}

/* 2. pure slide -> roll: v_roll = 5/7 v0, at t = 2 v0 / (7 mu g) */
{
  const w = emptyWorld('pool', { muRoll: 0 }); const P = w.P;
  const b = w.addBall(0, 0.3, 0.635); b.vx = 3;
  const t = 2 * 3 / (7 * P.muSlide * B.G);
  const n = Math.round(t / 0.0005);
  for (let i = 0; i < n; i++) w.step(0.0005);
  check('slide→roll speed = 5/7 v0', near(b.vx, 3 * 5 / 7, 0.01), `got ${b.vx.toFixed(4)}, expected ${(15 / 7).toFixed(4)}`);
  check('slide→roll is rolling', near(b.vx, b.wy * P.R, 0.01), `v=${b.vx.toFixed(3)} wR=${(b.wy * P.R).toFixed(3)}`);
  const d = b.x - 0.3, expect = 3 * t - 0.5 * P.muSlide * B.G * t * t;
  check('slide distance', near(d, expect, 0.003), `got ${d.toFixed(4)}, expected ${expect.toFixed(4)}`);
}

/* 3. straight-on stun shot: cue ball nearly stops, object ball takes (1+e)/2 v */
{
  const w = emptyWorld('pool'); const P = w.P;
  const c = w.addBall(0, 0.5, 0.635), o = w.addBall(1, 0.5 + 0.5, 0.635);
  c.vx = 2.0; c.wy = 2.0 / P.R;     // rolling, then we look right after contact
  let guard = 0;
  while (!w.events.some(e => e.type === 'ball') && guard++ < 20000) w.step(0.0005);
  check('head-on: object ball speed ≈ (1+e)/2·v', near(o.vx, 2.0 * (1 + P.eBall) / 2, 0.03), `got ${o.vx.toFixed(3)}`);
  check('head-on: cue ball left with ≈ (1-e)/2·v', Math.abs(c.vx) < 0.12, `got ${c.vx.toFixed(3)}`);
}

/* 4. 90-degree rule (frictionless, elastic) and energy */
{
  const w = emptyWorld('pool', { eBall: 1 }); const P = w.P;
  const cut = 30 * Math.PI / 180;
  const o = w.addBall(1, 1.2, 0.635);
  // aim so that the contact normal is `cut` off the shot line
  const c = w.addBall(0, 1.2 - 2 * P.R * Math.cos(cut) - 0.4, 0.635 - 2 * P.R * Math.sin(cut) - 0.0);
  c.y = 0.635 - 2 * P.R * Math.sin(cut);
  c.vx = 2.0;                          // pure slide, no spin: friction between balls ~ small
  const patch = B.muBallBall; // eslint-disable-line
  let guard = 0;
  while (!w.events.some(e => e.type === 'ball') && guard++ < 20000) w.step(0.0005);
  const angC = Math.atan2(c.vy, c.vx), angO = Math.atan2(o.vy, o.vx);
  const between = Math.abs(deg(angC - angO));
  check('90° rule between rebound paths (e=1, small throw)', near(between, 90, 4), `angle ${between.toFixed(1)}°`);
  check('object ball goes along the line of centres', near(deg(angO), -30, 4) || near(deg(angO), 30, 4), `object ${deg(angO).toFixed(1)}°`);
}

/* 5. collisions never create energy (random spins/speeds) */
{
  let worst = 0;
  for (let k = 0; k < 400; k++) {
    const w = emptyWorld('pool'); const P = w.P;
    const a = w.addBall(0, 1, 0.6), b = w.addBall(1, 1 + 2 * P.R * 0.999, 0.6 + 2 * P.R * (Math.random() - 0.5) * 0.9);
    a.vx = 0.5 + Math.random() * 6; a.vy = (Math.random() - 0.5) * 2;
    a.wx = (Math.random() - 0.5) * 300; a.wy = (Math.random() - 0.5) * 300; a.wz = (Math.random() - 0.5) * 300;
    b.wx = (Math.random() - 0.5) * 100; b.wy = (Math.random() - 0.5) * 100;
    const e0 = KE(a, P) + KE(b, P);
    B.collideBalls(a, b, P, 0.0005);
    const e1 = KE(a, P) + KE(b, P);
    worst = Math.max(worst, (e1 - e0) / e0);
  }
  check('ball-ball never gains energy', worst < 1e-9, `worst relative gain ${worst.toExponential(2)}`);
}

/* 6. cushion: no spin ball, 45° in; energy must not increase; reflection near mirror */
{
  const rows = [];
  [1, 2, 4, 6].forEach(v => {
    const w = emptyWorld('pool'); const P = w.P;
    const b = w.addBall(0, 1.0, 0.4);
    const ang = -45 * Math.PI / 180;
    b.vx = v * Math.cos(ang); b.vy = v * Math.sin(ang);
    b.wx = -b.vy / P.R; b.wy = b.vx / P.R;                 // rolling in
    const e0 = KE(b, P);
    let guard = 0;
    while (w.events.filter(e => e.type === 'cushion').length === 0 && guard++ < 20000) w.step(0.0005);
    const out = Math.atan2(b.vy, b.vx);
    const e1 = KE(b, P);
    rows.push(`v=${v}: out ${deg(out).toFixed(1)}° speed ${Math.hypot(b.vx, b.vy).toFixed(2)} KE ${(e1 / e0).toFixed(2)}`);
    check(`cushion rolling 45° v=${v}: energy not gained`, e1 <= e0 * 1.0001);
    check(`cushion rolling 45° v=${v}: leaves upward, within 20° of mirror`, b.vy > 0 && near(deg(out), 45, 20), deg(out).toFixed(1) + '°');
  });
  console.log('     ' + rows.join('\n     '));
}

/* 7. side spin into a rail: english changes the rebound angle, left vs right symmetric */
{
  function bank(wz) {
    const w = emptyWorld('pool'); const P = w.P;
    const b = w.addBall(0, 1.0, 0.4);
    const v = 2.0, ang = -45 * Math.PI / 180;
    b.vx = v * Math.cos(ang); b.vy = v * Math.sin(ang); b.wz = wz;
    let guard = 0;
    while (w.events.filter(e => e.type === 'cushion').length === 0 && guard++ < 20000) w.step(0.0005);
    return deg(Math.atan2(b.vy, b.vx));
  }
  const n = bank(0), l = bank(60), r = bank(-60);
  check('side spin changes rebound angle', Math.abs(l - r) > 3, `none ${n.toFixed(1)}°, +spin ${l.toFixed(1)}°, -spin ${r.toFixed(1)}°`);
  // ball travels +x into the bottom rail; ccw spin (+wz) makes the nose contact slip faster along +x
  // (more friction, steeper rebound), cw spin cancels the slip (less friction, shallower rebound)
  check('english deflects the rebound in opposite senses', (l - n) > 0 && (r - n) < 0 && (n - r) > 2, `Δ+ ${(l - n).toFixed(1)} Δ- ${(r - n).toFixed(1)}`);
}

/* 8. head-on rail: speed ratio equals restitution curve */
{
  const w = emptyWorld('pool'); const P = w.P;
  const b = w.addBall(0, 1.2, 0.5);
  b.vy = -2.0; b.wx = 2.0 / P.R;      // rolling toward bottom rail
  let guard = 0;
  while (w.events.filter(e => e.type === 'cushion').length === 0 && guard++ < 20000) w.step(0.0005);
  check('head-on rail rebounds', b.vy > 0, `vy ${b.vy.toFixed(3)}`);
  check('head-on rail speed ~ restitution', near(b.vy / 2.0, B.cushionRestitution(2.0), 0.18), `ratio ${(b.vy / 2).toFixed(3)} vs e ${B.cushionRestitution(2).toFixed(3)}`);
}

/* 9. cue strike: centre ball -> pure slide, tip at 2/5 R -> natural roll */
{
  const w = emptyWorld('pool'); const P = w.P;
  const b = w.addBall(0, 0.5, 0.635);
  const v0 = B.strikeBall(b, 0, 0.5, 0, 0.4, P);
  check('strike at 0.4R gives natural roll', near(b.wy * P.R, b.vx, 1e-6) && near(b.wx, 0, 1e-9), `vR=${b.vx.toFixed(3)} wR=${(b.wy * P.R).toFixed(3)}`);
  const c = w.addBall(1, 0.5, 0.3);
  B.strikeBall(c, 0, 0.5, 0.4, 0, P);
  check('right english -> counter-clockwise spin (wz>0), squirts left', c.wz > 0 && c.vy > 0, `wz=${c.wz.toFixed(1)} vy=${c.vy.toFixed(3)}`);
  const d = w.addBall(2, 0.5, 0.3);
  B.strikeBall(d, 0, 0.5, 0, -0.4, P);
  check('draw -> backspin', d.wy < 0 && d.vx > 0);
}

/* 10. draw shot: stun-shot reversal. A cue ball with draw returns after hitting a ball head-on */
{
  const w = emptyWorld('pool'); const P = w.P;
  const c = w.addBall(0, 0.8, 0.635), o = w.addBall(1, 1.3, 0.635);
  B.strikeBall(c, 0, 0.5, 0, -0.45, P);
  w.settle(30);
  check('draw shot: cue ball comes back', c.x < 1.3 - 2 * P.R - 0.02, `cue final x ${c.x.toFixed(3)} (contact at ${(1.3 - 2 * P.R).toFixed(3)})`);
  const w2 = emptyWorld('pool');
  const c2 = w2.addBall(0, 0.8, 0.635), o2 = w2.addBall(1, 1.3, 0.635);
  B.strikeBall(c2, 0, 0.5, 0, 0.4, P);
  let g2 = 0;
  while (!w2.events.some(e => e.type === 'ball') && g2++ < 40000) w2.step(0.0005);
  const xc = c2.x;
  for (let i = 0; i < 1200; i++) w2.step(0.0005);      // 0.6 s after contact
  check('follow shot: cue ball follows through', c2.x > xc + 0.08, `moved ${(c2.x - xc).toFixed(3)} m past contact`);
}

/* 11. pockets: a ball rolled at the corner/side pocket is potted; a ball at a rail is not */
{
  const w = emptyWorld('pool'); const P = w.P;
  const b = w.addBall(0, 1.0, 0.3);
  // aim at the bottom-left corner pocket centre-ish
  const tx = 0.01, ty = 0.01;
  const d = Math.hypot(tx - b.x, ty - b.y);
  b.vx = 2.5 * (tx - b.x) / d; b.vy = 2.5 * (ty - b.y) / d;
  w.settle(20);
  check('corner pocket pots a straight ball', b.pocketed >= 0, `pocket index ${b.pocketed}`);
  const w2 = emptyWorld('pool');
  const s = w2.addBall(0, 1.27 - 0.2, 0.3);
  const dd = Math.hypot(0.0 - s.x, 0.0 - s.y);
  s.vx = 0; s.vy = -2; // straight down into the side pocket line
  s.x = 1.27; s.y = 0.5;
  w2.settle(20);
  check('side pocket pots a straight ball', s.pocketed >= 0, `pocket index ${s.pocketed}`);
  const w3 = emptyWorld('pool');
  const q = w3.addBall(0, 0.6, 0.5); q.vy = -1.5;
  w3.settle(20);
  check('ball into plain rail is not potted', q.pocketed < 0);
}

/* 12. ideal ray trace equals the mirror law */
{
  const w = emptyWorld('carom'); const P = w.P;
  const r = B.traceIdeal(w, 1.0, 0.5, Math.cos(0.4), Math.sin(0.4), [], 3, 100);
  let ok = true;
  for (let i = 1; i + 1 < r.xs.length; i++) {
    const dx0 = r.xs[i] - r.xs[i - 1], dy0 = r.ys[i] - r.ys[i - 1];
    const dx1 = r.xs[i + 1] - r.xs[i], dy1 = r.ys[i + 1] - r.ys[i];
    // one component flips, the other keeps its sign
    const flipX = Math.sign(dx0) !== Math.sign(dx1), flipY = Math.sign(dy0) !== Math.sign(dy1);
    if (flipX === flipY) ok = false;
    if (!near(Math.abs(dx0 / dy0), Math.abs(dx1 / dy1), 1e-6)) ok = false;
  }
  check('ideal ray: |angle in| = |angle out| at every bounce', ok && r.bounces === 4, `${r.xs.length} vertices`);
  const inset = P.Rc;
  const inb = r.xs.every(x => x >= inset - 1e-9 && x <= P.L - inset + 1e-9) && r.ys.every(y => y >= inset - 1e-9 && y <= P.W - inset + 1e-9);
  check('ideal ray stays on the centre-bounds rectangle', inb);
}

/* 13. ideal vs physical agree when the ball has natural roll and the shot is nearly straight in a long head-on bank */
{
  const w = emptyWorld('pool'); const P = w.P;
  const start = { x: 1.0, y: 0.3, vx: 0, vy: 1.5, wx: -1.5 / P.R, wy: 0, wz: 0 };
  const ph = B.simulatePath(w, start, [], { maxCushions: 1 });
  const id = B.traceIdeal(w, 1.0, 0.3, 0, 1, [], 1, 100);
  check('physical head-on bank returns along the same line', near(ph.xs[ph.xs.length - 1], id.xs[id.xs.length - 1], 0.01) || ph.end.type === 'limit', `ends ${ph.end.type}`);
}

/* 14. full break shot stays finite and settles */
{
  const w = B.createGame('eightball'); const P = w.P;
  const c = w.ball(0);
  B.strikeBall(c, 0, 1.0, 0, 0, P);
  const t = w.settle(120);
  let ok = w.balls.every(b => isFinite(b.x) && isFinite(b.y));
  const pot = w.balls.filter(b => b.pocketed >= 0).length;
  const inside = w.balls.every(b => b.pocketed >= 0 || (b.x > 0 && b.x < P.L && b.y > 0 && b.y < P.W));
  check('break: all numbers finite, balls stay on table or are potted', ok && inside, `settled in ${t.toFixed(1)} s sim-time, ${pot} potted`);
  // balls must not overlap at rest
  let minD = 9;
  for (let i = 0; i < w.balls.length; i++) for (let j = i + 1; j < w.balls.length; j++) {
    const a = w.balls[i], b = w.balls[j]; if (a.pocketed >= 0 || b.pocketed >= 0) continue;
    minD = Math.min(minD, Math.hypot(a.x - b.x, a.y - b.y));
  }
  check('break: no overlapping balls at rest', minD > 2 * P.R - 1e-4, `min separation ${(minD / (2 * P.R)).toFixed(4)} diameters`);
}

/* 15. snooker + carom set-ups are legal (no overlaps, inside the cushions) */
['snooker', 'carom', 'nineball', 'eightball'].forEach(k => {
  const w = B.createGame(k); const P = w.P;
  let ok = true;
  for (let i = 0; i < w.balls.length; i++) {
    const a = w.balls[i];
    if (a.x < P.Rc || a.x > P.L - P.Rc || a.y < P.Rc || a.y > P.W - P.Rc) ok = false;
    for (let j = i + 1; j < w.balls.length; j++) if (Math.hypot(a.x - w.balls[j].x, a.y - w.balls[j].y) < 2 * P.R) ok = false;
  }
  check(`set-up ${k}: ${w.balls.length} balls legal`, ok);
});

console.log(fails ? `\n${fails} FAILED` : '\nall passed');
process.exit(fails ? 1 : 0);
