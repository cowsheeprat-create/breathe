/* Cue close-up: a 3-D view of one rail, one pocket and two balls, driven by the
 * same physics engine as the table game. */
(function () {
'use strict';
var BP = window.BilliardsPhysics, SC = window.BilliardsScenarios;
var $ = function (id) { return document.getElementById(id); };
var TAU = Math.PI * 2, DEG = Math.PI / 180, DT = 0.0005;
var SPEC = BP.derive(BP.SPECS.pool);
var R = SPEC.R, Rc = SPEC.Rc, L = SPEC.L, W = SPEC.W;
var NOSE_H = SPEC.cushionFrac * 2 * R;          // height of the cushion nose above the cloth
var TABLE = BP.makeTable(SPEC);

var renderer;
try {
  renderer = new THREE.WebGLRenderer({ canvas: $('gl'), antialias: true, powerPreference: 'high-performance' });
} catch (e) { $('err').style.display = 'flex'; return; }
renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
renderer.outputEncoding = THREE.sRGBEncoding;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.0;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;

var scene = new THREE.Scene();
scene.background = new THREE.Color(0x07090d);
scene.fog = new THREE.Fog(0x07090d, 3.5, 9);
var camera = new THREE.PerspectiveCamera(36, 1, 0.01, 30);

function V(x, y, z) { return new THREE.Vector3(x, z, -y); }     // physics (x, y, up) -> three
function wrap(a) { while (a > Math.PI) a -= TAU; while (a < -Math.PI) a += TAU; return a; }
function fmt(v, d) { return (v >= 0 ? '' : '−') + Math.abs(v).toFixed(d); }
function sgn(v, d) { return (v >= 0 ? '+' : '−') + Math.abs(v).toFixed(d); }

/* ================================================================ lights */
scene.add(new THREE.HemisphereLight(0xcfe0ff, 0x16241c, 0.42));
var spot = new THREE.SpotLight(0xfff0d8, 1.05, 0, 0.62, 0.75, 1);
spot.castShadow = true;
spot.shadow.mapSize.set(2048, 2048);
spot.shadow.bias = -0.00015;
spot.shadow.camera.near = 0.3; spot.shadow.camera.far = 4;
scene.add(spot); scene.add(spot.target);
var rim = new THREE.DirectionalLight(0x9ab8ff, 0.35);
rim.position.set(-1.5, 1.2, 2.2); scene.add(rim);

/* =============================================================== textures */
function canvasTex(c, srgb) {
  var t = new THREE.CanvasTexture(c);
  if (srgb !== false) t.encoding = THREE.sRGBEncoding;
  t.anisotropy = Math.min(8, renderer.capabilities.getMaxAnisotropy());
  return t;
}
function noisePattern(ctx, size, alpha) {
  var n = document.createElement('canvas'); n.width = n.height = size;
  var c = n.getContext('2d'), img = c.createImageData(size, size);
  for (var i = 0; i < img.data.length; i += 4) {
    var v = Math.random() * 255;
    img.data[i] = img.data[i + 1] = img.data[i + 2] = v; img.data[i + 3] = alpha;
  }
  c.putImageData(img, 0, 0);
  return ctx.createPattern(n, 'repeat');
}

var M = 0.26, PPM = 620;
var TW = Math.round((L + 2 * M) * PPM), TH = Math.round((W + 2 * M) * PPM);
function X(x) { return (x + M) * PPM; }
function Y(y) { return (W + M - y) * PPM; }
function poly(c, pts) {
  c.beginPath();
  pts.forEach(function (p, i) { if (i) c.lineTo(X(p[0]), Y(p[1])); else c.moveTo(X(p[0]), Y(p[1])); });
  c.closePath();
}
function pocketCuts(c) {
  c.globalCompositeOperation = 'destination-out'; c.fillStyle = '#000';
  TABLE.pockets.forEach(function (p) {
    if (p.kind === 'corner') {
      poly(c, [[p.cx + p.sx * p.a, p.cy], [p.cx, p.cy + p.sy * p.a], [p.cx - p.sx * 0.3, p.cy + p.sy * p.a],
        [p.cx - p.sx * 0.3, p.cy - p.sy * 0.3], [p.cx + p.sx * p.a, p.cy - p.sy * 0.3]]);
    } else {
      poly(c, [[p.cx - p.hs, p.cy], [p.cx + p.hs, p.cy], [p.cx + p.hs, p.cy - p.sy * 0.3], [p.cx - p.hs, p.cy - p.sy * 0.3]]);
    }
    c.fill();
  });
  c.globalCompositeOperation = 'source-over';
}
function makeClothTexture() {
  var cv = document.createElement('canvas'); cv.width = TW; cv.height = TH;
  var c = cv.getContext('2d');
  c.fillStyle = '#106b44';
  c.fillRect(X(-0.08), Y(W + 0.08), (L + 0.16) * PPM, (W + 0.16) * PPM);
  c.globalAlpha = 0.07; c.fillStyle = noisePattern(c, 128, 255);
  c.fillRect(0, 0, TW, TH); c.globalAlpha = 1;
  pocketCuts(c);
  return canvasTex(cv);
}
function makeWoodTexture() {
  var cv = document.createElement('canvas'); cv.width = TW; cv.height = TH;
  var c = cv.getContext('2d');
  var g = c.createLinearGradient(0, 0, 0, TH);
  g.addColorStop(0, '#4a2c17'); g.addColorStop(0.5, '#3d2312'); g.addColorStop(1, '#4a2c17');
  c.fillStyle = g;
  c.fillRect(X(-0.24), Y(W + 0.24), (L + 0.48) * PPM, (W + 0.48) * PPM);
  for (var i = 0; i < 260; i++) {                                    // grain
    c.strokeStyle = 'rgba(' + (20 + Math.random() * 30 | 0) + ',10,0,' + (0.05 + Math.random() * 0.1) + ')';
    c.lineWidth = 1 + Math.random() * 2;
    var y = Math.random() * TH;
    c.beginPath(); c.moveTo(0, y); c.bezierCurveTo(TW * 0.3, y + Math.random() * 14 - 7, TW * 0.7, y + Math.random() * 14 - 7, TW, y + Math.random() * 10 - 5); c.stroke();
  }
  c.globalCompositeOperation = 'destination-out'; c.fillStyle = '#000';
  c.fillRect(X(-0.062), Y(W + 0.062), (L + 0.124) * PPM, (W + 0.124) * PPM);
  TABLE.pockets.forEach(function (p) {
    var cx, cy, r;
    if (p.kind === 'corner') { cx = p.cx - p.sx * 0.025; cy = p.cy - p.sy * 0.025; r = 0.088; }
    else { cx = p.cx; cy = p.cy - p.sy * 0.035; r = 0.085; }
    c.beginPath(); c.arc(X(cx), Y(cy), r * PPM, 0, TAU); c.fill();
  });
  c.globalCompositeOperation = 'source-over';
  c.fillStyle = '#e9e0c8';                                           // diamonds
  function dia(x, y) { c.save(); c.translate(X(x), Y(y)); c.rotate(Math.PI / 4); var q = 0.0085 * PPM; c.fillRect(-q / 2, -q / 2, q, q); c.restore(); }
  for (var k = 1; k < 8; k++) { if (k === 4) continue; dia(L * k / 8, -0.125); dia(L * k / 8, W + 0.125); }
  for (var j = 1; j < 4; j++) { dia(-0.125, W * j / 4); dia(L + 0.125, W * j / 4); }
  return canvasTex(cv);
}

/* ================================================================== table */
var tableGroup = new THREE.Group(); scene.add(tableGroup);
(function buildTable() {
  var cloth = new THREE.Mesh(new THREE.PlaneGeometry(L + 2 * M, W + 2 * M),
    new THREE.MeshStandardMaterial({ map: makeClothTexture(), roughness: 0.96, alphaTest: 0.5 }));
  cloth.rotation.x = -Math.PI / 2; cloth.position.set(L / 2, 0, -W / 2); cloth.receiveShadow = true;
  tableGroup.add(cloth);
  var wood = new THREE.Mesh(new THREE.PlaneGeometry(L + 2 * M, W + 2 * M),
    new THREE.MeshStandardMaterial({ map: makeWoodTexture(), roughness: 0.7, alphaTest: 0.5 }));
  wood.rotation.x = -Math.PI / 2; wood.position.set(L / 2, 0.0375, -W / 2); wood.receiveShadow = true;
  tableGroup.add(wood);
  var floor = new THREE.Mesh(new THREE.PlaneGeometry(L + 2 * M, W + 2 * M), new THREE.MeshBasicMaterial({ color: 0x020202 }));
  floor.rotation.x = -Math.PI / 2; floor.position.set(L / 2, -0.25, -W / 2); tableGroup.add(floor);
  var apronMat = new THREE.MeshStandardMaterial({ color: 0x3a2314, roughness: 0.5 });
  function apron(w, rotY, x, z) {
    var m = new THREE.Mesh(new THREE.PlaneGeometry(w, 0.29), apronMat);
    m.rotation.y = rotY; m.position.set(x, -0.1075, z); tableGroup.add(m);
  }
  apron(L + 0.48, 0, L / 2, 0.24);
  apron(L + 0.48, Math.PI, L / 2, -(W + 0.24));
  apron(W + 0.48, -Math.PI / 2, -0.24, -W / 2);
  apron(W + 0.48, Math.PI / 2, L + 0.24, -W / 2);
  var inner = new THREE.Mesh(new THREE.BoxGeometry(L + 0.46, 0.286, W + 0.46), new THREE.MeshBasicMaterial({ color: 0x030303, side: THREE.BackSide }));
  inner.position.set(L / 2, -0.107, -W / 2); tableGroup.add(inner);

  // cushions: a prism whose nose sits at the contact height, mitred where the pocket jaws are
  var cushMat = new THREE.MeshStandardMaterial({ color: 0x0b4f35, roughness: 1 });
  TABLE.rails.forEach(function (r) {
    var len = Math.sqrt(r.len2), tx = r.dx / len, ty = r.dy / len, ox = -r.nx, oy = -r.ny;
    var prof = [[0.012, 0], [0, NOSE_H], [0.066, NOSE_H], [0.066, 0]];
    function pt(u, w, h) { return [r.x0 + tx * u + ox * w, r.y0 + ty * u + oy * w, h]; }
    var S0 = prof.map(function (p) { return pt(-p[0], p[0], p[1]); });
    var E0 = prof.map(function (p) { return pt(len + p[0], p[0], p[1]); });
    var all = S0.concat(E0), cen = [0, 0, 0];
    all.forEach(function (p) { cen[0] += p[0] / 8; cen[1] += p[1] / 8; cen[2] += p[2] / 8; });
    var tris = [];
    for (var i = 0; i < 4; i++) { var j = (i + 1) % 4; tris.push([S0[i], S0[j], E0[j]], [S0[i], E0[j], E0[i]]); }
    tris.push([S0[0], S0[1], S0[2]], [S0[0], S0[2], S0[3]], [E0[0], E0[1], E0[2]], [E0[0], E0[2], E0[3]]);
    var pos = [];
    tris.forEach(function (t) {
      var a = t[0], b = t[1], c = t[2];
      var ux = b[0] - a[0], uy = b[1] - a[1], uz = b[2] - a[2], vx = c[0] - a[0], vy = c[1] - a[1], vz = c[2] - a[2];
      var nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
      var mx = (a[0] + b[0] + c[0]) / 3 - cen[0], my = (a[1] + b[1] + c[1]) / 3 - cen[1], mz = (a[2] + b[2] + c[2]) / 3 - cen[2];
      if (nx * mx + ny * my + nz * mz < 0) { var tmp = b; b = c; c = tmp; }
      [a, b, c].forEach(function (p) { var v = V(p[0], p[1], p[2]); pos.push(v.x, v.y, v.z); });
    });
    var geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    geo.computeVertexNormals();
    var m = new THREE.Mesh(geo, cushMat); m.castShadow = true; m.receiveShadow = true;
    tableGroup.add(m);
  });
  // knuckle caps (the rounded jaw tips)
  var capMat = new THREE.MeshStandardMaterial({ color: 0x0a3f2b, roughness: 1 });
  TABLE.knuckles.forEach(function (k) {
    var m = new THREE.Mesh(new THREE.CylinderGeometry(0.004, 0.004, NOSE_H, 12), capMat);
    m.position.copy(V(k[0], k[1], NOSE_H / 2)); tableGroup.add(m);
  });
})();

/* ================================================================== balls */
function ballTexture(meta) {
  var Wd = 1024, Hd = 512, cv = document.createElement('canvas'); cv.width = Wd; cv.height = Hd;
  var c = cv.getContext('2d'), white = '#f3efe2';
  function disc(u, v, r, col) { c.fillStyle = col; c.beginPath(); c.ellipse(u * Wd, v * Hd, r / TAU * Wd, r / Math.PI * Hd, 0, 0, TAU); c.fill(); }
  if (meta.cue) {
    c.fillStyle = white; c.fillRect(0, 0, Wd, Hd);
    var dot = '#c4342d';
    [0, 0.25, 0.5, 0.75, 1].forEach(function (u) { disc(u, 0.5, 0.17, dot); });
    c.fillStyle = dot; c.fillRect(0, 0, Wd, Hd * 0.054); c.fillRect(0, Hd * (1 - 0.054), Wd, Hd * 0.054);
  } else {
    c.fillStyle = meta.stripe ? white : meta.color; c.fillRect(0, 0, Wd, Hd);
    if (meta.stripe) { c.fillStyle = meta.color; c.fillRect(0, Hd * 0.5 - Hd * 0.172, Wd, Hd * 0.344); }
    [0, 0.5, 1].forEach(function (u) {
      disc(u, 0.5, 0.5, white);
      c.fillStyle = '#111'; c.font = '700 ' + (Hd * 0.2) + 'px system-ui,sans-serif';
      c.textAlign = 'center'; c.textBaseline = 'middle';
      c.fillText(String(meta.number), u * Wd, Hd * 0.5 + 4);
    });
  }
  return canvasTex(cv);
}
var ballGeo = new THREE.SphereGeometry(R, 72, 48);
function makeBallMesh(meta) {
  var m = new THREE.Mesh(ballGeo, new THREE.MeshPhysicalMaterial({
    map: ballTexture(meta), roughness: 0.16, metalness: 0, clearcoat: 0.9, clearcoatRoughness: 0.08,
  }));
  m.castShadow = true; m.receiveShadow = false; scene.add(m);
  return m;
}
var cueMesh = makeBallMesh({ cue: true });
var objMesh = makeBallMesh({ color: '#f2c200', number: 1, stripe: false });
var meshes = { 0: cueMesh, 1: objMesh };

function syncBall(b, mesh) {
  var s = sink[b.id];
  if (b.pocketed >= 0) {
    if (!s) { mesh.visible = false; return; }
    var t = s.t, k = Math.min(t, 0.18);
    mesh.visible = true;
    mesh.position.set(s.x + s.vx * 0.55 * k, R - 4.9 * 2.2 * t * t, -(s.y + s.vy * 0.55 * k));
    if (mesh.position.y < -0.3) mesh.visible = false;
  } else {
    mesh.visible = true;
    mesh.position.set(b.x, R, -b.y);
  }
  mesh.quaternion.set(b.q[1], b.q[3], -b.q[2], b.q[0]);
}

/* ============================================================ cue stick */
var cueGroup = new THREE.Group(); scene.add(cueGroup);
(function () {
  function seg(rTop, rBot, y0, y1, color, rough) {
    var g = new THREE.CylinderGeometry(rTop, rBot, y1 - y0, 20); g.translate(0, (y0 + y1) / 2, 0);
    var m = new THREE.Mesh(g, new THREE.MeshStandardMaterial({ color: color, roughness: rough }));
    m.castShadow = true; cueGroup.add(m);
  }
  seg(0.0066, 0.0066, 0, 0.012, 0x4b8fd0, 0.9);          // tip
  seg(0.0067, 0.0067, 0.012, 0.04, 0xf1efe8, 0.35);      // ferrule
  seg(0.0105, 0.0068, 0.04, 0.88, 0xe6c88e, 0.45);       // shaft
  seg(0.0165, 0.0105, 0.88, 1.45, 0x24150d, 0.4);        // butt
  seg(0.0168, 0.0168, 1.0, 1.1, 0x703a2a, 0.7);          // wrap
})();
var tipMarker = new THREE.Mesh(new THREE.SphereGeometry(0.0024, 16, 12), new THREE.MeshBasicMaterial({ color: 0xff4a3d }));
scene.add(tipMarker);

/* ============================================================== overlays */
var overlay = new THREE.Group(); scene.add(overlay);        // per-scenario guides
var dynamic = new THREE.Group(); scene.add(dynamic);        // lines created at contact
var ghostMesh = new THREE.Mesh(ballGeo, new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.18, depthWrite: false }));
scene.add(ghostMesh);

function disposeGroup(g) {
  while (g.children.length) {
    var o = g.children.pop();
    if (o.geometry) o.geometry.dispose();
    if (o.material) o.material.dispose();
  }
}
function ribbon(pts, width, color, opacity, dash, gap, h) {
  var pos = [], on = true, left = dash || 1e9;
  h = h == null ? 0.0009 : h;
  function quad(a, b) {
    var dx = b[0] - a[0], dy = b[1] - a[1], l = Math.hypot(dx, dy); if (l < 1e-7) return;
    var px = -dy / l * width / 2, py = dx / l * width / 2;
    var v = [[a[0] - px, a[1] - py], [b[0] - px, b[1] - py], [b[0] + px, b[1] + py], [a[0] + px, a[1] + py]]
      .map(function (p) { return [p[0], h, -p[1]]; });
    [0, 1, 2, 0, 2, 3].forEach(function (i) { pos.push(v[i][0], v[i][1], v[i][2]); });
  }
  for (var i = 0; i + 1 < pts.length; i++) {
    var a = pts[i], b = pts[i + 1], segLen = Math.hypot(b[0] - a[0], b[1] - a[1]), done = 0;
    while (done < segLen - 1e-9) {
      var take = Math.min(left, segLen - done), f0 = done / segLen, f1 = (done + take) / segLen;
      if (on) quad([a[0] + (b[0] - a[0]) * f0, a[1] + (b[1] - a[1]) * f0], [a[0] + (b[0] - a[0]) * f1, a[1] + (b[1] - a[1]) * f1]);
      done += take; left -= take;
      if (left <= 1e-9 && dash) { on = !on; left = on ? dash : gap; }
    }
  }
  var geo = new THREE.BufferGeometry(); geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  var m = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ color: color, transparent: true, opacity: opacity, depthWrite: false, side: THREE.DoubleSide }));
  m.renderOrder = 2; return m;
}
function ring(x, y, r0, r1, color, opacity) {
  var m = new THREE.Mesh(new THREE.RingGeometry(r0, r1, 48), new THREE.MeshBasicMaterial({ color: color, transparent: true, opacity: opacity, depthWrite: false, side: THREE.DoubleSide }));
  m.rotation.x = -Math.PI / 2; m.position.set(x, 0.001, -y); m.renderOrder = 2; return m;
}

/* trails (dots every 20 ms of simulated time) and spin arrows */
var TRAIL_MAX = 3000;
var dotTex = (function () {
  var c = document.createElement('canvas'); c.width = c.height = 64; var g = c.getContext('2d');
  var gr = g.createRadialGradient(32, 32, 4, 32, 32, 30); gr.addColorStop(0, 'rgba(255,255,255,1)'); gr.addColorStop(0.7, 'rgba(255,255,255,.9)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = gr; g.beginPath(); g.arc(32, 32, 30, 0, TAU); g.fill();
  return new THREE.CanvasTexture(c);
})();
function makeTrail(color) {
  var geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(TRAIL_MAX * 3), 3));
  geo.setDrawRange(0, 0);
  var pts = new THREE.Points(geo, new THREE.PointsMaterial({ color: color, size: 0.0075, sizeAttenuation: true, map: dotTex, transparent: true, depthWrite: false, alphaTest: 0.05 }));
  pts.frustumCulled = false; pts.renderOrder = 3; scene.add(pts);
  return { pts: pts, n: 0 };
}
var trails = { 0: makeTrail(0x9fd0ff), 1: makeTrail(0xffc66b) };
function trailAdd(id, x, y) {
  var t = trails[id]; if (t.n >= TRAIL_MAX) return;
  var a = t.pts.geometry.attributes.position.array;
  a[t.n * 3] = x; a[t.n * 3 + 1] = 0.0012; a[t.n * 3 + 2] = -y;
  t.n++; t.pts.geometry.setDrawRange(0, t.n); t.pts.geometry.attributes.position.needsUpdate = true;
}
function trailClear() { [0, 1].forEach(function (i) { trails[i].n = 0; trails[i].pts.geometry.setDrawRange(0, 0); }); }

var arrows = {
  0: new THREE.ArrowHelper(new THREE.Vector3(0, 1, 0), new THREE.Vector3(), 0.1, 0x8cc4ff, 0.03, 0.016),
  1: new THREE.ArrowHelper(new THREE.Vector3(0, 1, 0), new THREE.Vector3(), 0.1, 0xffc66b, 0.03, 0.016),
};
scene.add(arrows[0]); scene.add(arrows[1]);

/* ================================================================== state */
var S = {
  id: 'straight', params: null, built: null, phase: 'aim', strokeT: 0, paused: false, speed: 1,
  stepReq: 0, acc: 0, contactDone: false, cushionDone: {}, slowUntil: -1, info: {}, stickHide: 0,
  nextTrail: 0, lastFocus: null, flash: null,
};
var sink = {};
var pv = { 0: {}, 1: {} };

/* ============================================================ scenarios */
function readParams() { return S.params; }

function rebuild(resetCamera) {
  var wasPhase = S.phase;
  var p = Object.assign({}, S.params, { comp: $('ck-comp').checked });
  S.built = SC.build(S.id, p);
  S.phase = 'aim'; S.strokeT = 0; S.acc = 0; S.contactDone = false; S.cushionDone = {}; S.slowUntil = -1;
  S.info = {}; S.nextTrail = 0; S.stickHide = 0; sink = {};
  trailClear(); disposeGroup(dynamic);
  var w = S.built.world;
  objMesh.visible = !!S.built.obj;
  w.balls.forEach(function (b) { syncBall(b, meshes[b.id]); });
  buildOverlay();
  updateCue(0);
  renderContact(); renderLive();
  if (resetCamera) setCam(presetCam('three'), true);
  void wasPhase;
}

function buildOverlay() {
  disposeGroup(overlay);
  var b = S.built, show = $('ck-ghost').checked;
  overlay.visible = show;
  if (b.ghost) {
    var G = b.ghost, C = b.start, O = b.obj;
    ghostMesh.position.set(G.x, R, -G.y);
    overlay.add(ring(G.x, G.y, R * 0.97, R * 1.04, 0xffffff, 0.65));
    overlay.add(ribbon([[C[0], C[1]], [G.x, G.y]], 0.0022, 0xffffff, 0.55, 0.02, 0.016));
    // line of centres, continued to its target
    var tgt = b.target;
    if (b.def.target === 'bank') {
      overlay.add(ribbon(b.ideal.xs.map(function (x, i) { return [x, b.ideal.ys[i]]; }), 0.0026, 0xffc66b, 0.7, 0.025, 0.018));
    } else {
      var far = b.def.target === 'open' ? [O.x + b.u[0] * 1.6, O.y + b.u[1] * 1.6] : [tgt.x, tgt.y];
      overlay.add(ribbon([[G.x, G.y], far], 0.0026, 0xffc66b, 0.75, 0.025, 0.018));
    }
    var cp = b.contact;
    var dotM = new THREE.Mesh(new THREE.SphereGeometry(0.0028, 14, 10), new THREE.MeshBasicMaterial({ color: 0xffc66b }));
    dotM.position.set(cp.x, R, -cp.y); overlay.add(dotM);
    if (b.mouth) overlay.add(ring(b.mouth.x, b.mouth.y, 0.006, 0.009, 0xffc66b, 0.9));
  } else if (b.ideal) {
    overlay.add(ribbon(b.ideal.xs.slice(0, 3).map(function (x, i) { return [x, b.ideal.ys[i]]; }), 0.0026, 0xffc66b, 0.75, 0.025, 0.018));
    overlay.add(ring(b.ideal.xs[1], b.ideal.ys[1], 0.008, 0.012, 0xffc66b, 0.9));
  }
  ghostMesh.visible = show && !!b.ghost;
}

function updateCue(gap) {
  var b = S.built, a = S.params.a, bb = S.params.b, phi = b.phi, c = b.cue;
  var d = [Math.cos(phi), Math.sin(phi)], s = [Math.sin(phi), -Math.cos(phi)];
  var ch = Math.sqrt(Math.max(0, 1 - a * a - bb * bb));
  var tx = c.x + R * (-ch * d[0] + a * s[0]), ty = c.y + R * (-ch * d[1] + a * s[1]), tz = R + R * bb;
  tipMarker.position.copy(V(tx, ty, tz));
  tipMarker.visible = S.phase !== 'run' && S.phase !== 'done';
  cueGroup.position.copy(V(tx - d[0] * gap, ty - d[1] * gap, tz));
  cueGroup.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), new THREE.Vector3(-d[0], 0, d[1]));
  cueGroup.visible = S.phase !== 'done' || S.stickHide > 0;
}

/* ================================================================= camera */
var cam = { x: 1, y: 0.6, h: R, az: 0, el: 0.5, dist: 0.9 };
var camGoal = Object.assign({}, cam);
function setCam(g, jump) {
  camGoal = Object.assign({}, camGoal, g);
  if (jump) cam = Object.assign({}, camGoal);
}
function presetCam(name) {
  var b = S.built, F = b.focus, ax = b.axis;
  function side(dist) {
    var c = [ax + Math.PI / 2, ax - Math.PI / 2];
    for (var i = 0; i < 2; i++) {
      var x = F.x + Math.cos(c[i]) * dist * 0.8, y = F.y + Math.sin(c[i]) * dist * 0.8;
      if (x > 0.05 && x < L - 0.05 && y > 0.05 && y < W - 0.05) return c[i];
    }
    return c[0];
  }
  var lab = b.def.kind === 'lab', tgtPt = b.contact || b.bankPoint || F;
  switch (name) {
    case 'contact': return { x: tgtPt.x, y: tgtPt.y, h: R, az: side(0.4), el: 22 * DEG, dist: lab ? 0.42 : 0.3 };
    case 'low': return { x: F.x, y: F.y, h: R, az: side(0.6), el: 5 * DEG, dist: lab ? 0.6 : 0.55 };
    case 'cue': {
      var gp = b.ghost || F;
      return { x: gp.x, y: gp.y, h: R, az: ax + Math.PI + 0.09, el: 11 * DEG, dist: 0.8 };
    }
    case 'pocket': {
      var tp = b.mouth || (b.u ? { x: b.obj.x + b.u[0] * 0.6, y: b.obj.y + b.u[1] * 0.6 } : F);
      var from = b.obj || b.cue;
      return { x: tp.x, y: tp.y, h: R, az: Math.atan2(from.y - tp.y, from.x - tp.x) + 0.45, el: 26 * DEG, dist: 0.8 };
    }
    case 'rail': {
      var rp = b.bankPoint ? { x: b.bankPoint.x, y: b.bankPoint.y } : { x: F.x, y: 0 };
      var top = rp.y > W / 2;
      return { x: rp.x, y: top ? W : 0, h: 0.02, az: (top ? -Math.PI / 2 : Math.PI / 2) + (b.axis > 0 ? 0.3 : -0.3), el: 10 * DEG, dist: 0.5 };
    }
    case 'top': return { x: F.x, y: F.y, h: 0, az: ax - Math.PI / 2, el: 86 * DEG, dist: 1.3 };
    default: {
      var st = b.start || [F.x, F.y], gp2 = b.ghost || F;
      var mx = st[0] * 0.3 + gp2.x * 0.7, my = st[1] * 0.3 + gp2.y * 0.7;
      return { x: mx, y: my, h: R, az: side(1.0), el: 30 * DEG, dist: lab ? 1.1 : 1.15 };
    }
  }
}
function camStep(dt) {
  var k = 1 - Math.exp(-dt * 6);
  cam.x += (camGoal.x - cam.x) * k; cam.y += (camGoal.y - cam.y) * k; cam.h += (camGoal.h - cam.h) * k;
  cam.az += wrap(camGoal.az - cam.az) * k; cam.el += (camGoal.el - cam.el) * k; cam.dist += (camGoal.dist - cam.dist) * k;
  var ce = Math.cos(cam.el);
  camera.position.set(cam.x + cam.dist * ce * Math.cos(cam.az), cam.h + cam.dist * Math.sin(cam.el), -(cam.y + cam.dist * ce * Math.sin(cam.az)));
  camera.lookAt(cam.x, cam.h, -cam.y);
  spot.position.set(cam.x + 0.25, 1.35, -(cam.y - 0.2));
  spot.target.position.set(cam.x, 0, -cam.y);
}
(function orbitInput() {
  var cv = $('gl'), ptrs = {}, lastPinch = 0;
  cv.addEventListener('pointerdown', function (e) { cv.setPointerCapture(e.pointerId); ptrs[e.pointerId] = [e.clientX, e.clientY]; });
  cv.addEventListener('pointermove', function (e) {
    var p = ptrs[e.pointerId]; if (!p) return;
    var ids = Object.keys(ptrs);
    if (ids.length === 2) {
      var o = ptrs[ids[0] == e.pointerId ? ids[1] : ids[0]];
      var d0 = Math.hypot(p[0] - o[0], p[1] - o[1]);
      ptrs[e.pointerId] = [e.clientX, e.clientY];
      var d1 = Math.hypot(e.clientX - o[0], e.clientY - o[1]);
      if (d0 > 0) { camGoal.dist = cam.dist = Math.max(0.15, Math.min(3.5, cam.dist * d0 / d1)); }
      return;
    }
    var dx = e.clientX - p[0], dy = e.clientY - p[1];
    ptrs[e.pointerId] = [e.clientX, e.clientY];
    camGoal.az = cam.az = cam.az - dx * 0.006;
    camGoal.el = cam.el = Math.max(3 * DEG, Math.min(88 * DEG, cam.el + dy * 0.005));
  });
  function up(e) { delete ptrs[e.pointerId]; }
  cv.addEventListener('pointerup', up); cv.addEventListener('pointercancel', up);
  cv.addEventListener('wheel', function (e) {
    e.preventDefault();
    camGoal.dist = cam.dist = Math.max(0.15, Math.min(3.5, cam.dist * Math.exp(e.deltaY * 0.0012)));
  }, { passive: false });
  void lastPinch;
})();

/* ============================================================= simulation */
function snap() {
  var w = S.built.world;
  w.balls.forEach(function (b) {
    var o = pv[b.id]; o.x = b.x; o.y = b.y; o.vx = b.vx; o.vy = b.vy; o.wx = b.wx; o.wy = b.wy; o.wz = b.wz;
  });
}
function spinRatio(o) {                      // 1 = rolling, 0 = stun, <0 = backspin
  var sp = Math.hypot(o.vx, o.vy); if (sp < 1e-3) return 0;
  var d = Math.atan2(o.vy, o.vx);
  return (-o.wx * Math.sin(d) + o.wy * Math.cos(d)) * R / sp;
}
function nearestRail(x, y) {
  var best = null, bd = 1e9;
  TABLE.rails.forEach(function (r) {
    var t = Math.max(0, Math.min(1, ((x - r.x0) * r.dx + (y - r.y0) * r.dy) / r.len2));
    var d = Math.hypot(x - (r.x0 + t * r.dx), y - (r.y0 + t * r.dy));
    if (d < bd) { bd = d; best = r; }
  });
  return best;
}

function handleEvent(e) {
  var b = S.built, w = b.world;
  if (e.type === 'ball' && !S.contactDone) {
    S.contactDone = true; S.slowUntil = w.time + 0.35;
    var C = w.ball(0), O = w.ball(1), v0 = pv[0];
    var sp0 = Math.hypot(v0.vx, v0.vy), dirIn = Math.atan2(v0.vy, v0.vx);
    var nA = Math.atan2(e.ny, e.nx);                     // exact line of centres at contact
    if (e.a !== 0) nA = Math.atan2(-e.ny, -e.nx);
    var cut = Math.abs(wrap(dirIn - nA)) / DEG;
    var objAng = Math.atan2(O.vy, O.vx), cueAng = Math.atan2(C.vy, C.vx);
    var objSp = Math.hypot(O.vx, O.vy), cueSp = Math.hypot(C.vx, C.vy);
    S.info.contact = {
      cueSpeed: sp0, cut: cut, full: 1 - Math.sin(cut * DEG), spin: spinRatio(v0), side: v0.wz,
      objSpeed: objSp, objRel: objSp / sp0, thr: wrap(objAng - nA) / DEG, objDir: objAng / DEG, lineDir: nA / DEG,
      cueAfter: cueSp, cueRel: cueSp / sp0, turn: wrap(cueAng - dirIn) / DEG, between: Math.abs(wrap(cueAng - objAng)) / DEG,
    };
    // guides that remain on the table
    var cp = [(C.x + O.x) / 2, (C.y + O.y) / 2];
    dynamic.add(ribbon([[O.x, O.y], [O.x + Math.cos(nA) * 0.7, O.y + Math.sin(nA) * 0.7]], 0.0016, 0xffffff, 0.5, 0.018, 0.014));
    dynamic.add(ribbon([[O.x, O.y], [O.x + Math.cos(objAng) * 0.7, O.y + Math.sin(objAng) * 0.7]], 0.0034, 0xffc66b, 0.95));
    if (cueSp > 0.03) dynamic.add(ribbon([[C.x, C.y], [C.x + Math.cos(cueAng) * 0.5, C.y + Math.sin(cueAng) * 0.5]], 0.0034, 0x8cc4ff, 0.95));
    if (S.flash) { scene.remove(S.flash.m); }
    var fm = ring(cp[0], cp[1], R * 0.4, R * 0.5, 0xffffff, 0.9); scene.add(fm); S.flash = { m: fm, t: 0 };
    renderContact();
  } else if (e.type === 'cushion' && !S.cushionDone[e.id]) {
    S.cushionDone[e.id] = true; S.slowUntil = w.time + 0.35;
    var ball = w.ball(e.id), pre = pv[e.id];
    var r = nearestRail(ball.x, ball.y);
    var tx = r.dx / Math.sqrt(r.len2), ty = r.dy / Math.sqrt(r.len2);
    var inN = -(pre.vx * r.nx + pre.vy * r.ny), inT = pre.vx * tx + pre.vy * ty;
    var outN = ball.vx * r.nx + ball.vy * r.ny, outT = ball.vx * tx + ball.vy * ty;
    var sp1 = Math.hypot(pre.vx, pre.vy), sp2 = Math.hypot(ball.vx, ball.vy);
    S.info['rail' + e.id] = {
      who: e.id === 0 ? 'Cue ball' : 'Object ball',
      aIn: Math.atan2(Math.abs(inT), inN) / DEG, aOut: Math.atan2(Math.abs(outT), outN) / DEG,
      spIn: sp1, spOut: sp2, wzIn: pre.wz, wzOut: ball.wz, spinIn: spinRatio(pre),
      keep: Math.sign(inT) === Math.sign(outT) || Math.abs(outT) < 1e-3,
    };
    var fm2 = ring(ball.x, ball.y, R * 0.4, R * 0.5, 0xff8a6b, 0.9); scene.add(fm2);
    if (S.flash) scene.remove(S.flash.m);
    S.flash = { m: fm2, t: 0 };
    renderContact();
  } else if (e.type === 'pocket') {
    var pb = w.ball(e.id), q = pv[e.id];
    sink[e.id] = { t: 0, x: pb.x, y: pb.y, vx: q.vx, vy: q.vy };
    toast(e.id === 0 ? 'Cue ball pocketed (scratch)' : 'Object ball pocketed');
  }
}

function simFactor() {
  var f = S.speed, w = S.built.world;
  if (!$('ck-auto').checked || S.phase !== 'run') return f;
  if (w.time < S.slowUntil) return Math.min(f, 0.04);
  var C = w.ball(0), O = w.ball(1), approaching = false;
  if (O && !S.contactDone && C.pocketed < 0) {
    var gap = Math.hypot(O.x - C.x, O.y - C.y) - 2 * R;
    if (gap < 0.1 && Math.hypot(C.vx, C.vy) > 0.05) approaching = true;
  }
  var railBall = S.built.def.kind === 'lab' ? 0 : S.built.def.target === 'bank' ? 1 : -1;
  var rb = railBall >= 0 ? w.ball(railBall) : null;
  if (rb && rb.pocketed < 0 && !S.cushionDone[railBall]) {
    var r = nearestRail(rb.x, rb.y);
    var d = (rb.x - r.x0) * r.nx + (rb.y - r.y0) * r.ny;
    if (d < Rc + 0.11 && (rb.vx * r.nx + rb.vy * r.ny) < -0.05) approaching = true;
  }
  return approaching ? Math.min(f, 0.04) : f;
}

function advance(simDt) {
  var w = S.built.world, n = 0;
  S.acc += simDt;
  while (S.acc >= DT && n++ < 4000) {
    snap();
    w.step(DT);
    S.acc -= DT;
    if (w.events.length) { for (var i = 0; i < w.events.length; i++) handleEvent(w.events[i]); w.events.length = 0; }
    if (w.time >= S.nextTrail) {
      S.nextTrail = w.time + 0.02;
      w.balls.forEach(function (b) { if (b.pocketed < 0 && BP.isMoving(b)) trailAdd(b.id, b.x, b.y); });
    }
  }
}

/* ===================================================================== UI */
var toastTimer;
function toast(msg) {
  var t = $('toast'); t.textContent = msg; t.classList.add('show');
  clearTimeout(toastTimer); toastTimer = setTimeout(function () { t.classList.remove('show'); }, 2600);
}
function row(k, v, cls) { return '<tr><td>' + k + '</td><td' + (cls ? ' class="' + cls + '"' : '') + '>' + v + '</td></tr>'; }
function fraction(f) {
  var names = [[1, 'full ball'], [0.75, '¾ ball'], [0.5, '½ ball'], [0.25, '¼ ball'], [0.1, 'thin']];
  var best = names[0], bd = 9;
  names.forEach(function (n) { var d = Math.abs(n[0] - f); if (d < bd) { bd = d; best = n; } });
  return best[1];
}
function renderContact() {
  var h = '', c = S.info.contact;
  if (c) {
    h += row('Cue ball speed', c.cueSpeed.toFixed(2) + ' m/s');
    h += row('Cut angle', c.cut.toFixed(1) + '° (≈ ' + fraction(c.full) + ')');
    h += row('Object ball leaves at', c.objSpeed.toFixed(2) + ' m/s (' + (c.objRel * 100).toFixed(0) + '%)');
    h += row('Object ball vs line of centres', sgn(c.thr, 1) + '° ("throw")', Math.abs(c.thr) > 0.4 ? 'warn' : '');
    h += row('Cue ball after', c.cueAfter.toFixed(2) + ' m/s (' + (c.cueRel * 100).toFixed(0) + '%)');
    h += row('Cue ball turned by', sgn(c.turn, 1) + '°');
    h += row('Angle between the two paths', c.between.toFixed(1) + '°', 'good');
    h += row('Spin ratio / side spin', fmt(c.spin, 2) + ' / ' + fmt(c.side, 0) + ' rad/s');
  }
  [0, 1].forEach(function (id) {
    var r = S.info['rail' + id]; if (!r) return;
    h += row(r.who + ' on the cushion', '');
    h += row('&nbsp; angle in → out (from normal)', r.aIn.toFixed(1) + '° → ' + r.aOut.toFixed(1) + '°', 'good');
    h += row('&nbsp; mirror would be', r.aIn.toFixed(1) + '°');
    h += row('&nbsp; speed in → out', r.spIn.toFixed(2) + ' → ' + r.spOut.toFixed(2) + ' m/s (' + (r.spOut / r.spIn * 100).toFixed(0) + '%)');
    h += row('&nbsp; side spin in → out', fmt(r.wzIn, 0) + ' → ' + fmt(r.wzOut, 0) + ' rad/s');
  });
  if (!h) h = '<tr><td colspan="2" style="color:var(--ink-faint)">Take the shot to see the numbers at the moment of contact.</td></tr>';
  $('contact').innerHTML = h;
}
function renderLive() {
  var w = S.built.world, C = w.ball(0), O = w.ball(1), h = '';
  var sp = Math.hypot(C.vx, C.vy), p = C;
  var slip = Math.hypot(C.vx - R * C.wy, C.vy + R * C.wx);
  var mode = C.pocketed >= 0 ? 'pocketed' : sp < 1e-4 && Math.abs(C.wz) < 1e-3 ? 'at rest' : sp < 1e-4 ? 'spinning' : slip > 0.02 ? 'sliding' : 'rolling';
  h += row('Cue ball speed', sp.toFixed(2) + ' m/s');
  h += row('Cue ball state', mode, mode === 'sliding' ? 'warn' : '');
  h += row('Top/back spin ratio', sp > 1e-3 ? fmt(spinRatio(p), 2) : '—');
  h += row('Side spin', fmt(C.wz, 0) + ' rad/s');
  if (O) h += row('Object ball speed', Math.hypot(O.vx, O.vy).toFixed(2) + ' m/s');
  $('live').innerHTML = h;
  var f = S.phase === 'run' ? simFactor() : S.speed;
  $('hud').innerHTML = '<div class="tag">sim speed <b>' + (f >= 1 ? '1' : f.toFixed(2)) + '×</b> · t <b>' + w.time.toFixed(3) + ' s</b></div>' +
    (S.paused ? '<div class="tag"><b>paused</b></div>' : '');
}

function buildChips() {
  var el = $('chips');
  SC.ORDER.forEach(function (id) {
    var b = document.createElement('button'); b.className = 'chip'; b.dataset.id = id; b.textContent = SC.DEFS[id].name;
    b.addEventListener('click', function () { load(id); });
    el.appendChild(b);
  });
}
function load(id) {
  S.id = id;
  S.params = Object.assign({}, SC.DEFS[id].d);
  document.querySelectorAll('#chips .chip').forEach(function (c) { c.classList.toggle('on', c.dataset.id === id); });
  var def = SC.DEFS[id];
  $('sctitle').textContent = def.name;
  $('scdesc').textContent = def.desc;
  $('scwatch').innerHTML = def.watch.map(function (t) { return '<li>' + t + '</li>'; }).join('');
  document.querySelectorAll('.ctl').forEach(function (r) { r.style.display = def.controls.indexOf(r.dataset.ctl) >= 0 ? '' : 'none'; });
  $('l-cut').textContent = def.kind === 'lab' ? 'Angle in' : 'Cut angle';
  $('l-cut').title = def.kind === 'lab' ? 'Angle of incidence measured from the cushion’s normal' : 'Angle between the cue ball’s path and the line of centres';
  syncControls();
  rebuild(true);
}
var RANGE = { cut: [-60, 60], objDist: [0.25, 1.2], dist: [0.15, 1.1], power: [0.05, 1], err: [-30, 30] };
function syncControls() {
  ['cut', 'objDist', 'dist', 'power', 'err'].forEach(function (k) {
    var el = $('s-' + k); el.value = S.params[k]; showVal(k);
  });
  drawEnglish(); updateEngText();
}
function showVal(k) {
  var v = S.params[k], t;
  if (k === 'cut') t = fmt(v, 1) + '°';
  else if (k === 'power') t = v.toFixed(2) + ' · ' + BP.strikeSpeed(v, S.params.a, S.params.b, SPEC).toFixed(1) + ' m/s';
  else if (k === 'err') t = sgn(v, 1) + ' mm';
  else t = v.toFixed(2) + ' m';
  $('v-' + k).textContent = t;
}
['cut', 'objDist', 'dist', 'power', 'err'].forEach(function (k) {
  $('s-' + k).addEventListener('input', function (e) {
    S.params[k] = Number(e.target.value); showVal(k); rebuild(false);
    if (k === 'power') showVal('power');
  });
  $('s-' + k).addEventListener('change', function (e) { e.target.blur(); });
});

/* cue-ball face / tip position */
function updateEngText() {
  var a = S.params.a, b = S.params.b;
  $('engv').textContent = 'side ' + sgn(a, 2) + ' R (' + (a > 0.02 ? 'right' : a < -0.02 ? 'left' : 'none') + ')\nvert ' + sgn(b, 2) + ' R (' + (b > 0.02 ? 'follow' : b < -0.02 ? 'draw' : 'stun') + ')';
  showVal('power');
}
function setEnglish(a, b) {
  var lim = 0.55, r = Math.hypot(a, b);
  if (r > lim) { a *= lim / r; b *= lim / r; }
  S.params.a = a; S.params.b = b;
  drawEnglish(); updateEngText(); rebuild(false);
}
function drawEnglish() {
  var c = $('eng').getContext('2d'), Sz = 208, r = Sz / 2 - 8;
  c.setTransform(1, 0, 0, 1, 0, 0); c.clearRect(0, 0, Sz, Sz);
  var g = c.createRadialGradient(Sz / 2 - 22, Sz / 2 - 28, 10, Sz / 2, Sz / 2, r);
  g.addColorStop(0, '#fffdf4'); g.addColorStop(1, '#bdb8a6');
  c.fillStyle = g; c.beginPath(); c.arc(Sz / 2, Sz / 2, r, 0, TAU); c.fill();
  c.strokeStyle = 'rgba(0,0,0,.25)'; c.beginPath(); c.moveTo(Sz / 2, 8); c.lineTo(Sz / 2, Sz - 8); c.moveTo(8, Sz / 2); c.lineTo(Sz - 8, Sz / 2); c.stroke();
  c.setLineDash([4, 4]); c.strokeStyle = 'rgba(200,60,50,.7)'; c.beginPath(); c.arc(Sz / 2, Sz / 2, r * 0.55, 0, TAU); c.stroke(); c.setLineDash([]);
  c.strokeStyle = 'rgba(40,120,200,.55)'; c.beginPath(); c.arc(Sz / 2, Sz / 2, r * 0.4, 0, TAU); c.stroke();
  c.fillStyle = '#2a6fdb'; c.beginPath(); c.arc(Sz / 2 + S.params.a * r, Sz / 2 - S.params.b * r, 9, 0, TAU); c.fill();
  c.strokeStyle = '#fff'; c.lineWidth = 2; c.stroke();
}
(function () {
  var e = $('eng'), drag = false;
  function set(ev) {
    var r = e.getBoundingClientRect(), Sz = r.width, rad = Sz / 2 - 8 * Sz / 208;
    setEnglish((ev.clientX - r.left - Sz / 2) / rad, -(ev.clientY - r.top - Sz / 2) / rad);
  }
  e.addEventListener('pointerdown', function (ev) { drag = true; e.setPointerCapture(ev.pointerId); set(ev); });
  e.addEventListener('pointermove', function (ev) { if (drag) set(ev); });
  e.addEventListener('pointerup', function () { drag = false; });
  e.addEventListener('dblclick', function () { setEnglish(0, 0); });
})();
document.querySelectorAll('[data-eng]').forEach(function (b) {
  b.addEventListener('click', function () { var v = b.dataset.eng.split(',').map(Number); setEnglish(v[0], v[1]); });
});
document.querySelectorAll('[data-cam]').forEach(function (b) {
  b.addEventListener('click', function () { setCam(presetCam(b.dataset.cam)); });
});

function shoot() {
  if (S.phase !== 'aim') rebuild(false);
  S.phase = 'stroke'; S.strokeT = 0;
}
$('shoot').addEventListener('click', shoot);
$('reset').addEventListener('click', function () { rebuild(false); });
$('pause').addEventListener('click', function () { S.paused = !S.paused; $('pause').classList.toggle('on', S.paused); $('pause').textContent = S.paused ? 'Resume' : 'Pause'; });
$('step').addEventListener('click', function () { S.paused = true; $('pause').classList.add('on'); $('pause').textContent = 'Resume'; S.stepReq += 0.002; });
$('speed').addEventListener('change', function (e) { S.speed = Number(e.target.value); e.target.blur(); });
['ck-ghost', 'ck-comp'].forEach(function (id) { $(id).addEventListener('change', function () { rebuild(false); }); });
$('ck-trails').addEventListener('change', function (e) { trails[0].pts.visible = trails[1].pts.visible = e.target.checked; });
document.addEventListener('click', function (e) { if (e.target.tagName === 'BUTTON') e.target.blur(); });
window.addEventListener('keydown', function (e) {
  if (e.target && (e.target.tagName === 'SELECT')) return;
  if (e.key === ' ') { e.preventDefault(); shoot(); }
  else if (e.key === 'r' || e.key === 'R') rebuild(false);
  else if (e.key === 'p' || e.key === 'P') $('pause').click();
  else if (e.key === '.') $('step').click();
});

/* =============================================================== main loop */
function resize() {
  var r = $('stage').getBoundingClientRect();
  renderer.setSize(r.width, r.height, false);
  camera.aspect = r.width / Math.max(1, r.height); camera.updateProjectionMatrix();
}
new ResizeObserver(resize).observe($('stage'));

var last = performance.now(), hud = 0;
function frame(now) {
  var dt = Math.min(0.05, (now - last) / 1000); last = now;
  var w = S.built.world, b = S.built;

  if (S.phase === 'aim') {
    updateCue(0.03 + S.params.power * 0.22);
  } else if (S.phase === 'stroke') {
    S.strokeT += dt / 0.26;
    var pull = 0.03 + S.params.power * 0.22, t = Math.min(1, S.strokeT);
    updateCue(pull * (1 - t * t));
    if (S.strokeT >= 1) {
      BP.strikeBall(b.cue, b.phi, b.power, b.a, b.b, w.P);
      w.events.length = 0; S.acc = 0; S.phase = 'run'; S.stickHide = 1.0; S.nextTrail = w.time;
      snap();
    }
  } else if (S.phase === 'run' || S.phase === 'done') {
    if (S.stickHide > 0) { S.stickHide -= dt; updateCue(0.02 + 0.3 * (1 - Math.max(0, S.stickHide))); if (S.stickHide <= 0) cueGroup.visible = false; }
    var f = simFactor();
    var simDt = S.paused ? S.stepReq : dt * f;
    S.stepReq = 0;
    if (simDt > 0) advance(simDt);
    if (S.phase === 'run' && !w.anyMoving() && !S.paused) S.phase = 'done';
  }
  if (S.paused && S.phase === 'aim') S.stepReq = 0;

  w.balls.forEach(function (bl) { syncBall(bl, meshes[bl.id]); });
  Object.keys(sink).forEach(function (k) { sink[k].t += dt * Math.max(S.paused ? 0 : (S.phase === 'run' ? simFactor() : 1), 0.15); });
  ghostMesh.visible = $('ck-ghost').checked && !!b.ghost && (S.phase === 'aim' || S.phase === 'stroke');
  if (S.flash) { S.flash.t += dt; var k = S.flash.t / 0.6; S.flash.m.scale.setScalar(1 + k * 3); S.flash.m.material.opacity = Math.max(0, 0.9 * (1 - k)); if (k >= 1) { scene.remove(S.flash.m); S.flash = null; } }

  // spin axes
  var showSpin = $('ck-spin').checked;
  [0, 1].forEach(function (id) {
    var bl = w.ball(id), ar = arrows[id];
    if (!bl || !showSpin || bl.pocketed >= 0) { ar.visible = false; return; }
    var om = Math.hypot(bl.wx, bl.wy, bl.wz);
    if (om < 2) { ar.visible = false; return; }
    ar.visible = true;
    ar.position.copy(V(bl.x, bl.y, R));
    ar.setDirection(new THREE.Vector3(bl.wx, bl.wz, -bl.wy).normalize());
    ar.setLength(Math.min(0.16, 0.03 + om * 0.0011), 0.03, 0.016);
  });

  // camera: follow the action while the balls move
  if ($('ck-follow').checked && S.phase === 'run' && w.anyMoving()) {
    var sx = 0, sy = 0, n = 0;
    w.balls.forEach(function (bl) { if (bl.pocketed < 0 && Math.hypot(bl.vx, bl.vy) > 0.05) { sx += bl.x; sy += bl.y; n++; } });
    if (n) { var kf = 1 - Math.exp(-dt * 1.8); camGoal.x += (sx / n - camGoal.x) * kf; camGoal.y += (sy / n - camGoal.y) * kf; }
  }
  camStep(dt);

  hud += dt; if (hud > 0.1) { hud = 0; renderLive(); }
  renderer.render(scene, camera);
  requestAnimationFrame(frame);
}

/* ===================================================================== boot */
buildChips();
S.params = Object.assign({}, SC.DEFS.straight.d);
S.built = SC.build('straight', S.params);
resize();
load('straight');
requestAnimationFrame(frame);
window.__cu = { S: S, load: load, shoot: shoot, setCam: setCam, presetCam: presetCam, THREE: THREE, scene: scene };
})();
