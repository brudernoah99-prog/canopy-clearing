// Facility 7 - Containment Wing: the big level for the chase modes (escape the monsters / be the monster).
// About 60 x 50 m, built from boxes merged per material (cheap on Quest 3).
// Zones: SPECIMEN CELLS (monsters start here), OBSERVATION, WEST CORRIDOR, TEST HALL (catwalk ring + monkey bars + test rig),
//        NORTH STORAGE (racks), CONTAINER YARD (stacks, tight gaps monsters can't use), SOUTH MAINTENANCE (lockers, mezzanine),
//        REGEN LAB (one door + a crawl vent), LOADING BAY (racks, dock, the EXIT shutter that keycards open).
// Big expansion (about 96 x 93 m, ~3x the floor): ATRIUM (north-west, two storeys, stairs, galleries, bridges, bars),
//        COLD STORAGE (north, maze of tall shelving) with the UPPER OFFICES above it (level 2, reached by climbing),
//        PUMP ROOM (east, flooded, tanks + overhead pipes to swing on, high catwalk into the offices),
//        SERVICE TUNNEL (a long low loop around the whole building with doors into most wings).
// Monsters walk the floor (nav graph); players also climb catwalks, containers, racks and crawl through vents.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

const V = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z);
const clamp = THREE.MathUtils.clamp;

// ---- collider helpers (same answer format as game.js: closest surface point to p, outward normal, inside flag) ----
function boxSurf(min, max, p) {
  const inside = p.x > min.x && p.x < max.x && p.y > min.y && p.y < max.y && p.z > min.z && p.z < max.z;
  if (!inside) { const c = V(clamp(p.x, min.x, max.x), clamp(p.y, min.y, max.y), clamp(p.z, min.z, max.z)); const n = p.clone().sub(c); const l = n.length(); return { point: c, normal: l > 1e-6 ? n.divideScalar(l) : V(0, 1, 0), inside: false }; }
  const d = [p.x - min.x, max.x - p.x, p.y - min.y, max.y - p.y, p.z - min.z, max.z - p.z]; const i = d.indexOf(Math.min(...d));
  const pt = p.clone(), n = V(); ['x', 'x', 'y', 'y', 'z', 'z'].forEach((a, k) => { if (k === i) { pt[a] = k % 2 ? max[a] : min[a]; n[a] = k % 2 ? 1 : -1; } });
  return { point: pt, normal: n, inside: true };
}
const boxCol = (min, max) => ({ min, max, surf: (p) => boxSurf(min, max, p) });

// ---- canvas textures ----
function canvasTex(w, h, draw, rx = 1, ry = 1) {
  const c = document.createElement('canvas'); c.width = w; c.height = h; draw(c.getContext('2d'), w, h);
  const t = new THREE.CanvasTexture(c); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(rx, ry); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4; return t;
}
const noise = (g, w, h, n, cols, sz = 2) => { for (let i = 0; i < n; i++) { g.fillStyle = cols[i % cols.length]; g.fillRect(Math.random() * w, Math.random() * h, sz, sz); } };

export function buildFacility(scene, origin = new THREE.Vector3(200, 0, 0)) {
  const O = origin.clone();
  const group = new THREE.Group(); group.name = 'facility'; group.position.copy(O); scene.add(group);

  // ---------- materials ----------
  const T = {
    floor: canvasTex(256, 256, (g, w, h) => { g.fillStyle = '#7d8085'; g.fillRect(0, 0, w, h); noise(g, w, h, 3000, ['#868a8f', '#74777c', '#6d7075', '#8e9196']);
      g.strokeStyle = '#5b5e63'; g.lineWidth = 3; g.strokeRect(1, 1, w - 2, h - 2); g.fillStyle = 'rgba(40,30,20,0.12)'; g.beginPath(); g.ellipse(170, 90, 44, 20, 0.4, 0, 7); g.fill(); }),
    wall: canvasTex(256, 256, (g, w, h) => { g.fillStyle = '#c9ccc8'; g.fillRect(0, 0, w, h); noise(g, w, h, 1500, ['#d1d4d0', '#c0c3bf', '#b9bcb8']);
      g.fillStyle = '#9da19e'; g.fillRect(0, 0, 3, h); g.fillRect(0, 0, w, 3); g.fillStyle = '#a7aba8'; for (const y of [20, 236]) for (const x of [20, 236]) { g.beginPath(); g.arc(x, y, 3.5, 0, 7); g.fill(); } }),
    wallBase: canvasTex(128, 128, (g, w, h) => { g.fillStyle = '#4d5359'; g.fillRect(0, 0, w, h); noise(g, w, h, 600, ['#555b61', '#454b51']); g.fillStyle = '#e0b31c'; g.fillRect(0, 0, w, 10); }),
    ceil: canvasTex(128, 128, (g, w, h) => { g.fillStyle = '#5c6167'; g.fillRect(0, 0, w, h); g.strokeStyle = '#4a4f55'; g.lineWidth = 4; g.strokeRect(2, 2, w - 4, h - 4); }),
    hazard: canvasTex(128, 32, (g, w, h) => { g.fillStyle = '#e0b31c'; g.fillRect(0, 0, w, h); g.fillStyle = '#1b1b1b'; for (let x = -32; x < w + 32; x += 32) { g.beginPath(); g.moveTo(x, h); g.lineTo(x + 16, h); g.lineTo(x + 32, 0); g.lineTo(x + 16, 0); g.fill(); } }),
    metal: canvasTex(64, 64, (g, w, h) => { g.fillStyle = '#9aa1a8'; g.fillRect(0, 0, w, h); noise(g, w, h, 300, ['#a6adb4', '#8d949b']); }),
    grate: canvasTex(64, 64, (g, w, h) => { g.fillStyle = '#6f767d'; g.fillRect(0, 0, w, h); g.fillStyle = '#3a3f44'; for (let i = 4; i < w; i += 8) { g.fillRect(i, 0, 3, h); g.fillRect(0, i, w, 3); } }),
    crate: canvasTex(128, 128, (g, w, h) => { g.fillStyle = '#7a6a52'; g.fillRect(0, 0, w, h); noise(g, w, h, 600, ['#86755b', '#6e5f49']); g.strokeStyle = '#4f4434'; g.lineWidth = 8; g.strokeRect(4, 4, w - 8, h - 8); g.beginPath(); g.moveTo(8, 8); g.lineTo(w - 8, h - 8); g.stroke(); }),
    cont: (col) => canvasTex(128, 128, (g, w, h) => { g.fillStyle = col; g.fillRect(0, 0, w, h); for (let x = 0; x < w; x += 16) { g.fillStyle = 'rgba(0,0,0,0.22)'; g.fillRect(x, 0, 5, h); g.fillStyle = 'rgba(255,255,255,0.08)'; g.fillRect(x + 6, 0, 3, h); } noise(g, w, h, 300, ['rgba(60,30,10,0.3)']); }),
    locker: canvasTex(128, 128, (g, w, h) => { g.fillStyle = '#4f6a7a'; g.fillRect(0, 0, w, h); g.fillStyle = '#3c5160'; g.fillRect(62, 0, 4, h); for (const x of [10, 74]) for (let y = 14; y < 40; y += 6) g.fillRect(x, y, 40, 2); g.fillStyle = '#c9cfd3'; g.fillRect(52, 70, 6, 14); g.fillRect(116, 70, 6, 14); }),
    shutter: canvasTex(128, 128, (g, w, h) => { g.fillStyle = '#8b9299'; g.fillRect(0, 0, w, h); for (let y = 0; y < h; y += 12) { g.fillStyle = '#6c737a'; g.fillRect(0, y, w, 4); g.fillStyle = '#a5acb3'; g.fillRect(0, y + 5, w, 2); } }),
  };
  const mat = {
    floor: new THREE.MeshLambertMaterial({ map: T.floor }),
    wall: new THREE.MeshLambertMaterial({ map: T.wall }),
    wallBase: new THREE.MeshLambertMaterial({ map: T.wallBase }),
    ceil: new THREE.MeshLambertMaterial({ map: T.ceil, emissive: '#3a3f45' }),
    hazard: new THREE.MeshLambertMaterial({ map: T.hazard }),
    metal: new THREE.MeshStandardMaterial({ map: T.metal, metalness: 0.5, roughness: 0.5 }),
    grate: new THREE.MeshStandardMaterial({ map: T.grate, metalness: 0.5, roughness: 0.6 }),
    dark: new THREE.MeshLambertMaterial({ color: '#3b4046' }),
    yellow: new THREE.MeshLambertMaterial({ color: '#e0b31c' }),
    crate: new THREE.MeshLambertMaterial({ map: T.crate }),
    contBlue: new THREE.MeshLambertMaterial({ map: T.cont('#2d6aa3') }),
    contRed: new THREE.MeshLambertMaterial({ map: T.cont('#a8452e') }),
    contGreen: new THREE.MeshLambertMaterial({ map: T.cont('#3f7a4a') }),
    locker: new THREE.MeshLambertMaterial({ map: T.locker }),
    white: new THREE.MeshLambertMaterial({ color: '#e7e9e6' }),
    pipe: new THREE.MeshStandardMaterial({ color: '#6f8a5c', metalness: 0.4, roughness: 0.5 }),
    pipe2: new THREE.MeshStandardMaterial({ color: '#8a4436', metalness: 0.4, roughness: 0.5 }),
    strip: new THREE.MeshBasicMaterial({ color: '#f4f8ff' }),                       // ceiling light strips (go red in an alarm)
    redLamp: new THREE.MeshBasicMaterial({ color: '#5a0a0c' }),                    // door lamps / beacons (bright in an alarm)
    screen: new THREE.MeshBasicMaterial({ color: '#2fd1ff' }),
    glass: new THREE.MeshStandardMaterial({ color: '#a8f0ff', transparent: true, opacity: 0.18, roughness: 0.05, metalness: 0.1, side: THREE.DoubleSide, depthWrite: false }),
    podGlow: new THREE.MeshBasicMaterial({ color: '#46ff86' }),
    frost: new THREE.MeshLambertMaterial({ map: T.wall, color: '#bfe2f2', emissive: '#1a2c36' }),     // cold storage wrap panels
    water: new THREE.MeshLambertMaterial({ color: '#1d5a6b', emissive: '#0a2730', transparent: true, opacity: 0.6, depthWrite: false }),
  };
  // whole footprint (local): x BX0..BX1, z BZ0..BZ1 (old core was x -30..30, z -25..25)
  const BX0 = -35, BX1 = 61, BZ0 = -63, BZ1 = 30, TOP = 14.3;

  // ---------- geometry buckets (merged per material at the end) ----------
  const buckets = new Map();
  const put = (m, geo) => { if (!buckets.has(m)) buckets.set(m, []); buckets.get(m).push(geo); };
  // a box whose UVs are in metres (texture tiles every `tile` m), placed by its min/max corners
  function boxGeo(x0, x1, y0, y1, z0, z1, tile = 2) {
    const w = x1 - x0, h = y1 - y0, d = z1 - z0; const g = new THREE.BoxGeometry(w, h, d);
    const uv = g.attributes.uv; const dims = [[d, h], [d, h], [w, d], [w, d], [w, h], [w, h]];
    for (let f = 0; f < 6; f++) for (let k = 0; k < 4; k++) { const i = f * 4 + k; uv.setXY(i, uv.getX(i) * dims[f][0] / tile, uv.getY(i) * dims[f][1] / tile); }
    g.translate((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2); return g;
  }
  const boxes = [];   // every solid box: {min, max, collide, nav (blocks floor walkers), los (blocks sight), surf (slap sound), hang (grip-hang bar)}
  // surf: crates are 'soft', glass 'glass', everything else 'metal' (the floor is tagged 'floor' where it's added)
  function box(x0, x1, y0, y1, z0, z1, m, { collide = true, tile = 2, visual = true, surf = m === mat.crate ? 'soft' : m === mat.glass ? 'glass' : 'metal', hang = false } = {}) {
    if (x1 < x0) [x0, x1] = [x1, x0]; if (z1 < z0) [z0, z1] = [z1, z0];
    if (visual) put(m, boxGeo(x0, x1, y0, y1, z0, z1, tile));
    if (collide) boxes.push({ min: V(x0, y0, z0), max: V(x1, y1, z1), nav: y0 < 2.2 && y1 > 0.25, los: y0 < 1.2 && y1 > 1.2, surf, hang });
  }
  const BAR = { hang: true };   // pipes, bars and rails you can grip and swing on
  const cyl = (x, y, z, r, len, axis, m) => { const g = new THREE.CylinderGeometry(r, r, len, 10, 1); if (axis === 'x') g.rotateZ(Math.PI / 2); if (axis === 'z') g.rotateX(Math.PI / 2); g.translate(x, y, z); put(m, g); };
  const H = 7, WT = 0.4;   // ceiling height, wall thickness
  // a wall along z at x (from z0 to z1) with door gaps [[a,b],...]; a lintel closes the gap above doorH
  function wallZ(x, z0, z1, gaps = [], doorH = 3.4, h = H) {
    let z = z0; const g = gaps.slice().sort((a, b) => a[0] - b[0]);
    for (const [a, b] of g) { if (a > z) seg(x, z, a); box(x - WT / 2, x + WT / 2, doorH, h, a, b, mat.wall); doorFrame('z', x, a, b, doorH); z = b; }
    if (z < z1) seg(x, z, z1);
    function seg(x, a, b) { box(x - WT / 2, x + WT / 2, 0.9, h, a, b, mat.wall); box(x - WT / 2 - 0.02, x + WT / 2 + 0.02, 0, 0.9, a, b, mat.wallBase, { tile: 0.9 }); }
  }
  function wallX(z, x0, x1, gaps = [], doorH = 3.4, h = H) {
    let x = x0; const g = gaps.slice().sort((a, b) => a[0] - b[0]);
    for (const [a, b] of g) { if (a > x) seg(z, x, a); box(a, b, doorH, h, z - WT / 2, z + WT / 2, mat.wall); doorFrame('x', z, a, b, doorH); x = b; }
    if (x < x1) seg(z, x, x1);
    function seg(z, a, b) { box(a, b, 0.9, h, z - WT / 2, z + WT / 2, mat.wall); box(a, b, 0, 0.9, z - WT / 2 - 0.02, z + WT / 2 + 0.02, mat.wallBase, { tile: 0.9 }); }
  }
  const doors = [];   // door centres (nav anchors)
  function doorFrame(axis, c, a, b, h) {
    const t = WT / 2 + 0.06; const m = (a + b) / 2;
    if (axis === 'z') { box(c - t, c + t, 0, h, a - 0.12, a, mat.yellow, { collide: false }); box(c - t, c + t, 0, h, b, b + 0.12, mat.yellow, { collide: false }); box(c - t, c + t, h - 0.12, h, a, b, mat.yellow, { collide: false }); doors.push(V(c, 0, m)); }
    else { box(a - 0.12, a, 0, h, c - t, c + t, mat.yellow, { collide: false }); box(b, b + 0.12, 0, h, c - t, c + t, mat.yellow, { collide: false }); box(a, b, h - 0.12, h, c - t, c + t, mat.yellow, { collide: false }); doors.push(V(m, 0, c)); }
  }
  const floorStripe = (x0, x1, z0, z1) => { const g = new THREE.PlaneGeometry(x1 - x0, z1 - z0); g.rotateX(-Math.PI / 2); const uv = g.attributes.uv; for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * Math.max(x1 - x0, z1 - z0) / 1.2, uv.getY(i)); g.translate((x0 + x1) / 2, 0.006, (z0 + z1) / 2); put(mat.hazard, g); };
  const lampStrip = (x, z, len, axis = 'x', c = H) => { if (axis === 'x') box(x - len / 2, x + len / 2, c - 0.1, c - 0.02, z - 0.16, z + 0.16, mat.strip, { collide: false }); else box(x - 0.16, x + 0.16, c - 0.1, c - 0.02, z - len / 2, z + len / 2, mat.strip, { collide: false }); };
  const crate = (x, z, y = 0, s = 1.2) => box(x - s / 2, x + s / 2, y, y + s, z - s / 2, z + s / 2, mat.crate, { tile: s });
  const container = (x, z, alongX, y, m) => { const L = 6, W = 2.6, Hh = 2.6; if (alongX) box(x - L / 2, x + L / 2, y, y + Hh, z - W / 2, z + W / 2, m, { tile: 2.6 }); else box(x - W / 2, x + W / 2, y, y + Hh, z - L / 2, z + L / 2, m, { tile: 2.6 }); };
  // shelving rack: legs + shelves you can climb (shelves at 1.4 / 2.8 / 4.2)
  function rack(x0, x1, z0, z1, levels = [1.4, 2.8, 4.2]) {
    for (const x of [x0, x1]) for (const z of [z0, z1]) box(x - 0.06, x + 0.06, 0, levels[levels.length - 1] + 0.1, z - 0.06, z + 0.06, mat.dark);
    for (const y of levels) box(x0, x1, y - 0.06, y + 0.04, z0, z1, mat.grate, { tile: 1 });
    for (let k = 0; k < 3; k++) { const y = levels[k % levels.length] + 0.04, cx = x0 + (x1 - x0) * (0.25 + 0.25 * k); crate(cx, (z0 + z1) / 2, y, 0.7); }
  }
  // signs: all drawn into ONE canvas atlas at the end and merged into one mesh (one draw call for every sign)
  const signs = [];
  function sign(text, sub, x, y, z, ry, w = 3.2, h = 0.8, fg = '#e0b31c') { signs.push({ text, sub, x, y, z, ry, w, h, fg }); }
  function buildSigns() {
    const SW = 400, PAD = 4, COLS = 3, colH = new Array(COLS).fill(0);
    for (const s of signs) { s.ph = Math.round(SW * s.h / s.w); let c = 0; for (let k = 1; k < COLS; k++) if (colH[k] < colH[c]) c = k; s.ox = c * (SW + PAD); s.oy = colH[c]; colH[c] += s.ph + PAD; }
    const AW = COLS * (SW + PAD), AH = Math.ceil(Math.max(...colH) / 4) * 4;
    const cv = document.createElement('canvas'); cv.width = AW; cv.height = AH; const g = cv.getContext('2d');
    for (const s of signs) { const W = SW, Hh = s.ph; g.save(); g.translate(s.ox, s.oy); g.beginPath(); g.rect(0, 0, W, Hh); g.clip();
      g.fillStyle = '#1d2126'; g.fillRect(0, 0, W, Hh); g.strokeStyle = s.fg; g.lineWidth = 8; g.strokeRect(5, 5, W - 10, Hh - 10);
      g.fillStyle = s.fg; g.textAlign = 'center'; g.textBaseline = 'middle'; g.font = `900 ${Math.round(Hh * (s.sub ? 0.36 : 0.5))}px Arial`; g.fillText(s.text, W / 2, Hh * (s.sub ? 0.38 : 0.52), W - 24);
      if (s.sub) { g.fillStyle = '#ddd'; g.font = `700 ${Math.round(Hh * 0.17)}px Arial`; g.fillText(s.sub, W / 2, Hh * 0.75, W - 24); } g.restore(); }
    const tex = new THREE.CanvasTexture(cv); tex.colorSpace = THREE.SRGBColorSpace; tex.anisotropy = 4;
    const signMat = new THREE.MeshBasicMaterial({ map: tex });
    for (const s of signs) { const pg = new THREE.PlaneGeometry(s.w, s.h); const uv = pg.attributes.uv;
      for (let i = 0; i < uv.count; i++) uv.setXY(i, (s.ox + uv.getX(i) * SW) / AW, 1 - (s.oy + (1 - uv.getY(i)) * s.ph) / AH);
      pg.rotateY(s.ry); pg.translate(s.x, s.y, s.z); put(signMat, pg); }
  }

  // =================== LAYOUT (local coordinates, x -30..30, z -25..25) ===================
  // floor + ceiling
  // (one floor plane + one floor collider for the whole footprint, new wings included)
  { const W = BX1 - BX0, D = BZ1 - BZ0; const g = new THREE.PlaneGeometry(W, D); g.rotateX(-Math.PI / 2); const uv = g.attributes.uv; for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * W / 4, uv.getY(i) * D / 4);
    g.translate((BX0 + BX1) / 2, 0, (BZ0 + BZ1) / 2); put(mat.floor, g);
    boxes.push({ min: V(BX0, -1, BZ0), max: V(BX1, 0, BZ1), nav: false, los: false, surf: 'floor' }); }
  box(-30, 30, H, H + 0.3, -25, 25, mat.ceil, { tile: 4 });
  // outer walls of the old core, now with doors into the new wings:
  //   north -> ATRIUM (west corridor + storage) and COLD STORAGE (yard), south -> SERVICE TUNNEL (maintenance + loading bay),
  //   west -> SERVICE TUNNEL (observation), east -> PUMP ROOM (yard). East wall still has the shutter opening z 16..22.
  wallX(-25, -30, 30, [[-19.5, -14.5], [-3.5, 1.5], [20.4, 22.4]]); wallX(25, -30, 30, [[9.2, 11.8], [21, 24.6]]); wallZ(-30, -25, 25, [[-1.4, 1.4]]);
  wallZ(30, -25, 10, [[-19, -16], [2, 5.6]]);
  wallZ(30, 10, 25, [[16, 22]], 5.4);
  doors.pop();   // (the shutter opening isn't a nav door; the exit point is inside)

  // ---- WEST WING: specimen cells (x -30..-20, z -25..-7.2), observation (z -7.2..8), regen lab (z 8..25) ----
  wallZ(-20, -25, 8, [[-23.7, -20.7], [-17.7, -14.7], [-11.7, -8.7], [-2, 2]]);
  for (const z of [-19.2, -13.2]) wallX(z, -30, -20);
  wallX(-7.2, -30, -20);
  // regen lab: north wall with a crawl vent (x -28..-26.8, under 1.0 m) - only players fit
  box(-30, -28, 0, H, 8 - WT / 2, 8 + WT / 2, mat.wall); box(-26.8, -20, 0, H, 8 - WT / 2, 8 + WT / 2, mat.wall); box(-28, -26.8, 1.0, H, 8 - WT / 2, 8 + WT / 2, mat.wall);
  // vent duct either side of the hole
  for (const [z0, z1] of [[6.2, 7.8], [8.2, 9.8]]) { box(-28.15, -28.0, 0, 1.1, z0, z1, mat.metal); box(-26.8, -26.65, 0, 1.1, z0, z1, mat.metal); box(-28.15, -26.65, 1.0, 1.12, z0, z1, mat.metal); }
  wallZ(-20, 8, 25, [[14, 17]]);
  // cells: back-wall restraints, drains, red lamps over the doors
  [[-22.2, 'A'], [-16.2, 'B'], [-10.2, 'C']].forEach(([z, L]) => {
    box(-29.8, -29.4, 1.2, 1.5, z - 1.2, z + 1.2, mat.dark); box(-29.8, -29.5, 0, 3.2, z - 0.1, z + 0.1, mat.dark);
    box(-20.4, -20.2, 3.5, 3.8, z - 0.3, z + 0.3, mat.redLamp, { collide: false });
    sign(`CELL ${L}`, 'SPECIMEN - DO NOT OPEN', -19.75, 4.3, z, Math.PI / 2, 2.4, 0.7, '#ff4040');
    floorStripe(-21.5, -20.2, z - 1.5, z + 1.5);
  });
  sign('SPECIMEN CELLS', 'CONTAINMENT WING', -17, 5.2, -24.75, 0, 4, 1, '#ff4040');
  // observation room: desks with monitors
  for (const z of [-4.5, 3.5]) { box(-29.4, -27.4, 0, 0.9, z - 1.6, z + 1.6, mat.white); box(-29.6, -29.4, 0.9, 1.6, z - 1.4, z + 1.4, mat.dark); box(-29.38, -29.36, 1.0, 1.5, z - 1.2, z + 1.2, mat.screen, { collide: false }); }
  box(-24, -22.4, 0, 0.9, -1.5, 1.5, mat.white);
  sign('OBSERVATION', '', -20.25, 4.2, 5.5, Math.PI / 2, 2.4, 0.6);
  // regen lab: the pod, beds, a tall shelf to climb
  { const g = new THREE.CylinderGeometry(1.0, 1.1, 0.2, 24); g.translate(-25, 0.1, 18); put(mat.metal, g); boxes.push({ min: V(-26.1, 0, 16.9), max: V(-23.9, 0.2, 19.1), nav: false, los: false });
    const gl = new THREE.CylinderGeometry(0.95, 0.95, 2.7, 24, 1, true); gl.translate(-25, 1.55, 18); put(mat.glass, gl);
    const ring = new THREE.TorusGeometry(0.85, 0.05, 8, 40); ring.rotateX(Math.PI / 2); ring.translate(-25, 0.22, 18); put(mat.podGlow, ring);
    const top = new THREE.CylinderGeometry(1.0, 1.0, 0.3, 24); top.translate(-25, 3.05, 18); put(mat.metal, top); }
  for (const z of [11, 23]) { box(-29.4, -27.2, 0, 0.7, z - 0.6, z + 0.6, mat.white); box(-29.4, -29.2, 0.7, 1.2, z - 0.6, z + 0.6, mat.white); }
  rack(-23.5, -20.8, 23.4, 24.6);
  sign('REGEN LAB', 'AUTHORISED SUBJECTS ONLY', -19.75, 4.3, 19.5, Math.PI / 2, 2.6, 0.7, '#46ff86');
  sign('VENT', '', -27.4, 1.5, 7.75, Math.PI, 1.2, 0.4);

  // ---- WEST CORRIDOR (x -20..-14) is open from z -25 to 25; pipes along it to swing on ----
  cyl(-15.0, 2.7, 0, 0.12, 49.6, 'z', mat.pipe); cyl(-15.0, 3.2, 0, 0.1, 49.6, 'z', mat.pipe2);
  boxes.push({ min: V(-15.12, 2.58, -24.8), max: V(-14.88, 2.82, 24.8), nav: false, los: false, surf: 'metal', hang: true });
  boxes.push({ min: V(-15.1, 3.1, -24.8), max: V(-14.9, 3.3, 24.8), nav: false, los: false, surf: 'metal', hang: true });
  for (let z = -22; z <= 22; z += 4) box(-15.1, -14.4, 2.5, 3.4, z - 0.08, z + 0.08, mat.dark, { collide: false });

  // ---- TEST HALL (x -14..12, z -14..12) ----
  wallZ(-14, -25, -14, [[-22, -18]]);
  wallZ(-14, -14, 12, [[-3, 1]]);
  wallZ(12, -25, 25, [[-22, -18], [-6, -2], [5, 8], [16, 20]]);
  wallX(-14, -14, 12, [[-2, 2]]);
  wallX(12, -14, 12, [[-2, 2]]);
  wallX(12, 12, 30, [[19, 24]]);
  // catwalk ring at 3.5 m (grate), railings, support posts
  const CW = 3.5, CWW = 1.8;
  box(-13.8, 11.8, CW - 0.15, CW, -13.8, -13.8 + CWW, mat.grate, { tile: 1 });
  box(-13.8, 11.8, CW - 0.15, CW, 11.8 - CWW, 11.8, mat.grate, { tile: 1 });
  box(-13.8, -13.8 + CWW, CW - 0.15, CW, -13.8 + CWW, 11.8 - CWW, mat.grate, { tile: 1 });
  box(11.8 - CWW, 11.8, CW - 0.15, CW, -13.8 + CWW, 11.8 - CWW, mat.grate, { tile: 1 });
  const rail = (x0, x1, z0, z1) => { box(x0, x1, CW + 0.95, CW + 1.02, z0, z1, mat.yellow, BAR); };
  rail(-12, -2.6, -12.04, -11.96); rail(2.6, 10, -12.04, -11.96); rail(-12, -2.6, 9.96, 10.04); rail(2.6, 10, 9.96, 10.04);
  rail(-12.04, -11.96, -12, -3); rail(-12.04, -11.96, 1, 10); rail(9.96, 10.04, -12, -3); rail(9.96, 10.04, 1, 10);
  for (const x of [-12, -6, 0, 6, 10]) for (const z of [-12, 10]) box(x - 0.1, x + 0.1, 0, CW - 0.15, z - 0.1, z + 0.1, mat.dark);
  for (const z of [-6, 2]) for (const x of [-12, 10]) box(x - 0.1, x + 0.1, 0, CW - 0.15, z - 0.1, z + 0.1, mat.dark);
  // monkey bars across the hall at 3.3 m (west catwalk to east catwalk), on two beams
  for (let x = -11.6; x <= 9.6; x += 0.6) box(x - 0.04, x + 0.04, 3.26, 3.34, -2.0, 0.0, mat.metal, { tile: 0.5, hang: true });
  box(-12, 10, 3.34, 3.44, -2.06, -1.96, mat.yellow, BAR); box(-12, 10, 3.34, 3.44, -0.04, 0.06, mat.yellow, BAR);
  // test rig in the middle: a raised platform with a bar cage to climb
  box(-4, 2, 0, 1.2, -9, -5, mat.metal, { tile: 1 });
  for (const x of [-4, -1, 2]) for (const z of [-9, -5]) box(x - 0.05, x + 0.05, 1.2, 3.2, z - 0.05, z + 0.05, mat.dark, BAR);
  box(-4.05, 2.05, 3.2, 3.3, -9.05, -4.95, mat.yellow, BAR);
  floorStripe(-4.5, 2.5, -4.6, -4.3); floorStripe(-4.5, 2.5, -9.7, -9.4);
  // crate stairs up to the catwalk in two corners
  crate(-12.6, 9.2, 0, 1.2); crate(-12.6, 7.8, 0, 1.2); crate(-12.6, 7.8, 1.2, 1.2); crate(-11.2, 7.8, 0, 1.2); crate(-11.2, 7.8, 1.2, 1.2); crate(-11.2, 7.8, 2.4, 1.0);
  crate(10.6, -11.4, 0, 1.2); crate(9.2, -11.4, 0, 1.2); crate(9.2, -11.4, 1.2, 1.2); crate(9.2, -10.0, 0, 1.2); crate(9.2, -10.0, 1.2, 1.2); crate(9.2, -10.0, 2.4, 1.0);
  // low vent duct along the south side of the hall (players crawl through it, monsters can't)
  box(-10, -3, 0, 1.1, 8.6, 8.75, mat.metal); box(-10, -3, 0, 1.1, 9.85, 10.0, mat.metal); box(-10, -3, 1.0, 1.12, 8.6, 10.0, mat.metal);
  sign('TEST HALL', 'FACILITY 7', -1, 5.6, -13.75, 0, 4.4, 1.1);
  // lab tables
  for (const [x, z] of [[5, 4], [-8, 3]]) { box(x - 1.2, x + 1.2, 0, 0.9, z - 0.5, z + 0.5, mat.white); box(x - 0.6, x + 0.4, 0.9, 1.3, z - 0.2, z + 0.2, mat.dark); }

  // ---- NORTH STORAGE (x -14..12, z -25..-14): rows of racks ----
  rack(-11, -4, -23.6, -22.4); rack(2, 9, -23.6, -22.4); rack(-11, -6, -17.2, -16.0); rack(4, 9, -17.2, -16.0);
  crate(-1, -19.8, 0, 1.2); crate(0.3, -19.8, 0, 1.2); crate(-0.3, -19.8, 1.2, 1.0);   // (moved off the new atrium door)
  sign('STORAGE', '', -1, 4.8, -24.75, 0, 2.6, 0.7);

  // ---- CONTAINER YARD (x 12..30, z -25..12) ----
  container(17, -21, true, 0, mat.contBlue); container(17, -21, true, 2.6, mat.contRed); container(25.5, -21.6, true, 0, mat.contGreen);
  container(19.6, -12, false, 0, mat.contBlue); container(19.6, -12, false, 2.6, mat.contGreen);
  container(24.0, -12, false, 0, mat.contGreen); container(28.3, -12, false, 0, mat.contBlue); container(28.3, -12, false, 2.6, mat.contRed);
  container(17.5, -2.5, true, 0, mat.contGreen); container(26.6, -2.5, true, 0, mat.contRed); container(26.6, -2.5, true, 2.6, mat.contBlue);
  container(16.8, 7.6, true, 0, mat.contBlue); container(16.8, 7.6, true, 2.6, mat.contGreen); container(26.2, 8.0, true, 0, mat.contRed);
  crate(13.4, 10.8, 0, 1.2); crate(13.4, 10.8, 1.2, 1.2); crate(14.7, 10.8, 0, 1.2);          // steps up onto the stacked container
  crate(29.0, -6.4, 0, 1.2); crate(29.0, -6.4, 1.2, 1.2); crate(29.0, -6.4, 2.4, 1.2);          // steps up onto the far stack
  sign('CONTAINER YARD', '', 21, 5.6, -24.75, 0, 4, 0.9);

  // ---- SOUTH MAINTENANCE (x -20..12, z 12..25): lockers, crates, a mezzanine ----
  for (let x = -12; x < 8; x += 1.3) box(x, x + 1.2, 0, 2.1, 24.1, 24.8, mat.locker, { tile: 1.2 });
  box(-10, -2, 3.0, 3.2, 21.0, 24.8, mat.grate, { tile: 1 });
  for (const x of [-10, -2]) box(x - 0.08, x + 0.08, 0, 3.0, 20.9, 21.1, mat.dark);
  box(-10, -2, 4.0, 4.06, 20.96, 21.04, mat.yellow);
  crate(-1, 19.4, 0, 1.2); crate(-1, 19.4, 1.2, 1.2); crate(0.3, 19.4, 0, 1.2);
  crate(-16.5, 22.8, 0, 1.2); crate(-17.8, 22.8, 0, 1.2); crate(-17.2, 22.8, 1.2, 1.2);
  crate(6.5, 15.5, 0, 1.2); crate(7.8, 15.5, 0, 1.2);
  cyl(0, 5.2, 24.4, 0.15, 39, 'x', mat.pipe2); cyl(0, 5.7, 24.4, 0.12, 39, 'x', mat.pipe);
  boxes.push({ min: V(-19.5, 5.05, 24.25), max: V(19.5, 5.35, 24.55), nav: false, los: false, surf: 'metal', hang: true });   // grip these to swing
  boxes.push({ min: V(-19.5, 5.58, 24.28), max: V(19.5, 5.82, 24.52), nav: false, los: false, surf: 'metal', hang: true });
  sign('MAINTENANCE', '', -4, 5.4, 24.75, Math.PI, 3, 0.8);

  // ---- LOADING BAY (x 12..30, z 12..25): racks, dock, the shutter ----
  rack(15, 19.5, 22.4, 24.6); rack(15, 19.5, 13.0, 14.2);
  box(25.5, 29.8, 0, 1.2, 12.4, 15, mat.metal, { tile: 1 }); floorStripe(25.5, 29.8, 15, 15.3);
  crate(26.5, 13.5, 1.2, 1.2); crate(28, 13.5, 1.2, 1.2); crate(27.2, 13.5, 2.4, 1.2);
  floorStripe(26.5, 29.8, 15.8, 16.1); floorStripe(26.5, 29.8, 21.9, 22.2);
  sign('LOADING BAY', 'EXIT - 3 KEYCARDS REQUIRED', 29.75, 6.15, 19, -Math.PI / 2, 5, 1.0, '#e0b31c');
  // keycard reader panel next to the shutter: 3 lights that turn green
  box(29.6, 29.8, 1.2, 2.0, 22.8, 23.6, mat.dark);
  const cardLights = [0, 1, 2].map(i => { const m = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.12, 0.12), new THREE.MeshBasicMaterial({ color: '#801010' })); m.position.set(29.58, 1.8 - i * 0.22, 23.2); group.add(m); return m; });

  // =================== NEW WINGS ===================
  let seed = 7; const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;   // seeded: same layout every load
  const wz = (x, z0, z1, y0, y1, m = mat.wall) => box(x - WT / 2, x + WT / 2, y0, y1, z0, z1, m);   // plain wall slab along z
  const wx = (z, x0, x1, y0, y1, m = mat.wall) => box(x0, x1, y0, y1, z - WT / 2, z + WT / 2, m);   // plain wall slab along x
  const deck = (x0, x1, z0, z1, y) => box(x0, x1, y - 0.15, y, z0, z1, mat.grate, { tile: 1 });
  const post = (x, z, y1) => box(x - 0.1, x + 0.1, 0, y1, z - 0.1, z + 0.1, mat.dark);
  const railX = (x0, x1, y, z) => box(x0, x1, y, y + 0.07, z - 0.04, z + 0.04, mat.yellow, BAR);
  const railZ = (z0, z1, y, x) => box(x - 0.04, x + 0.04, y, y + 0.07, z0, z1, mat.yellow, BAR);
  // pipes you can grip and swing on (visual cylinder + a thin hang collider; keep them above 2.2 m so walkers pass under)
  const pipeX = (x0, x1, y, z, r = 0.12, m = mat.pipe) => { cyl((x0 + x1) / 2, y, z, r, x1 - x0, 'x', m); boxes.push({ min: V(x0, y - r, z - r), max: V(x1, y + r, z + r), nav: false, los: false, surf: 'metal', hang: true }); };
  const pipeZ = (z0, z1, y, x, r = 0.12, m = mat.pipe) => { cyl(x, y, (z0 + z1) / 2, r, z1 - z0, 'z', m); boxes.push({ min: V(x - r, y - r, z0), max: V(x + r, y + r, z1), nav: false, los: false, surf: 'metal', hang: true }); };
  // open steel stairs along z: n treads from y0 to y1 starting at z0 going dir (+1 / -1)
  function stairs(x0, x1, z0, dir, y0, y1, n, d = 0.6) { for (let i = 0; i < n; i++) { const top = y0 + (y1 - y0) * (i + 1) / n, a = z0 + dir * i * d; box(x0, x1, top - 0.15, top, a, a + dir * d, mat.grate, { tile: 1 }); } }
  // a square column floor-to-ceiling with grip ledges spiralling up it (a climbing route)
  function pillar(x, z, top) {
    box(x - 0.6, x + 0.6, 0, top, z - 0.6, z + 0.6, mat.wall);
    for (let k = 0, y = 1.3; y < top - 0.8; y += 1.35, k++) { const s = k % 4;
      if (s === 0) box(x - 0.45, x + 0.45, y, y + 0.12, z + 0.6, z + 1.0, mat.yellow, BAR); else if (s === 1) box(x + 0.6, x + 1.0, y, y + 0.12, z - 0.45, z + 0.45, mat.yellow, BAR);
      else if (s === 2) box(x - 0.45, x + 0.45, y, y + 0.12, z - 1.0, z - 0.6, mat.yellow, BAR); else box(x - 1.0, x - 0.6, y, y + 0.12, z - 0.45, z + 0.45, mat.yellow, BAR); }
  }
  const GL = 7.3, AH = 14, UH = 11, PH = 9, TH = 3.6;   // gallery / level-2 floor, atrium ceiling, offices ceiling, pump room ceiling, tunnel ceiling

  // ---- ATRIUM (x -30..6, z -58..-25): two storeys, 14 m high. Ground floor, a gallery ring at 7.3, a mid catwalk at 3.8,
  //      a bridge, stairs, ledge pillars, monkey bars and swing pipes. Doors: west corridor + storage (south), service tunnel (west, north),
  //      cold storage (east, ground), upper offices (east, level 2) ----
  wx(-25, -30, 6, H, AH);                                                     // old north wall continues up to the atrium ceiling
  wallZ(-30, -58, -25, [[-45, -41]], 3.4, AH);
  wallX(-58, -30, 6, [[-21, -17]], 3.4, AH);
  wallZ(6, -58, -25, [[-40, -36], [-29, -26]], 3.4, GL);                     // ground floor part of the east wall
  wz(6, -58, -50, GL, AH); wz(6, -50, -47, 10.6, AH); wz(6, -47, -42, GL, AH);   // level 2: door to the offices at z -50..-47
  wz(6, -42, -30, GL, 8.3); box(5.95, 6.05, 8.3, 10.4, -42, -30, mat.glass); wz(6, -42, -30, 10.4, AH); wz(6, -30, -25, GL, AH);   // office window
  box(5.8, 6.2, 10.48, 10.6, -50.1, -46.9, mat.yellow, { collide: false });
  box(-30, 6, AH, AH + 0.3, -58, -25, mat.ceil, { tile: 4 });
  for (let x = -24; x <= 0; x += 8) for (let z = -52; z <= -31; z += 7) lampStrip(x, z, 3, 'x', AH);
  // gallery ring (level 2)
  deck(-29.8, -27, -57.8, -25.2, GL); deck(3, 5.8, -57.8, -25.2, GL); deck(-27, 3, -57.8, -55, GL); deck(-27, 3, -28, -25.2, GL);
  for (const z of [-41.5, -33]) { lampStrip(-28.4, z, 5, 'z', 7.15); lampStrip(4.4, z, 5, 'z', 7.15); }
  railZ(-55, -28, GL + 1.0, -27); railZ(-55, -50.4, GL + 1.0, 3); railZ(-49.1, -28, GL + 1.0, 3);
  railX(-27, -13.2, GL + 1.0, -55); railX(-10.8, 3, GL + 1.0, -55); railX(-27, -13.2, GL + 1.0, -28); railX(-10.8, 3, GL + 1.0, -28);
  for (const z of [-55, -48, -41, -35, -28]) { post(-27, z, GL - 0.15); post(3, z, GL - 0.15); }
  // bridge across the middle at level 2
  deck(-13, -11, -55, -28, GL); railZ(-55, -28, GL + 1.0, -13); railZ(-55, -28, GL + 1.0, -11);
  for (const z of [-46, -35]) { post(-13.1, z, GL - 0.15); post(-10.9, z, GL - 0.15); }
  // mid catwalk at 3.8 (west to east) + stairs: floor -> mid catwalk (west), mid catwalk -> gallery (east)
  deck(-27, 3, -42.9, -41.1, 3.8); railX(-27, 3, 4.8, -42.9); railX(-23.6, 3, 4.8, -41.1);
  for (const x of [-20, -6, 1]) { post(x, -42.9, 3.65); post(x, -41.1, 3.65); }
  stairs(-25.8, -23.8, -30.6, -1, 0, 3.8, 10); deck(-25.8, -23.8, -41.1, -36.6, 3.8); post(-25.7, -36.7, 3.65); post(-23.9, -36.7, 3.65);
  stairs(0.6, 2.6, -42.9, -1, 3.8, GL, 9); deck(0.6, 3, -49.3, -48.3, GL);
  // ledge pillars (climb straight up to the gallery and the bars)
  for (const [x, z] of [[-22, -34], [-2, -34], [-22, -50], [-2, -50]]) pillar(x, z, AH);
  // monkey bars at 9.6 between the west and east galleries, swing pipes at 5.4 north-south
  railX(-27, 3, 9.6, -52.3); railX(-27, 3, 9.6, -50.7);
  for (let x = -26.6; x <= 2.7; x += 0.6) box(x - 0.04, x + 0.04, 9.56, 9.64, -52.3, -50.7, mat.metal, { tile: 0.5, hang: true });
  pipeZ(-55, -28, 5.4, -18); pipeZ(-55, -28, 5.4, -6, 0.12, mat.pipe2);
  // display tank (empty specimen tube) - climb on top
  { const base = new THREE.CylinderGeometry(1.7, 1.8, 0.4, 16); base.translate(-12, 0.2, -49); put(mat.metal, base);
    const gl = new THREE.CylinderGeometry(1.5, 1.5, 3.4, 16, 1, true); gl.translate(-12, 2.1, -49); put(mat.glass, gl);
    const cap = new THREE.CylinderGeometry(1.7, 1.7, 0.3, 16); cap.translate(-12, 3.95, -49); put(mat.metal, cap);
    const ring = new THREE.TorusGeometry(1.35, 0.05, 6, 32); ring.rotateX(Math.PI / 2); ring.translate(-12, 0.45, -49); put(mat.podGlow, ring);
    box(-13.2, -10.8, 0, 4.1, -50.2, -47.8, mat.metal, { visual: false, surf: 'glass' }); }
  // reception desk + planters on the ground floor
  box(-16, -8, 0, 1.1, -31.2, -30.2, mat.white); box(-14, -10, 1.1, 1.5, -30.9, -30.7, mat.dark); box(-13.8, -10.2, 1.15, 1.45, -30.69, -30.67, mat.screen, { collide: false });
  for (const [x, z] of [[-6, -37], [-18, -45], [-6, -54], [-25, -53]]) box(x - 1.2, x + 1.2, 0, 0.7, z - 0.6, z + 0.6, mat.dark);
  crate(4.9, -26.2, 0, 1.2); crate(4.9, -26.2, 1.2, 1.2); crate(3.6, -26.2, 0, 1.2);   // a step up toward the south gallery
  sign('ATRIUM', 'LEVEL 1  -  LEVEL 2', -12, 11, -25.25, Math.PI, 6, 1.4, '#29c8ff');
  sign('ATRIUM', '', -1, 6.2, -24.75, 0, 2.2, 0.5, '#29c8ff'); sign('ATRIUM', '', -17, 6.3, -24.75, 0, 2.2, 0.5, '#29c8ff');
  sign('LEVEL 2', 'UPPER OFFICES  >', 5.75, 9.0, -44.5, -Math.PI / 2, 2.4, 0.7);

  // ---- COLD STORAGE (x 6..30, z -58..-25, ceiling 7): a maze of 5.6 m shelving, wrap panels block sight on some rows.
  //      Doors: atrium (west), container yard (south), pump room (east), service tunnel (north). A hatch in the ceiling
  //      (above the row at z -40) climbs up into the UPPER OFFICES ----
  wallX(-58, 6, 30, [[16, 19]], 3.4, UH);
  wallZ(30, -58, -25, [[-50, -46], [-34, -31]], 3.4, GL);
  wz(30, -58, -30, GL, UH); wz(30, -30, -27, 10.6, UH); wz(30, -27, -25, GL, UH);   // level 2: door out to the pump room high catwalk
  box(29.8, 30.2, 10.48, 10.6, -30.1, -26.9, mat.yellow, { collide: false });
  wx(-25, 6, 30, H, UH);
  // ceiling = offices floor, with the hatch hole at x 11..13.5, z -41.5..-38.5
  for (const [x0, x1, z0, z1] of [[6, 30, -58, -41.5], [6, 30, -38.5, -25], [6, 11, -41.5, -38.5], [13.5, 30, -41.5, -38.5]]) { box(x0, x1, H, GL, z0, z1, mat.ceil, { tile: 4 }); box(x0, x1, GL, GL + 0.02, z0, z1, mat.floor, { collide: false, tile: 4 }); }
  box(10.9, 13.6, GL, GL + 0.1, -41.6, -41.5, mat.hazard, { collide: false }); box(10.9, 13.6, GL, GL + 0.1, -38.5, -38.4, mat.hazard, { collide: false });
  box(10.9, 11, GL, GL + 0.1, -41.5, -38.5, mat.hazard, { collide: false }); box(13.5, 13.6, GL, GL + 0.1, -41.5, -38.5, mat.hazard, { collide: false });
  function coldRack(x0, x1, zc, back) {
    const z0 = zc - 0.6, z1 = zc + 0.6, top = 5.6, n = Math.max(1, Math.round((x1 - x0) / 3));
    for (let i = 0; i <= n; i++) { const x = x0 + (x1 - x0) * i / n; for (const z of [z0, z1]) box(x - 0.06, x + 0.06, 0, top + 0.1, z - 0.06, z + 0.06, mat.dark); }
    for (const y of [0.3, 1.4, 2.8, 4.2, top]) box(x0, x1, y - 0.06, y + 0.04, z0, z1, mat.grate, { tile: 1 });
    if (back) box(x0, x1, 0.34, top - 0.06, zc - 0.04, zc + 0.04, mat.frost, { tile: 3 });
    for (let x = x0 + 0.5; x < x1 - 0.4; x += 1.0) if (rnd() < 0.4) crate(x, zc + (rnd() < 0.5 ? -0.3 : 0.3), [0.34, 1.44, 2.84, 4.24][(rnd() * 4) | 0], 0.5);
  }
  for (const [zc, segs, back] of [[-30, [[7.2, 15.2], [17.8, 28.8]], true], [-35, [[7.2, 21.2], [23.8, 28.8]], false], [-40, [[9.2, 24.2], [26.8, 28.8]], true],
    [-45, [[7.2, 12.2], [14.8, 28.8]], false], [-50, [[7.2, 18.2], [20.8, 28.8]], true], [-55, [[9.2, 21.2], [23.8, 28.8]], false]])
    for (const [a, b] of segs) coldRack(a, b, zc, back);
  for (const z of [-27.3, -32.5, -37.5, -42.5, -47.5, -52.5, -56.7]) { lampStrip(12, z, 4); lampStrip(23, z, 4); }
  sign('COLD STORAGE', 'KEEP DOORS CLOSED', 12, 5.0, -25.25, Math.PI, 3.6, 0.9, '#8fdcff');
  sign('COLD STORAGE', '', 21.4, 6.5, -24.75, 0, 2.4, 0.5, '#8fdcff'); sign('COLD STORAGE', '', 5.75, 4.3, -38, -Math.PI / 2, 2.6, 0.6, '#8fdcff');

  // ---- UPPER OFFICES (level 2 over cold storage, floor 7.3, ceiling 11): only reachable by climbing (atrium gallery,
  //      the cold storage hatch, the pump room high catwalk). Floor walkers never come up here ----
  box(6, 30, UH, UH + 0.3, -58, -25, mat.ceil, { tile: 4 });
  for (let x = 10; x <= 26; x += 8) for (let z = -54; z <= -28; z += 6.5) lampStrip(x, z, 3, 'x', UH);
  for (let x = 8; x < 27.5; x += 1.6) { box(x, x + 1.2, GL, GL + 2.3, -57.8, -56.8, mat.dark); box(x + 0.1, x + 1.1, GL + 1.6, GL + 1.7, -56.79, -56.77, mat.screen, { collide: false }); }   // server racks
  wx(-46, 8, 18, GL, GL + 1.5, mat.white); wx(-46, 21, 29, GL, GL + 1.5, mat.white); wx(-36, 15, 29, GL, GL + 1.5, mat.white);   // cubicle partitions
  wz(18, -36, -30, GL, GL + 1.5, mat.white); wz(22, -52, -46, GL, GL + 1.5, mat.white);
  for (const [x, z] of [[10, -52], [14, -52], [26, -52], [10, -31], [25, -30], [26, -41], [17, -42]]) {
    box(x - 0.9, x + 0.9, GL, GL + 0.85, z - 0.45, z + 0.45, mat.white); box(x - 0.35, x + 0.35, GL + 0.85, GL + 1.3, z - 0.05, z + 0.05, mat.dark);
    box(x - 0.3, x + 0.3, GL + 0.9, GL + 1.25, z + 0.051, z + 0.06, mat.screen, { collide: false }); }
  box(7, 29, 10.15, 10.25, -34.1, -33.9, mat.yellow, BAR); box(7, 29, 10.15, 10.25, -49.1, -48.9, mat.yellow, BAR);   // cable trays to hang from
  sign('UPPER OFFICES', 'LEVEL 2 - STAFF ONLY', 18, 9.6, -25.25, Math.PI, 4, 1);

  // ---- PUMP ROOM (x 30..56, z -58..6, ceiling 9): flooded floor, three big tanks, a lattice of overhead pipes to swing across,
  //      a mid catwalk (3.6, north + east walls) and a high catwalk (7.3, west wall) that leads into the upper offices.
  //      Doors: container yard (2, west), cold storage (2, west), service tunnel (north, east x2) ----
  wz(30, -25, 6, H, PH);
  wallX(-58, 30, 56, [[42, 46]], 3.4, PH);
  wallZ(56, -58, 6, [[-40, -36], [-12, -8]], 3.4, PH);
  wallX(6, 30, 56, [], 3.4, PH);
  box(30, 56, PH, PH + 0.3, -58, 6, mat.ceil, { tile: 4 });
  for (const x of [34, 42, 50]) for (let z = -52; z <= 2; z += 9) lampStrip(x, z, 3, 'z', PH);
  { const g = new THREE.PlaneGeometry(25.6, 63.6); g.rotateX(-Math.PI / 2); g.translate(43, 0.3, -26); put(mat.water, g); }
  for (const [x, z] of [[38.5, -44], [48, -44], [47.5, -14]]) {
    const t = new THREE.CylinderGeometry(2.4, 2.4, 6.5, 16); t.translate(x, 3.25, z); put(mat.metal, t);
    const bandG = new THREE.CylinderGeometry(2.45, 2.45, 0.3, 16, 1, true); bandG.translate(x, 2.0, z); put(mat.yellow, bandG);
    cyl(x, 7.75, z, 0.35, 2.5, 'y', mat.pipe2);
    // collider: a cross of boxes + a middle box, close to the round shape
    box(x - 2.3, x + 2.3, 0, 6.5, z - 1.0, z + 1.0, mat.metal, { visual: false }); box(x - 1.0, x + 1.0, 0, 6.5, z - 2.3, z + 2.3, mat.metal, { visual: false }); box(x - 1.7, x + 1.7, 0, 6.5, z - 1.7, z + 1.7, mat.metal, { visual: false });
  }
  pipeX(40.9, 45.6, 5.2, -44, 0.15, mat.pipe2);                                  // tank to tank
  for (const z of [-51, -37, -28, -21, -6, 2]) pipeX(32.8, 53.4, 4.6, z);          // the swing lattice
  for (const x of [35, 43.25, 52.2]) pipeZ(-55.4, 4, 5.4, x, 0.12, mat.pipe2);
  pipeX(32.8, 53.4, 8.0, -33, 0.12, mat.pipe2);                                  // a high one off the high catwalk
  // high catwalk (level 2, west wall)
  deck(30.2, 32.6, -55, -22, GL); railZ(-55, -22, GL + 1.0, 32.6); railX(30.2, 32.6, GL + 1.0, -22);
  for (const z of [-55, -48, -41, -34, -27, -22]) post(32.5, z, GL - 0.15);
  // mid catwalk (north + east walls)
  deck(30.2, 55.8, -57.8, -55.6, 3.6); railX(32.6, 53.6, 4.6, -55.6);
  deck(53.6, 55.8, -55.6, 4, 3.6); railZ(-55.6, 4, 4.6, 53.6);
  for (const x of [37, 49]) post(x, -55.7, 3.45); for (const z of [-44, -30, -18, -4, 3]) post(53.7, z, 3.45);
  crate(33, -54.2, 0, 1.2); crate(33, -54.2, 1.2, 1.2); crate(33, -54.2, 2.4, 1.2);             // floor -> mid catwalk
  crate(31.4, -56.7, 3.6, 1.2); crate(31.4, -56.7, 4.8, 1.2); crate(31.4, -56.7, 6.0, 1.2);     // mid catwalk -> high catwalk
  // pump housings (steps out of the water) with valve wheels
  for (const [x, z] of [[34.2, -8], [34.2, 0], [52, -26], [40, -30]]) { box(x - 1.2, x + 1.2, 0, 1.6, z - 1, z + 1, mat.metal, { tile: 1 });
    const w = new THREE.TorusGeometry(0.35, 0.05, 6, 16); w.rotateX(Math.PI / 2); w.translate(x, 1.75, z); put(mat.pipe2, w); }
  crate(52.6, -26, 1.6, 1.2);                                                    // pump -> east catwalk
  sign('PUMP ROOM', 'FLOODED - WATCH YOUR STEP', 43, 6.5, 5.75, Math.PI, 4.4, 1.1, '#46c8ff');
  sign('PUMP ROOM', '', 29.75, 4.6, -17.5, -Math.PI / 2, 2.4, 0.6, '#46c8ff'); sign('PUMP ROOM', '', 29.75, 4.3, -48, -Math.PI / 2, 2.4, 0.6, '#46c8ff');

  // ---- SERVICE TUNNEL: a 5 m wide, 3.6 m high loop around the whole building (about 380 m). Pipes along the outer wall
  //      to swing on, bulkhead frames every 12 m. Doors: observation, atrium (x2), cold storage, pump room (x3), maintenance, loading bay ----
  wallZ(BX0, BZ0, BZ1, [], 3.4, TH + 0.3); wallX(BZ0, BX0, BX1, [], 3.4, TH + 0.3); wallZ(BX1, BZ0, BZ1, [], 3.4, TH + 0.3); wallX(BZ1, BX0, BX1, [], 3.4, TH + 0.3);
  wallX(25, 30, 56, [], 3.4, TH + 0.3); wallZ(56, 6, 25, [], 3.4, TH + 0.3);     // inner walls round the outside yard (behind the exit shutter)
  box(BX0, -30, TH, TH + 0.3, BZ0, BZ1, mat.ceil, { tile: 4 }); box(-30, BX1, TH, TH + 0.3, BZ0, -58, mat.ceil, { tile: 4 });
  box(56, BX1, TH, TH + 0.3, -58, BZ1, mat.ceil, { tile: 4 }); box(-30, 56, TH, TH + 0.3, 25, BZ1, mat.ceil, { tile: 4 });
  for (let z = -59; z <= 27; z += 8) { lampStrip(-32.5, z, 2, 'z', TH); lampStrip(58.5, z, 2, 'z', TH); }
  for (let x = -28; x <= 56; x += 8) { lampStrip(x, -60.5, 2, 'x', TH); lampStrip(x, 27.5, 2, 'x', TH); }
  pipeZ(BZ0 + 0.4, BZ1 - 0.4, 2.5, BX0 + 0.6); pipeZ(BZ0 + 0.4, BZ1 - 0.4, 3.0, BX0 + 0.6, 0.1, mat.pipe2);
  pipeZ(BZ0 + 0.4, BZ1 - 0.4, 2.5, BX1 - 0.6); pipeZ(BZ0 + 0.4, BZ1 - 0.4, 3.0, BX1 - 0.6, 0.1, mat.pipe2);
  pipeX(BX0 + 0.4, BX1 - 0.4, 2.5, BZ0 + 0.6); pipeX(BX0 + 0.4, BX1 - 0.4, 3.0, BZ0 + 0.6, 0.1, mat.pipe2);
  pipeX(BX0 + 0.4, BX1 - 0.4, 2.5, BZ1 - 0.6); pipeX(BX0 + 0.4, BX1 - 0.4, 3.0, BZ1 - 0.6, 0.1, mat.pipe2);
  const bulkZ = (x0, x1, z) => { box(x0, x1, 3.3, TH, z - 0.12, z + 0.12, mat.yellow, { collide: false }); box(x0, x0 + 0.2, 0, TH, z - 0.12, z + 0.12, mat.yellow, { collide: false }); box(x1 - 0.2, x1, 0, TH, z - 0.12, z + 0.12, mat.yellow, { collide: false }); };
  const bulkX = (z0, z1, x) => { box(x - 0.12, x + 0.12, 3.3, TH, z0, z1, mat.yellow, { collide: false }); box(x - 0.12, x + 0.12, 0, TH, z0, z0 + 0.2, mat.yellow, { collide: false }); box(x - 0.12, x + 0.12, 0, TH, z1 - 0.2, z1, mat.yellow, { collide: false }); };
  for (let z = -51; z <= 21; z += 12) { bulkZ(BX0 + 0.2, -30.2, z); bulkZ(56.2, BX1 - 0.2, z); }
  for (let x = -24; x <= 52; x += 12) { bulkX(BZ0 + 0.2, -58.2, x); bulkX(25.2, BZ1 - 0.2, x); }
  crate(-34.1, -20, 0, 1.2); crate(-34.1, 10, 0, 1.2); crate(-34.1, 11.3, 0, 1.2); crate(-34.1, 10.6, 1.2, 1.0);
  crate(25, -62.1, 0, 1.2); crate(60.1, -30, 0, 1.2); crate(60.1, 15, 0, 1.2); crate(60.1, 15, 1.2, 1.0); crate(-12, 29.1, 0, 1.2); crate(40, 29.1, 0, 1.2);
  sign('SERVICE TUNNEL', 'LOOP - WEST', BX0 + 0.25, 2.4, 0, Math.PI / 2, 3, 0.7); sign('SERVICE TUNNEL', 'LOOP - NORTH', -19, 2.4, BZ0 + 0.25, 0, 3, 0.7);
  sign('SERVICE TUNNEL', 'LOOP - EAST', BX1 - 0.25, 2.4, -38, -Math.PI / 2, 3, 0.7); sign('SERVICE TUNNEL', 'LOOP - SOUTH', 10.5, 2.4, BZ1 - 0.25, Math.PI, 3, 0.7);
  sign('SERVICE TUNNEL', '', 10.5, 4.2, 24.75, Math.PI, 2.4, 0.5); sign('SERVICE TUNNEL', '', -29.75, 4.2, 0, Math.PI / 2, 2.4, 0.5);

  // ---- ceiling light strips (they turn red in an alarm) ----
  for (let x = -26; x <= 26; x += 8) for (let z = -21; z <= 21; z += 7) lampStrip(x, z, 3);
  // red beacons over the big doors (light up in an alarm)
  for (const d of doors) box(d.x - 0.15, d.x + 0.15, 3.6, 3.9, d.z - 0.15, d.z + 0.15, mat.redLamp, { collide: false });
  box(29.4, 29.8, 5.75, 6.05, 15.1, 15.5, mat.redLamp, { collide: false }); box(29.4, 29.8, 5.75, 6.05, 22.5, 22.9, mat.redLamp, { collide: false });

  buildSigns();   // every sign -> one atlas texture, one bucket

  // =================== build the merged meshes ===================
  let tris = 0;
  for (const [m, geos] of buckets) {
    const merged = mergeGeometries(geos.map(g => g.index ? g : g), false); geos.forEach(g => g.dispose());
    const mesh = new THREE.Mesh(merged, m); mesh.matrixAutoUpdate = false; group.add(mesh);
    if (m === mat.ceil) mesh.name = 'ceiling';
    tris += (merged.index ? merged.index.count : merged.attributes.position.count) / 3;
  }
  // the shutter (moves, so it's its own mesh)
  const shutter = new THREE.Mesh(new THREE.BoxGeometry(0.25, 5.4, 6), new THREE.MeshLambertMaterial({ map: T.shutter })); shutter.position.set(30, 2.7, 19); group.add(shutter);
  const shutterBand = new THREE.Mesh(new THREE.BoxGeometry(0.27, 0.25, 6), mat.hazard); shutterBand.position.y = -2.58; shutter.add(shutterBand);
  // outside light beyond the shutter (you see daylight when it opens)
  const outside = new THREE.Mesh(new THREE.PlaneGeometry(6, 5.4), new THREE.MeshBasicMaterial({ color: '#bfe6ff' })); outside.position.set(30.5, 2.7, 19); outside.rotation.y = -Math.PI / 2; group.add(outside);
  tris += 12 * 2 + 2;
  // alarm light: a red hemisphere light that pulses (off normally)
  const alarmLight = new THREE.HemisphereLight('#ff2a2a', '#400000', 0); group.add(alarmLight);

  // =================== colliders: one composite collider with a spatial grid ===================
  const world = boxes.map(b => ({ min: b.min.clone().add(O), max: b.max.clone().add(O), nav: b.nav, los: b.los, surf: b.surf || 'metal', hang: !!b.hang }));
  let shutterOpen = false, shutterY = 2.7;
  const shutterBox = { min: V(29.85, 0, 16).add(O), max: V(30.15, 5.4, 22).add(O) };
  const CELL = 4, MARGIN = 1.6, gx0 = O.x + BX0 - 2, gz0 = O.z + BZ0 - 2, NX = Math.ceil((BX1 - BX0 + 4) / CELL), NZ = Math.ceil((BZ1 - BZ0 + 4) / CELL);
  const grid = Array.from({ length: NX * NZ }, () => []);
  const bigOnes = [];
  world.forEach((b, i) => {
    if ((b.max.x - b.min.x) * (b.max.z - b.min.z) > 5000) { bigOnes.push(i); return; }   // the floor: checked everywhere (ceilings go in the grid)
    const ix0 = Math.max(0, Math.floor((b.min.x - MARGIN - gx0) / CELL)), ix1 = Math.min(NX - 1, Math.floor((b.max.x + MARGIN - gx0) / CELL));
    const iz0 = Math.max(0, Math.floor((b.min.z - MARGIN - gz0) / CELL)), iz1 = Math.min(NZ - 1, Math.floor((b.max.z + MARGIN - gz0) / CELL));
    for (let ix = ix0; ix <= ix1; ix++) for (let iz = iz0; iz <= iz1; iz++) grid[ix + iz * NX].push(i);
  });
  const composite = { facility: true, surf(p) {
    // far from the facility: answer with its bounding box (never matters for touching)
    if (p.x < O.x + BX0 - 1 || p.x > O.x + BX1 + 1 || p.z < O.z + BZ0 - 1 || p.z > O.z + BZ1 + 1) return boxSurf(V(O.x + BX0, -1, O.z + BZ0), V(O.x + BX1, TOP, O.z + BZ1), p);
    const ix = clamp(Math.floor((p.x - gx0) / CELL), 0, NX - 1), iz = clamp(Math.floor((p.z - gz0) / CELL), 0, NZ - 1);
    let best = null, bd = Infinity;
    let bb = null;   // the winning box: its surf / hang tags go out with the answer
    const test = (b) => { const s = boxSurf(b.min, b.max, p); const d = s.inside ? -p.distanceTo(s.point) : p.distanceTo(s.point); if (d < bd) { bd = d; best = s; bb = b; } };
    for (const i of bigOnes) test(world[i]);
    for (const i of grid[ix + iz * NX]) test(world[i]);
    if (!shutterOpen || shutterY < 4.6) test(shutterBox);
    best.surfType = bb.surf || 'metal'; best.hang = !!bb.hang;
    return best;
  } };
  const colliders = [composite];

  // =================== nav graph (floor walkers ~1 m wide) ===================
  const navBoxes = world.filter(b => b.nav);
  // (nav boxes sorted into the same 4 m grid, so clearance checks only look at nearby boxes)
  const navGrid = Array.from({ length: NX * NZ }, () => []);
  navBoxes.forEach(b => { const ix0 = Math.max(0, Math.floor((b.min.x - 1 - gx0) / CELL)), ix1 = Math.min(NX - 1, Math.floor((b.max.x + 1 - gx0) / CELL));
    const iz0 = Math.max(0, Math.floor((b.min.z - 1 - gz0) / CELL)), iz1 = Math.min(NZ - 1, Math.floor((b.max.z + 1 - gz0) / CELL));
    for (let ix = ix0; ix <= ix1; ix++) for (let iz = iz0; iz <= iz1; iz++) navGrid[ix + iz * NX].push(b); });
  const blocked = (x, z, pad) => { const ix = Math.floor((x - gx0) / CELL), iz = Math.floor((z - gz0) / CELL); if (ix < 0 || iz < 0 || ix >= NX || iz >= NZ) return true;
    for (const b of navGrid[ix + iz * NX]) if (x > b.min.x - pad && x < b.max.x + pad && z > b.min.z - pad && z < b.max.z + pad) return true; return false; };
  const segClear = (a, b, pad = 0.45) => { const L = Math.hypot(b.x - a.x, b.z - a.z); const n = Math.max(1, Math.ceil(L / 0.25)); for (let i = 0; i <= n; i++) { const u = i / n; if (blocked(a.x + (b.x - a.x) * u, a.z + (b.z - a.z) * u, pad)) return false; } return true; };
  const nodes = [];
  const SP = 3.0;
  for (let x = -28.5 - 2 * SP; x <= BX1 - 0.5; x += SP) for (let z = -23.5 - 13 * SP; z <= BZ1 - 0.5; z += SP)   // (same 3 m lattice as the old core, extended)
    { if (x > 30 && x < 56 && z > 6 && z < 25) continue;   // the outside yard behind the exit shutter is not walkable
      const w = V(x, 0, z).add(O); if (!blocked(w.x, w.z, 0.55)) nodes.push(w); }
  for (const d of doors) { const w = d.clone().add(O); if (!blocked(w.x, w.z, 0.3)) nodes.push(w); }
  // a couple of extra nodes in tight rooms (cells, behind the dock)
  for (const [x, z] of [[-25, -22.2], [-25, -16.2], [-25, -10.2], [-25, 18], [-26.5, 12], [-23, 21], [28, 19], [22, 19], [-24.5, 0]]) { const w = V(x, 0, z).add(O); if (!blocked(w.x, w.z, 0.5)) nodes.push(w); }
  // drop near-duplicates
  for (let i = nodes.length - 1; i >= 0; i--) for (let j = 0; j < i; j++) if (nodes[i].distanceTo(nodes[j]) < 1.0) { nodes.splice(i, 1); break; }
  const links = nodes.map(() => []);
  for (let i = 0; i < nodes.length; i++) for (let j = i + 1; j < nodes.length; j++) {
    const d = nodes[i].distanceTo(nodes[j]); if (d > 5.0) continue;
    if (segClear(nodes[i], nodes[j])) { links[i].push(j); links[j].push(i); }
  }
  // remove islands that don't connect to the main graph (e.g. a node boxed in by props)
  { const seen = new Array(nodes.length).fill(-1); let bestC = -1, bestN = 0, c = 0;
    for (let s = 0; s < nodes.length; s++) { if (seen[s] >= 0) continue; const st = [s]; seen[s] = c; let n = 0; while (st.length) { const k = st.pop(); n++; for (const j of links[k]) if (seen[j] < 0) { seen[j] = c; st.push(j); } } if (n > bestN) { bestN = n; bestC = c; } c++; }
    const keep = nodes.map((_, i) => seen[i] === bestC); const remap = []; let k = 0; keep.forEach((v, i) => { remap[i] = v ? k++ : -1; });
    const nn = [], nl = []; nodes.forEach((p, i) => { if (keep[i]) { nn.push(p); nl.push(links[i].filter(j => keep[j]).map(j => remap[j])); } });
    nodes.length = 0; nodes.push(...nn); links.length = 0; links.push(...nl); }
  const nearest = (p) => { let bi = 0, bd = Infinity; for (let i = 0; i < nodes.length; i++) { const d = (nodes[i].x - p.x) ** 2 + (nodes[i].z - p.z) ** 2; if (d < bd) { bd = d; bi = i; } } return bi; };
  // nearest node you can actually walk straight to (falls back to plain nearest)
  // (keeps the 8 closest in a small fixed array: no sort / no allocations, it runs every repath for every walker)
  const _ord = new Int32Array(8), _ordD = new Float64Array(8);
  const nearestReachable = (p) => { let k = 0;
    for (let i = 0; i < nodes.length; i++) { const d = (nodes[i].x - p.x) ** 2 + (nodes[i].z - p.z) ** 2; if (k === 8 && d >= _ordD[7]) continue;
      let j = k < 8 ? k++ : 7; while (j > 0 && _ordD[j - 1] > d) { _ordD[j] = _ordD[j - 1]; _ord[j] = _ord[j - 1]; j--; } _ordD[j] = d; _ord[j] = i; }
    for (let j = 0; j < k; j++) if (segClear(p, nodes[_ord[j]], 0.3)) return _ord[j]; return _ord[0]; };
  function astar(s, t) {
    if (s === t) return [s];
    const g = new Float64Array(nodes.length).fill(Infinity), f = new Float64Array(nodes.length).fill(Infinity), from = new Int32Array(nodes.length).fill(-1), closed = new Uint8Array(nodes.length);
    g[s] = 0; f[s] = nodes[s].distanceTo(nodes[t]); const open = [s];
    while (open.length) {
      let bi = 0; for (let i = 1; i < open.length; i++) if (f[open[i]] < f[open[bi]]) bi = i; const cur = open.splice(bi, 1)[0];
      if (cur === t) { const out = [t]; let k = t; while (from[k] >= 0) { k = from[k]; out.push(k); } return out.reverse(); }
      closed[cur] = 1;
      for (const nb of links[cur]) { if (closed[nb]) continue; const ng = g[cur] + nodes[cur].distanceTo(nodes[nb]); if (ng < g[nb]) { if (g[nb] === Infinity) open.push(nb); g[nb] = ng; f[nb] = ng + nodes[nb].distanceTo(nodes[t]); from[nb] = cur; } }
    }
    return null;
  }
  const losBoxes = world.filter(b => b.los);
  // sight blockers in the same 4 m grid (1 m margin), so a sight check only tests boxes near the line
  const losGrid = Array.from({ length: NX * NZ }, () => []);
  losBoxes.forEach((b, i) => { const ix0 = Math.max(0, Math.floor((b.min.x - 1 - gx0) / CELL)), ix1 = Math.min(NX - 1, Math.floor((b.max.x + 1 - gx0) / CELL));
    const iz0 = Math.max(0, Math.floor((b.min.z - 1 - gz0) / CELL)), iz1 = Math.min(NZ - 1, Math.floor((b.max.z + 1 - gz0) / CELL));
    for (let ix = ix0; ix <= ix1; ix++) for (let iz = iz0; iz <= iz1; iz++) losGrid[ix + iz * NX].push(i); });
  const losStamp = new Uint32Array(losBoxes.length); let losRun = 0;
  const _A = V(), _B = V(), _D = V();
  function rayBox(a, d, len, b) {   // slab test: does the segment a + d*t (t in 0..len) hit box b?
    let t0 = 0, t1 = len;
    for (const ax of ['x', 'y', 'z']) { if (Math.abs(d[ax]) < 1e-9) { if (a[ax] < b.min[ax] || a[ax] > b.max[ax]) return false; continue; }
      let ta = (b.min[ax] - a[ax]) / d[ax], tb = (b.max[ax] - a[ax]) / d[ax]; if (ta > tb) [ta, tb] = [tb, ta]; t0 = Math.max(t0, ta); t1 = Math.min(t1, tb); if (t0 > t1) return false; }
    return true;
  }
  const nav = {
    nodes, links, nearest,
    path(from, to) {
      const s = nearestReachable(from), t = nearestReachable(to); const ids = astar(s, t);
      if (!ids) return [to.clone()];
      const pts = ids.map(i => nodes[i].clone());
      // skip the first node if we can already walk to the second one
      if (pts.length > 1 && segClear(from, pts[1], 0.4)) pts.shift();
      const end = V(to.x, 0, to.z); if (!pts.length || segClear(pts[pts.length - 1], end, 0.3)) pts.push(end);
      return pts;
    },
    randomNode() { return nodes[(Math.random() * nodes.length) | 0].clone(); },
    farthestFrom(p, list = nodes) { let best = list[0], bd = -1; for (const q of list) { const d = q.distanceTo(p); if (d > bd) { bd = d; best = q; } } return best.clone(); },
    lineOfSight(a, b) {
      const A = _A.set(a.x, 1.2, a.z), B = _B.set(b.x, 1.2, b.z); const d = _D.subVectors(B, A); const len = d.length(); if (len < 1e-4) return true; d.divideScalar(len);
      losRun++; const n = Math.max(1, Math.ceil(len / 2));   // sample every <= 2 m: with the 1 m margin no crossed box is missed
      for (let s = 0; s <= n; s++) { const u = len * s / n; const ix = clamp(Math.floor((A.x + d.x * u - gx0) / CELL), 0, NX - 1), iz = clamp(Math.floor((A.z + d.z * u - gz0) / CELL), 0, NZ - 1);
        for (const k of losGrid[ix + iz * NX]) { if (losStamp[k] === losRun) continue; losStamp[k] = losRun; if (rayBox(A, d, len, losBoxes[k])) return false; } }
      if (!shutterOpen && rayBox(A, d, len, shutterBox)) return false;
      return true;
    },
    walkable(a, b) { return segClear(a, b, 0.45); },
  };

  // =================== spots ===================
  const L = (x, y, z) => V(x, y, z).add(O);
  const spawn = L(-1, 0, 5.5), spawnYaw = 0;
  const keycardSpots = [
    L(-12.6, 3.0, 7.8),     // on top of the hall crate stairs
    L(-1, 3.8, -13.0),      // on the north catwalk
    L(10.9, 3.8, 2.0),      // on the east catwalk
    L(-1, 1.5, -7.0),       // on the test rig platform
    L(-6.5, 0.45, 9.3),     // inside the hall vent duct
    L(17, 5.5, -21),        // on top of the stacked containers
    L(28.3, 5.5, -12),      // on the far container stack
    L(-27.4, 0.45, 7.0),    // in the crawl vent into the regen lab
    L(-23.1, 4.4, 24.0),    // top shelf in the regen lab (moved off a crate)
    L(-6, 3.5, 23.0),       // on the maintenance mezzanine
    L(-7.5, 4.5, -23.0),    // top of a storage rack
    L(17.2, 4.5, 23.5),     // top of a loading bay rack
    L(-28.4, 1.2, -4.5),    // on the observation desk
    // --- new wings ---
    L(-28.4, 7.6, -40),     // atrium west gallery
    L(-12, 7.6, -33),       // atrium bridge
    L(-12, 4.4, -49),       // on top of the atrium display tank
    L(-8, 4.1, -42),        // atrium mid catwalk
    L(4.4, 7.6, -56.4),     // atrium gallery, far corner
    L(20, 5.85, -45),       // top of a cold storage shelf
    L(28.1, 3.1, -39.8),     // middle shelf at the end of a cold storage row
    L(8.2, 0.5, -56.6),     // cold storage dead end
    L(14.6, 8.35, -51.8),      // on an office desk (level 2)
    L(27.5, 7.6, -27.5),    // upper offices, far corner
    L(17, 9.8, -57.3),      // on top of the office server racks
    L(31.4, 7.6, -40),      // pump room high catwalk
    L(38.5, 6.75, -44),     // on top of a pump tank
    L(54.7, 3.85, -30),     // pump room east catwalk
    L(34.2, 1.85, 0),       // on a pump housing
    L(-33.5, 0.5, -61),     // service tunnel, north-west corner
    L(59, 0.5, 28),         // service tunnel, south-east corner
    L(-34.1, 1.4, -20),     // on a crate in the west tunnel
  ];
  const monsterSpawns = [L(-25, 0, -22.2), L(-25, 0, -16.2), L(-25, 0, -10.2)];
  const npcSpawns = [
    L(-6, 0, -29), L(-22, 0, -53), L(12, 0, -32.5), L(25, 0, -47.5), L(16, 0, -56.6), L(34, 0, -14), L(50, 0, -30), L(40, 0, -55), L(43, 0, -2),   // new wings first
    L(-31.5, 0, -20), L(10, 0, 26.6), L(58.5, 0, -5), L(30, 0, -59.5), L(-31.5, 0, 15),
    L(-6, 0, 4), L(5, 0, -10), L(8, 0, 6), L(-10, 0, -20), L(6, 0, -19), L(22, 0, -17), L(22, 0, 2), L(14, 0, -7), L(-6, 0, 17), L(5, 0, 21), L(-17, 0, -3), L(-17, 0, 18), L(22, 0, 18), L(-25, 0, 2)];
  const hidingSpots = [L(21.9, 0, -9.5), L(26.2, 0, -14.5), L(16.5, 0, -12), L(29, 0, 2.5), L(-12.8, 0, -20.5), L(10.5, 0, -16.5), L(-13, 0, 23.5), L(9, 0, 23), L(20.5, 0, 16.5), L(-27, 0, 15), L(-28, 0, 0.5), L(16.2, 0, 10.6),
    L(-28, 0, -56), L(4, 0, -28.5), L(8.3, 0, -57), L(28, 0, -42.5), L(52, 0, -56.3), L(47.5, 0, -10.4), L(33.8, 0, -44),   // new wings
    L(-33, 0, -61.5), L(59, 0, -61.5), L(59, 0, 28.3), L(-33, 0, 28.3)];

  // =================== state: exit shutter + alarm ===================
  let alarm = false;
  const exit = {
    pos: L(28.6, 0, 19), radius: 1.9,
    setOpen(v) { shutterOpen = !!v; },
    isOpen() { return shutterOpen && shutterY > 4.6; },
    setCards(n) { cardLights.forEach((m, i) => m.material.color.set(i < n ? '#20ff60' : '#801010')); },
  };
  function setAlarm(on) { alarm = !!on; if (!alarm) { mat.strip.color.set('#f4f8ff'); mat.redLamp.color.set('#5a0a0c'); alarmLight.intensity = 0; } }
  function update(dt, t) {
    const target = shutterOpen ? 8.0 : 2.7; shutterY += clamp(target - shutterY, -dt * 1.6, dt * 1.6); shutter.position.y = shutterY;
    if (alarm) { const k = 0.5 + 0.5 * Math.sin(t * Math.PI * 2 * 1.0); mat.strip.color.setRGB(1, 0.15 + 0.15 * k, 0.12 + 0.1 * k); mat.redLamp.color.setRGB(0.4 + 0.6 * k, 0.02, 0.02); alarmLight.intensity = 0.25 + 0.45 * k; }
  }

  return { group, colliders, spawn, spawnYaw, keycardSpots, exit, monsterSpawns, npcSpawns, hidingSpots, nav, setAlarm, update, stats: { tris, drawCalls: buckets.size + 3 + cardLights.length, signs: signs.length }, boxes: world, origin: O };
}
