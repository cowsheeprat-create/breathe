'use strict';
const SC = require('../scenarios.js');
const BP = require('../physics.js');
let fails = 0;
function check(n, ok, d) { console.log((ok ? 'PASS ' : 'FAIL ') + n + (d ? ' — ' + d : '')); if (!ok) fails++; }
const deg = r => r * 180 / Math.PI;

SC.ORDER.forEach(id => {
  const b = SC.build(id);
  const P = b.P;
  const start = b.cue;
  const res = SC.run(b);
  const info = `cut ${b.cutDeg != null ? b.cutDeg.toFixed(1) : '-'}° obj potted=${res.objPotted} cue potted=${res.cuePotted} t=${res.time.toFixed(1)}s`;
  if (['straight', 'cut', 'rail', 'bank', 'throw'].indexOf(id) >= 0 && id !== 'throw') {
    check(`${id}: default shot pots the object ball`, res.objPotted, info);
  } else {
    check(`${id}: runs`, true, info);
  }
  if (res.contact && b.obj) {
    const c = res.contact;
    const sp0 = Math.hypot(c.obj.vx, c.obj.vy), cs = Math.hypot(c.cue.vx, c.cue.vy);
    console.log(`     contact: obj speed ${sp0.toFixed(2)} dir ${deg(Math.atan2(c.obj.vy, c.obj.vx)).toFixed(1)}° (line of centres ${deg(Math.atan2(b.u[1], b.u[0])).toFixed(1)}°), cue speed after ${cs.toFixed(2)}`);
  }
});

// aim error sweep for the straight-in: pot window
{
  let lo = null, hi = null;
  for (let e = -30; e <= 30; e += 2) {
    const b = SC.build('straight', { err: e });
    const r = SC.run(b);
    if (r.objPotted) { if (lo === null) lo = e; hi = e; }
  }
  check('straight-in has a pot window of a few mm each side', lo !== null && lo < -2 && hi > 2, `pots for err ${lo}…${hi} mm`);
}
console.log(fails ? fails + ' FAILED' : 'all passed');
process.exit(fails ? 1 : 0);
