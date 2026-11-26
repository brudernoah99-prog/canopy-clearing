// Canopy Clearing - Facility 7: an arm-movement VR sandbox (WebXR + three.js).
// You have no legs: push your hands against the floor, walls and crates to move, fling yourself to jump.
// Sandbox: grab your other arm (GRIP) and yank to rip it off, regrow it in the green REGEN POD,
// smack the TEST DUMMIES apart, and press the red button to BECOME THE MONSTER.
import * as THREE from 'three';
import { VRButton } from './lib/VRButton.js';
import { makeMonster } from './monster.js';
import { initGore } from './gore.js';
import { createVoice } from './talk.js';
import { makeGorilla, twoBoneIK } from './gorilla.js';
import { Reflector } from 'three/addons/objects/Reflector.js';
import { makeCyberArm } from './cyber.js';

// ---------------- tuning ----------------
const T = {
  handRadius: 0.07,     // size of a hand's collider (m)
  touchSlack: 0.012,    // how close to a surface still counts as touching
  releaseSlack: 0.035,  // how far a hand must leave a surface before it lets go
  gravity: 9.8,
  jumpMultiplier: 1.15, // how much a fling is boosted when you let go
  maxJumpSpeed: 6.5,
  velocityFrames: 6,    // frames averaged to work out your fling speed
  headRadius: 0.22,
  maxArmReach: 1.1,     // a hand stuck further than this from your head lets go
  snapTurn: Math.PI / 4,
  ripPull: 0.26,        // how far (m) you have to yank a grabbed arm before it tears off
  punchSpeed: 1.8,      // hand speed (m/s) that counts as a punch (dummies wobble and bleed)
  monsterScale: 1.35,   // how much bigger you are as the monster
};

// ---------------- renderer, scene ----------------
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.setSize(innerWidth, innerHeight);
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.shadowMap.enabled = true;
renderer.xr.enabled = true;
renderer.localClippingEnabled = true;   // used to cut bodies in half
renderer.xr.setReferenceSpaceType('local-floor');
document.body.appendChild(renderer.domElement);
document.body.appendChild(VRButton.createButton(renderer));
// When installed as a Quest app, the flat page isn't shown at all: go straight into VR on launch.
window.__xrlog = [];
const xrlog = (m) => { window.__xrlog.push(((performance.now() / 1000) | 0) + 's ' + m); };
let autoTries = 0, autoBusy = false;
async function autoEnterVR(reason = '') {
  if (!navigator.xr || renderer.xr.isPresenting || autoBusy) return;
  autoBusy = true; autoTries++;
  try {
    const ok = await navigator.xr.isSessionSupported('immersive-vr');
    if (!ok) { xrlog(`try ${autoTries} ${reason}: not supported yet`); return; }
    const session = await navigator.xr.requestSession('immersive-vr', { optionalFeatures: ['local-floor', 'bounded-floor', 'hand-tracking'] });
    await renderer.xr.setSession(session); xrlog(`try ${autoTries} ${reason}: VR started`);
  } catch (e) { xrlog(`try ${autoTries} ${reason}: ${e.name} ${e.message}`); }
  finally { autoBusy = false; }
}
if (navigator.xr) navigator.xr.addEventListener('sessiongranted', () => autoEnterVR('granted'));
if (matchMedia('(display-mode: standalone)').matches) {
  autoEnterVR('load');
  const retry = setInterval(() => { if (renderer.xr.isPresenting || autoTries > 30) clearInterval(retry); else autoEnterVR('retry'); }, 1000);
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') autoEnterVR('visible'); });
}

const scene = new THREE.Scene();
scene.background = new THREE.Color('#15181d');
scene.add(new THREE.HemisphereLight('#e6eeff', '#3b3f47', 1.25));
const sun = new THREE.DirectionalLight('#ffffff', 1.7); sun.position.set(5, 20, 6); sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048); sun.shadow.bias = -0.0005; sun.shadow.normalBias = 0.03; Object.assign(sun.shadow.camera, { left: -16, right: 16, top: 16, bottom: -16, near: 1, far: 40 }); scene.add(sun);

// the player rig: XR moves the camera and controllers inside it, physics moves the rig
const rig = new THREE.Group(); scene.add(rig);
const camera = new THREE.PerspectiveCamera(75, innerWidth / innerHeight, 0.03, 200); rig.add(camera);
camera.position.set(0, 1.4, 0);
addEventListener('resize', () => { camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix(); renderer.setSize(innerWidth, innerHeight); });

// ---------------- colliders ----------------
// every collider answers: closest point on its surface to p, and the outward normal there
const colliders = [];
const V = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z);
const clamp = THREE.MathUtils.clamp;
const sstep = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
const easeOutBack = (x, c = 1.4) => 1 + (c + 1) * Math.pow(x - 1, 3) + c * Math.pow(x - 1, 2);
function groundCol() { return { surf(p) { return { point: V(p.x, 0, p.z), normal: V(0, 1, 0), inside: p.y < 0 }; } }; }
function boxCol(min, max) {
  return { surf(p) {
    const inside = p.x > min.x && p.x < max.x && p.y > min.y && p.y < max.y && p.z > min.z && p.z < max.z;
    if (!inside) { const c = V(clamp(p.x, min.x, max.x), clamp(p.y, min.y, max.y), clamp(p.z, min.z, max.z)); const n = p.clone().sub(c); const l = n.length(); return { point: c, normal: l > 1e-6 ? n.divideScalar(l) : V(0, 1, 0), inside: false }; }
    const d = [p.x - min.x, max.x - p.x, p.y - min.y, max.y - p.y, p.z - min.z, max.z - p.z]; const i = d.indexOf(Math.min(...d));
    const pt = p.clone(), n = V(); ['x', 'x', 'y', 'y', 'z', 'z'].forEach((a, k) => { if (k === i) { pt[a] = k % 2 ? max[a] : min[a]; n[a] = k % 2 ? 1 : -1; } });
    return { point: pt, normal: n, inside: true };
  } };
}
function cylCol(cx, cz, R, y0, y1) {
  return { surf(p) {
    const dx = p.x - cx, dz = p.z - cz, d = Math.hypot(dx, dz); const yIn = p.y > y0 && p.y < y1;
    const nx = d > 1e-6 ? dx / d : 1, nz = d > 1e-6 ? dz / d : 0;
    if (yIn && d >= R) return { point: V(cx + nx * R, p.y, cz + nz * R), normal: V(nx, 0, nz), inside: false };
    if (yIn) { // inside: out through the side or the nearest cap
      const side = R - d, top = y1 - p.y, bot = p.y - y0; const m = Math.min(side, top, bot);
      if (m === top) return { point: V(p.x, y1, p.z), normal: V(0, 1, 0), inside: true };
      if (m === bot) return { point: V(p.x, y0, p.z), normal: V(0, -1, 0), inside: true };
      return { point: V(cx + nx * R, p.y, cz + nz * R), normal: V(nx, 0, nz), inside: true };
    }
    const y = p.y >= y1 ? y1 : y0; const rr = Math.min(d, R); const pt = V(cx + nx * rr, y, cz + nz * rr);
    if (d <= R) return { point: pt, normal: V(0, p.y >= y1 ? 1 : -1, 0), inside: false };
    const n = p.clone().sub(pt).normalize(); return { point: pt, normal: n, inside: false };
  } };
}
function contact(p, r) {
  let best = null;
  const list = (p.x > 100 && facColliders.length) ? facColliders : colliders;   // the big facility sits far away at x = 200
  for (const c of list) {
    const s = c.surf(p); const dist = s.inside ? -p.distanceTo(s.point) : p.distanceTo(s.point);
    if (!best || dist < best.dist) best = { dist, point: s.point, normal: s.normal };
  }
  best.rest = best.point.clone().addScaledVector(best.normal, r);
  return best;
}

// ---------------- the map (original): Facility 7, a test hall ----------------
const canvasTex = (w, h, draw, rx = 1, ry = 1) => { const c = document.createElement('canvas'); c.width = w; c.height = h; draw(c.getContext('2d'), w, h);
  const t = new THREE.CanvasTexture(c); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(rx, ry); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4; return t; };
const noise = (g, w, h, n, cols, sz = 2) => { for (let i = 0; i < n; i++) { g.fillStyle = cols[i % cols.length]; g.fillRect(Math.random() * w, Math.random() * h, sz, sz); } };
const floorTex = canvasTex(256, 256, (g, w, h) => { g.fillStyle = '#6a6e74'; g.fillRect(0, 0, w, h); noise(g, w, h, 2500, ['#737780', '#62666c', '#5c6066', '#7b7f86']);
  g.strokeStyle = '#4c4f54'; g.lineWidth = 3; g.strokeRect(1, 1, w - 2, h - 2); g.fillStyle = 'rgba(40,30,20,0.18)'; g.beginPath(); g.ellipse(170, 90, 40, 22, 0.4, 0, 7); g.fill(); }, 14, 13);
const wallTex = canvasTex(256, 512, (g, w, h) => { g.fillStyle = '#8b929a'; g.fillRect(0, 0, w, h); noise(g, w, h, 1800, ['#949ba3', '#828990']);
  g.fillStyle = '#5d636a'; g.fillRect(0, 0, 4, h); g.fillRect(0, 250, w, 4); g.fillStyle = '#4b5056'; g.fillRect(0, 440, w, 72); g.fillStyle = '#d9b02a'; g.fillRect(0, 432, w, 8);
  g.fillStyle = '#6e747b'; for (const y of [30, 280]) for (const x of [20, 230]) { g.beginPath(); g.arc(x, y, 4, 0, 7); g.fill(); } }, 14, 1);
const hazardTex = canvasTex(128, 32, (g, w, h) => { g.fillStyle = '#e0b31c'; g.fillRect(0, 0, w, h); g.fillStyle = '#1b1b1b'; for (let x = -32; x < w + 32; x += 32) { g.beginPath(); g.moveTo(x, h); g.lineTo(x + 16, h); g.lineTo(x + 32, 0); g.lineTo(x + 16, 0); g.fill(); } }, 1, 1);
const crateTex = canvasTex(128, 128, (g, w, h) => { g.fillStyle = '#7a6a52'; g.fillRect(0, 0, w, h); noise(g, w, h, 600, ['#86755b', '#6e5f49']); g.strokeStyle = '#4f4434'; g.lineWidth = 8; g.strokeRect(4, 4, w - 8, h - 8); g.beginPath(); g.moveTo(8, 8); g.lineTo(w - 8, h - 8); g.stroke(); });
const containerTex = (col) => canvasTex(128, 128, (g, w, h) => { g.fillStyle = col; g.fillRect(0, 0, w, h); for (let x = 0; x < w; x += 16) { g.fillStyle = 'rgba(0,0,0,0.22)'; g.fillRect(x, 0, 5, h); g.fillStyle = 'rgba(255,255,255,0.08)'; g.fillRect(x + 6, 0, 3, h); } noise(g, w, h, 300, ['rgba(60,30,10,0.3)']); }, 3, 1);
const mat = (color, o = {}) => new THREE.MeshStandardMaterial({ color, roughness: 0.85, ...o });
const metal = mat('#7d848c', { metalness: 0.55, roughness: 0.45 });
const darkMetal = mat('#3e4349', { metalness: 0.6, roughness: 0.5 });
const add = (geo, m, x, y, z, shadow = true) => { const o = new THREE.Mesh(geo, m); o.position.set(x, y, z); o.castShadow = shadow; o.receiveShadow = true; scene.add(o); return o; };
const box = (x, y, z, w, h, d, m, collide = true, shadow = true) => { const o = add(new THREE.BoxGeometry(w, h, d), m, x, y, z, shadow); if (collide) colliders.push(boxCol(V(x - w / 2, y - h / 2, z - d / 2), V(x + w / 2, y + h / 2, z + d / 2))); return o; };
const sign = (text, w, h, x, y, z, ry = 0, { bg = '#1d2126', fg = '#f2c41c', sub = '' } = {}) => {
  const t = canvasTex(512, Math.round(512 * h / w), (g, W, H) => { g.fillStyle = bg; g.fillRect(0, 0, W, H); g.strokeStyle = fg; g.lineWidth = 10; g.strokeRect(8, 8, W - 16, H - 16);
    g.fillStyle = fg; g.textAlign = 'center'; g.textBaseline = 'middle'; g.font = `900 ${Math.round(H * (sub ? 0.36 : 0.5))}px Arial`; g.fillText(text, W / 2, H * (sub ? 0.38 : 0.52), W - 40);
    if (sub) { g.fillStyle = '#e8e8e8'; g.font = `700 ${Math.round(H * 0.16)}px Arial`; g.fillText(sub, W / 2, H * 0.74, W - 40); } });
  const m = add(new THREE.PlaneGeometry(w, h), new THREE.MeshStandardMaterial({ map: t, roughness: 0.6, emissive: '#ffffff', emissiveMap: t, emissiveIntensity: 0.25 }), x, y, z, false); m.rotation.y = ry; return m; };

// hall: x -14..14, z -14..12, ceiling at 7 m
const floor = add(new THREE.PlaneGeometry(28, 26), new THREE.MeshStandardMaterial({ map: floorTex, roughness: 0.8 }), 0, 0, -1, false); floor.rotation.x = -Math.PI / 2;
colliders.push(groundCol());
const wallMat = new THREE.MeshStandardMaterial({ map: wallTex, roughness: 0.8 });
const wallMatZ = wallMat.clone(); wallMatZ.map = wallTex.clone(); wallMatZ.map.repeat.set(13, 1); wallMatZ.map.needsUpdate = true;
box(-14.25, 3.5, -1, 0.5, 7, 26, wallMatZ, true, false); box(14.25, 3.5, -1, 0.5, 7, 26, wallMatZ, true, false);
box(0, 3.5, -14.25, 29, 7, 0.5, wallMat, true, false); box(0, 3.5, 12.25, 29, 7, 0.5, wallMat, true, false);
box(0, 7.25, -1, 29, 0.5, 27, mat('#5a6068'), true, false);
// ceiling light strips + beams
const lampMat = new THREE.MeshStandardMaterial({ color: '#ffffff', emissive: '#eef4ff', emissiveIntensity: 2.2 });
for (const x of [-8, 0, 8]) for (const z of [-10, -4, 2, 8]) box(x, 6.93, z, 2.6, 0.08, 0.32, lampMat, false, false);
for (const z of [-7, -1, 5]) box(0, 6.75, z, 28, 0.35, 0.25, darkMetal, false, false);
// pillars
for (const [x, z] of [[-7, -1], [7, -1], [-7, 6.5], [7, 6.5]]) { box(x, 3.5, z, 0.7, 7, 0.7, mat('#a3a9b0')); box(x, 0.3, z, 0.78, 0.6, 0.78, mat('#e0b31c', { map: hazardTex }), false); }
// back catwalk + side catwalk with railings, crate steps up to it
box(0, 3.5, -12.75, 27.5, 0.2, 2.5, metal); box(-12.75, 3.5, -3, 2.5, 0.2, 16, metal);
box(0, 4.55, -11.55, 25.4, 0.07, 0.07, mat('#e0b31c')); for (let x = -12; x <= 12; x += 2) box(x, 4.05, -11.55, 0.06, 1.0, 0.06, darkMetal, false);
box(-11.55, 4.55, -3.3, 0.07, 0.07, 15.4, mat('#e0b31c')); for (let z = -10; z <= 4; z += 2) box(-11.55, 4.05, z, 0.06, 1.0, 0.06, darkMetal, false);
const crate = new THREE.MeshStandardMaterial({ map: crateTex, roughness: 0.85 });
box(-12.6, 0.5, 9.2, 1.6, 1.0, 1.6, crate); box(-12.6, 1.0, 7.6, 1.6, 2.0, 1.6, crate); box(-12.6, 1.5, 6.0, 1.6, 3.0, 1.6, crate);
box(9.0, 0.5, 9.5, 1.0, 1.0, 1.0, crate); box(10.2, 0.5, 9.7, 1.0, 1.0, 1.0, crate); box(9.6, 1.5, 9.6, 1.0, 1.0, 1.0, crate);
// shipping containers on the right (climb them)
box(11.6, 1.3, -6, 2.6, 2.6, 6, new THREE.MeshStandardMaterial({ map: containerTex('#2d6aa3'), roughness: 0.7, metalness: 0.2 }));
box(11.6, 3.9, -7.5, 2.6, 2.6, 4.5, new THREE.MeshStandardMaterial({ map: containerTex('#b04a2e'), roughness: 0.7, metalness: 0.2 }));
// barrels
for (const [x, z] of [[12.8, 1.0], [12.0, 1.8], [12.9, 2.6]]) { add(new THREE.CylinderGeometry(0.35, 0.35, 0.95, 16), mat('#c8781f', { metalness: 0.3, roughness: 0.5 }), x, 0.475, z); colliders.push(cylCol(x, z, 0.35, 0, 0.95)); }
// monkey bars over the middle
for (let i = 0; i < 8; i++) box(-6.2 + i * 0.6, 2.45, 2.5, 0.07, 0.07, 2.2, mat('#d0d5da', { metalness: 0.7, roughness: 0.3 }));
for (const x of [-6.5, -1.6]) for (const z of [1.4, 3.6]) box(x, 1.25, z, 0.1, 2.5, 0.1, mat('#e0b31c'));
box(-4.05, 2.45, 1.4, 5.0, 0.1, 0.1, mat('#e0b31c')); box(-4.05, 2.45, 3.6, 5.0, 0.1, 0.1, mat('#e0b31c'));
// pipes along the right wall (decor)
for (const [y, c] of [[5.6, '#5c7d4a'], [6.0, '#8a3b2f']]) { const p = add(new THREE.CylinderGeometry(0.12, 0.12, 25, 12), mat(c, { metalness: 0.4 }), 13.75, y, -1, false); p.rotation.x = Math.PI / 2; }
// signs
sign('FACILITY 7', 6, 1.4, 0, 5.6, -13.99, 0, { sub: 'SUBJECT TESTING HALL' });
// the test dummy area: a hazard line and five stands
const hz = add(new THREE.PlaneGeometry(14, 0.3), new THREE.MeshStandardMaterial({ map: canvasTex(128, 32, (g, w, h) => { g.drawImage(hazardTex.image, 0, 0); }, 30, 1), roughness: 0.8 }), 0, 0.006, -3.4, false); hz.rotation.x = -Math.PI / 2;
sign('TEST DUMMIES', 3.2, 0.8, 0, 3.0, -8.2, 0, { sub: 'PUNCH THEM HARD' }); box(0, 3.0, -8.25, 3.3, 0.9, 0.05, darkMetal, false); box(-1.4, 1.3, -8.3, 0.08, 2.6, 0.08, darkMetal, false); box(1.4, 1.3, -8.3, 0.08, 2.6, 0.08, darkMetal, false);
const DUMMY_SPOTS = [-6, -3, 0, 3, 6].map(x => V(x, 0.25, -6));
for (const p of DUMMY_SPOTS) { add(new THREE.CylinderGeometry(0.5, 0.55, 0.25, 24), mat('#3c4148', { metalness: 0.5 }), p.x, 0.125, p.z); add(new THREE.TorusGeometry(0.52, 0.025, 6, 32), mat('#e0b31c'), p.x, 0.25, p.z).rotation.x = Math.PI / 2; colliders.push(cylCol(p.x, p.z, 0.55, 0, 0.25)); }

// ---------------- regen pod ----------------
const POD = V(7.5, 0, 2.5);
const podGlow = new THREE.MeshStandardMaterial({ color: '#46ff86', emissive: '#2bff6e', emissiveIntensity: 1.2, transparent: true, opacity: 0.9 });
add(new THREE.CylinderGeometry(1.0, 1.1, 0.18, 32), metal, POD.x, 0.09, POD.z); colliders.push(cylCol(POD.x, POD.z, 1.1, 0, 0.18));
const podRing = add(new THREE.TorusGeometry(0.85, 0.05, 8, 48), podGlow, POD.x, 0.2, POD.z, false); podRing.rotation.x = Math.PI / 2;
const podTop = add(new THREE.CylinderGeometry(1.0, 1.0, 0.3, 32), metal, POD.x, 3.15, POD.z); colliders.push(cylCol(POD.x, POD.z, 1.0, 3.0, 3.3));
const podRing2 = add(new THREE.TorusGeometry(0.85, 0.05, 8, 48), podGlow, POD.x, 2.98, POD.z, false); podRing2.rotation.x = Math.PI / 2;
const glass = add(new THREE.CylinderGeometry(0.95, 0.95, 2.8, 32, 1, true), new THREE.MeshStandardMaterial({ color: '#9fffd0', transparent: true, opacity: 0.13, roughness: 0.05, metalness: 0.1, side: THREE.DoubleSide, depthWrite: false }), POD.x, 1.6, POD.z, false);
for (const a of [0.6, 2.2, 3.8, 5.3]) box(POD.x + Math.cos(a) * 0.97, 1.6, POD.z + Math.sin(a) * 0.97, 0.08, 2.8, 0.08, darkMetal, false);
const podLight = new THREE.PointLight('#3dff7c', 2.5, 5, 1.6); podLight.position.set(POD.x, 1.6, POD.z); scene.add(podLight);
sign('REGEN POD', 2.2, 0.6, POD.x, 3.75, POD.z + 1.02, 0, { fg: '#46ff86', sub: 'STEP IN TO REGROW LIMBS' });
// sparkles that rise inside the pod while something regrows
const sparkGeo = new THREE.BufferGeometry(); const SPARKS = 160; const sparkPos = new Float32Array(SPARKS * 3); sparkGeo.setAttribute('position', new THREE.BufferAttribute(sparkPos, 3));
const sparkSeed = Array.from({ length: SPARKS }, () => [Math.random() * 6.28, Math.random() * 0.8, Math.random()]);
const sparks = new THREE.Points(sparkGeo, new THREE.PointsMaterial({ color: '#7dffa8', size: 0.035, transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending })); sparks.frustumCulled = false; scene.add(sparks);

// ---------------- be-the-monster button ----------------
const BTN = V(2.6, 1.0, 6.2);
box(BTN.x, 0.48, BTN.z, 0.5, 0.96, 0.5, mat('#e0b31c', { map: hazardTex }));
add(new THREE.CylinderGeometry(0.2, 0.22, 0.06, 24), darkMetal, BTN.x, 0.99, BTN.z);
const btnCap = add(new THREE.CylinderGeometry(0.15, 0.16, 0.07, 24), new THREE.MeshStandardMaterial({ color: '#d4101c', emissive: '#7a0008', emissiveIntensity: 0.8, roughness: 0.35 }), BTN.x, 1.05, BTN.z);
const btnSign = sign('BE THE MONSTER', 1.5, 0.45, BTN.x, 1.65, BTN.z, Math.atan2(-BTN.x, 8 - BTN.z), { fg: '#ff3a3a', sub: 'PRESS THE BUTTON' });
const btnLight = new THREE.PointLight('#ff2020', 1.2, 3, 2); btnLight.position.set(BTN.x, 1.4, BTN.z); scene.add(btnLight);

// ---------------- how-to board + mirror ----------------
sign('HOW TO', 1.6, 1.2, 4.75, 1.7, 8.3, -Math.PI / 2, { fg: '#f2c41c', sub: '' });
{ const t = canvasTex(512, 384, (g, W, H) => { g.fillStyle = '#1d2126'; g.fillRect(0, 0, W, H); g.fillStyle = '#f2c41c'; g.font = '900 44px Arial'; g.fillText('HOW TO', 24, 56); g.fillStyle = '#eee'; g.font = '700 27px Arial';
    ['Push the floor & walls to move', 'RIP AN ARM: grab your other arm', '   with GRIP and yank it away', 'Throw it, or grab it off the floor', 'REGROW: step into the green pod', 'Punch the dummies apart', 'Red button: become the monster'].forEach((l, i) => g.fillText(l, 24, 110 + i * 40)); });
  const b = add(new THREE.PlaneGeometry(1.6, 1.2), new THREE.MeshStandardMaterial({ map: t, emissive: '#fff', emissiveMap: t, emissiveIntensity: 0.3 }), 4.74, 1.7, 8.3, false); b.rotation.y = -Math.PI / 2; }
box(4.8, 1.7, 8.3, 0.06, 1.3, 1.7, darkMetal, true, false);
const mirror = new Reflector(new THREE.PlaneGeometry(2.4, 2.6), { textureWidth: 1024, textureHeight: 1024, color: 0xc4ccd0 });
mirror.position.set(-3.2, 1.45, 8.3); mirror.rotation.y = Math.PI / 2; scene.add(mirror);
box(-3.27, 1.45, 8.3, 0.12, 2.9, 2.7, mat('#3e4349'));

// ---------------- hands ----------------
const hands = [0, 1].map(i => ({ i, grip: renderer.xr.getControllerGrip(i), mesh: new THREE.Object3D(), stuck: null, gamepad: null, handed: null, prev: null, vel: V(), gripDown: false, holding: null, ripGrab: null }));
hands.forEach(h => { rig.add(h.grip); scene.add(h.mesh); h.grip.addEventListener('connected', e => { h.gamepad = e.data.gamepad; h.handed = e.data.handedness; }); h.grip.addEventListener('disconnected', () => { h.gamepad = null; }); });
const sideOf = (h) => h.handed === 'left' ? 'L' : h.handed === 'right' ? 'R' : (h.i === 0 ? 'L' : 'R');
const handOf = (s) => hands.find(h => sideOf(h) === s);
function pulse(h, strength, ms) { try { h.gamepad?.hapticActuators?.[0]?.pulse(Math.min(1, strength), ms); } catch (e) {} }

// ---------------- the movement ----------------
const vel = V(); const history = []; let wasTouching = false; let turnLatch = false;
const handWorld = (h) => h.grip.getWorldPosition(V());
let mode = 'gorilla';   // or 'monster'
const canPush = (h) => mode === 'monster' || me.armOn(sideOf(h));

function step(dt) {
  rig.updateMatrixWorld(true);
  let move = V(), n = 0;
  const head = camera.getWorldPosition(V());
  for (const h of hands) {
    if (!h.gamepad && !renderer.xr.isPresenting) continue;
    if (!canPush(h)) { h.stuck = null; continue; }               // no arm, no push
    const tracked = handWorld(h);
    if (h.stuck) {
      const c = contact(tracked, T.handRadius);
      const tooFar = h.stuck.distanceTo(head) > T.maxArmReach * rig.scale.x;
      const away = tracked.clone().sub(h.stuck).dot(h.normal);
      if (away > 0.004 || c.dist > T.handRadius + T.releaseSlack || tooFar) h.stuck = null;
      else { move.add(h.stuck.clone().sub(tracked)); n++; }
    } else {
      const c = contact(tracked, T.handRadius);
      if (c.dist < T.handRadius + T.touchSlack) {
        h.stuck = c.dist < T.handRadius ? c.rest : tracked.clone();
        h.normal = c.normal.clone();
        move.add(h.stuck.clone().sub(tracked)); n++;
        pulse(h, 0.25, 30);
      }
    }
  }
  if (n > 0) {
    move.divideScalar(n); rig.position.add(move);
    history.push(move.clone().divideScalar(dt)); if (history.length > T.velocityFrames) history.shift();
    vel.set(0, 0, 0); wasTouching = true;
  } else {
    if (wasTouching && history.length) {
      vel.set(0, 0, 0); history.forEach(v => vel.add(v)); vel.divideScalar(history.length).multiplyScalar(T.jumpMultiplier);
      if (vel.length() > T.maxJumpSpeed) vel.setLength(T.maxJumpSpeed);
    }
    wasTouching = false; history.length = 0;
    vel.y -= T.gravity * dt; rig.position.addScaledVector(vel, dt);
  }
  rig.updateMatrixWorld(true);
  const hp = camera.getWorldPosition(V()); const hc = contact(hp, T.headRadius);
  if (hc.dist < T.headRadius) { rig.position.add(hc.rest.clone().sub(hp)); const into = vel.dot(hc.normal); if (into < 0) vel.addScaledVector(hc.normal, -into); }
  if (rig.position.y < -30) { rig.position.set(0, 0, 8); vel.set(0, 0, 0); }
  snapTurn();
}
function snapTurn() {
  const right = hands.find(h => h.handed === 'right'); const ax = right?.gamepad?.axes?.[2] ?? 0;
  if (Math.abs(ax) < 0.3) { turnLatch = false; return; } if (turnLatch || Math.abs(ax) < 0.7) return; turnLatch = true;
  const head = camera.getWorldPosition(V()); const a = -Math.sign(ax) * T.snapTurn;
  rig.position.sub(head).applyAxisAngle(V(0, 1, 0), a).add(head); rig.rotation.y += a;
  hands.forEach(h => { if (h.stuck) h.stuck = null; });
}
function updateHands(dt) {
  rig.updateMatrixWorld(true);
  for (const h of hands) {
    const p = h.stuck ? h.stuck : handWorld(h); h.mesh.position.copy(p);
    h.grip.getWorldQuaternion(h.mesh.quaternion);
    if (h.prev) h.vel.copy(p).sub(h.prev).divideScalar(Math.max(dt, 1e-3)); h.prev = (h.prev || V()).copy(p);
  }
}

// ---------------- blood splats ----------------
const splatTex = [0, 1, 2].map(seed => { const c = document.createElement('canvas'); c.width = c.height = 256; const g = c.getContext('2d'); let s = seed * 97 + 13; const r = () => (s = (s * 16807) % 2147483647) / 2147483647;
  const blob = (x, y, rad, col) => { g.fillStyle = col; g.beginPath(); for (let k = 0; k <= 40; k++) { const a = k / 40 * Math.PI * 2, rr = rad * (0.85 + r() * 0.2); g.lineTo(x + Math.cos(a) * rr, y + Math.sin(a) * rr); } g.fill(); };
  for (let i = 0; i < 9; i++) blob(128 + (r() - 0.5) * 60, 128 + (r() - 0.5) * 60, 22 + r() * 26, i % 2 ? '#5c0006' : '#6e0009');
  const throwA = r() * 6.28;
  for (let i = 0; i < 5; i++) { const a = throwA + (r() - 0.5) * 0.9, len = 50 + r() * 60; for (let s = 0; s < 1; s += 0.08) blob(128 + Math.cos(a) * len * s, 128 + Math.sin(a) * len * s, (1 - s) * 9 + 2, '#640007'); }
  for (let i = 0; i < 40; i++) { const a = r() * 6.28, d = 55 + r() * 70; blob(128 + Math.cos(a) * d, 128 + Math.sin(a) * d, Math.max(1.5, 9 - d / 16) * (0.5 + r()), '#600006'); }
  blob(118, 118, 20, 'rgba(150,20,30,0.45)');
  // darker, drying edges and a wet centre
  g.globalCompositeOperation = 'source-atop'; const rg = g.createRadialGradient(128, 128, 20, 128, 128, 128); rg.addColorStop(0, 'rgba(170,20,30,0.25)'); rg.addColorStop(0.55, 'rgba(0,0,0,0)'); rg.addColorStop(1, 'rgba(25,0,2,0.6)'); g.fillStyle = rg; g.fillRect(0, 0, 256, 256);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t; });
const splats = [];
const splatGeo = new THREE.PlaneGeometry(1, 1);
const splatMats = splatTex.map(map => new THREE.MeshStandardMaterial({ map, transparent: true, roughness: 0.14, metalness: 0.2, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2 }));
// a splat or pool that spreads out over `grow` seconds, stays ~45 s, then shrinks away
function addSplat(pos, normal, size, grow = 0.3) {
  const m = new THREE.Mesh(splatGeo, splatMats[(Math.random() * 3) | 0]);
  m.position.copy(pos).addScaledVector(normal, 0.006 + splats.length * 0.00002); m.lookAt(pos.clone().add(normal)); m.rotateZ(Math.random() * 6.28);
  m.userData = { size, grow, t: 0, life: 40 + Math.random() * 10 }; m.scale.setScalar(size * 0.2); scene.add(m); splats.push(m);
  if (splats.length > 90) scene.remove(splats.shift());
}
function updateSplats(dt) {
  for (let i = splats.length - 1; i >= 0; i--) {
    const m = splats[i], u = m.userData; u.t += dt;
    const k = u.grow > 0 ? Math.min(1, u.t / u.grow) : 1; let sc = u.size * (0.2 + 0.8 * (1 - Math.pow(1 - k, 3)));
    if (u.t > u.life) { sc *= Math.max(0, 1 - (u.t - u.life) / 4); if (sc <= 0.001) { scene.remove(m); splats.splice(i, 1); continue; } }
    m.scale.setScalar(sc);
  }
}
const gore = await initGore(scene, addSplat, contact);
// gore level: FULL (default, 17+) or LOW; remembered on this device, ?gore=low forces it
try { gore.G.level = new URLSearchParams(location.search).get('gore') || localStorage.getItem('goreLevel') || 'full'; } catch (e) {}
const voice = createVoice(); if (/faketalk/.test(location.search)) voice.setFake(true);

// ---------------- you: the gorilla ----------------
const me = makeGorilla(scene); me.root.visible = false;
const VIEW = new URLSearchParams(location.search).get('view');   // desktop test views: rip, monster, dummies

// ---------------- ripping your own arm off, and the arms lying around ----------------
const limbs = [];   // { o, vel, spin, heldBy, offset, t, jointLocal, dirLocal }: arms and heads you can hold and throw
const bleeding = { L: -1, R: -1 };   // seconds since that shoulder was torn open (-1 = not bleeding)
const ARM_SHOULDER = { L: V(0.36, 1.04, -0.02), R: V(-0.36, 1.04, -0.02) };   // model space
const gripOf = (h) => h.gamepad?.buttons?.[1]?.value ?? 0;

// ---------------- cyber arms (chosen in the regen pod) ----------------
const cyber = { L: null, R: null };
const armPointsOf = (s) => cyber[s] ? cyber[s].points() : me.armPoints(s);
function giveCyberArm(s, type) {
  me.setCyber(s); if (cyber[s]) cyber[s].dispose();
  const [L1, L2] = me.armLen[s]; cyber[s] = makeCyberArm(scene, type, s, L1, L2, gore.audio);
}
function updateCyberArms(dt, t, inputs, show) {
  me.root.updateMatrixWorld(true); const yaw = me.root.rotation.y;
  for (const s of ['L', 'R']) { const C = cyber[s]; if (!C) continue; C.setVisible(show); if (!show) continue; const inp = inputs[s]; if (!inp || !inp.pos) continue;
    C.update({ shoulder: me.shoulderPos(s), yaw, target: inp.pos, quat: inp.quat, trigger: inp.gamepad?.buttons?.[0]?.value ?? 0, dt, t });
    if (C.type === 'chainsaw' && C.rev > 0.5 && inp.h) pulse(inp.h, 0.12 + 0.2 * C.rev, 20); }
  for (const L of limbs) if (L.cyber) L.cyber.update({ dt, t });
}
// chainsaw: while revving, whatever the bar touches comes off (a body gets cut in half); hammer: a hard hit turns a dummy into little pieces
function activeWeapons() {
  if (mode === 'monster') return (beast.weapons || []).filter(w => w.ready);
  return ['L', 'R'].map(s => cyber[s]).filter(C => C && C.attached && C.built >= 1);
}
function updateCyberWeapons(dt) {
  for (const C of activeWeapons()) { const s = C.side; const h = handOf(s);
    if (C.type === 'chainsaw' && C.rev > 0.5) {
      // the revving bar slices whatever it passes through, along the blade: standing dummies, carried ones, pieces on the floor, things you hold
      C.cutCd = Math.max(0, (C.cutCd || 0) - dt); if (C.cutCd > 0) continue;
      const pts = C.cutPoints(); if (pts.length < 2) continue;
      const bar = pts[pts.length - 1].clone().sub(pts[0]).normalize();
      const mv = C.tipVel.clone(); let nrm = bar.clone().cross(mv.lengthSq() > 0.09 ? mv.normalize() : V(0, 1, 0)); if (nrm.lengthSq() < 1e-4) nrm = bar.clone().cross(V(1, 0, 0)); nrm.normalize();
      const inBoxObj = (o, p, m) => { const lb = o.userData.lb; if (!lb) return false; const [mn, mx] = lb; const q = o.worldToLocal(p.clone());
        return q.x > mn[0] - m && q.x < mx[0] + m && q.y > mn[1] - m && q.y < mx[1] + m && q.z > mn[2] - m && q.z < mx[2] + m; };
      const push = C.tipVel.clone().setY(0); let hitAt = null;
      for (const d of allDummies()) { if (!d.a || d.grow < 1) continue;
        for (const name of ['Head', 'Arm_L', 'Arm_R', 'Body']) { const part = d.a.userData.parts[name]; if (!part) continue;
          const hit = pts.find(p => inBoxObj(part, p, name === 'Body' ? 0 : 0.03)); if (!hit) continue;
          const plane = new THREE.Plane().setFromNormalAndCoplanarPoint(nrm, hit);
          const r = gore.cutAvatar(d.a, name, plane, push);
          if (r) { hitAt = hit; if (name === 'Body') { d.a = null; if (d.loose) unpinLoose(d); else { d.respawn = 4.5; d.tornT = undefined; } } else d.tornT = d.tornT ?? 0; }
          break; }
        if (hitAt) break; }
      if (!hitAt) for (const P of gore.pieces.slice()) { const o = P.o; if (!o.userData.lb || (o.userData.size ?? 1) < 0.22 || P.t < 0.5) continue;
        const hit = pts.find(p => inBoxObj(o, p, 0.02)); if (!hit) continue;
        if (gore.cutLoose(o, new THREE.Plane().setFromNormalAndCoplanarPoint(nrm, hit))) { hitAt = hit; break; } }
      if (!hitAt) for (const L of limbs.slice()) { if (L.cyber || L.dummy || !L.o.userData.lb) continue; const o = L.o;
        const hit = pts.find(p => inBoxObj(o, p, 0.02)); if (!hit) continue;
        if (L.heldBy) L.heldBy.holding = null; limbs.splice(limbs.indexOf(L), 1);
        if (gore.cutLoose(o, new THREE.Plane().setFromNormalAndCoplanarPoint(nrm, hit), L.vel)) { hitAt = hit; break; } }
      if (hitAt) { C.cutCd = 0.3; gore.spurt(hitAt, nrm.clone().add(V(0, 0.6, 0)), 35, 3.5); gore.spurt(hitAt, nrm.clone().negate().add(V(0, 0.6, 0)), 20, 3); C.spark(hitAt, 6); gore.sfx('tear', 1.1); if (h) pulse(h, 1, 140); }
    }
    if (C.type === 'hammer') {
      const hp = C.headPoint.getWorldPosition(V()); const sp = C.tipVel.length();
      // check the whole path of the swing this frame (fast swings can skip past a dummy between frames)
      const path = [0, 0.25, 0.5, 0.75, 1].map(u => hp.clone().addScaledVector(C.tipVel, -dt * u));
      const inBox = (part, p, m) => { if (!part || !part.userData.lb) return false; const [mn, mx] = part.userData.lb; const q = part.worldToLocal(p.clone());
        return q.x > mn[0] - m && q.x < mx[0] + m && q.y > mn[1] - m && q.y < mx[1] + m && q.z > mn[2] - m && q.z < mx[2] + m; };
      for (const d of allDummies()) { if (!d.a || d.grow < 1) continue;
        if (sp > 3.0 && Object.values(d.a.userData.parts).some(part => path.some(p => inBox(part, p, 0.1)))) { smashDummy(d, C.tipVel.clone(), false, true); if (h) pulse(h, 1, 300); } }
    }
  }
}
// ---------------- the regen pod's choice: regrow with cyber? ----------------
const choice = { side: null, grp: null, buttons: [], dwell: null, dwellT: 0, cool: 0 };
function closeChoice() { if (choice.grp) scene.remove(choice.grp); choice.grp = null; choice.side = null; choice.buttons = []; choice.dwell = null; choice.dwellT = 0; }
function openChoice(s, kindSet = 'arm') {
  closeChoice(); choice.side = s; choice.kind = kindSet;
  const head = camera.getWorldPosition(V()); const f = camera.getWorldDirection(V()).setY(0); if (f.lengthSq() < 1e-4) f.set(0, 0, -1); f.normalize();
  const g = new THREE.Group(); g.position.copy(head).addScaledVector(f, 0.55).add(V(0, -0.22, 0)); g.lookAt(head.x, g.position.y, head.z); scene.add(g); choice.grp = g;
  const title = canvasTex(1024, 200, (c, W, H) => { c.fillStyle = 'rgba(10,14,18,0.9)'; c.fillRect(0, 0, W, H); c.strokeStyle = '#29c8ff'; c.lineWidth = 8; c.strokeRect(4, 4, W - 8, H - 8);
    c.fillStyle = '#7fe8ff'; c.font = '900 64px Arial'; c.textAlign = 'center'; c.fillText(kindSet === 'monster' ? 'CHOOSE YOUR MONSTER' : `REGROW YOUR ${s === 'L' ? 'LEFT' : 'RIGHT'} ARM WITH CYBER?`, W / 2, 95, W - 40);
    c.fillStyle = '#ccc'; c.font = '600 38px Arial'; c.fillText('touch a button (or look at one)', W / 2, 160); });
  const tm = new THREE.Mesh(new THREE.PlaneGeometry(0.75, 0.146), new THREE.MeshBasicMaterial({ map: title, transparent: true })); tm.position.y = 0.17; g.add(tm);
  (kindSet === 'monster' ? [['classic', 'CLASSIC', '#ff3a3a'], ['hammer', 'BONE HAMMER', '#e8dcc4'], ['chainsaw', 'CHAINSAW ARM', '#ff7a2a']]
    : [['normal', 'NORMAL', '#3dff7c'], ['chainsaw', 'CHAINSAW', '#ff7a2a'], ['hammer', 'HAMMER', '#ffd23a']]).forEach(([kind, label, col], i) => {
    const tex = canvasTex(256, 160, (c, W, H) => { c.fillStyle = '#14181d'; c.fillRect(0, 0, W, H); c.strokeStyle = col; c.lineWidth = 12; c.strokeRect(6, 6, W - 12, H - 12); c.fillStyle = col; c.font = '900 40px Arial'; c.textAlign = 'center'; c.textBaseline = 'middle'; c.fillText(label, W / 2, H / 2, W - 30); });
    const b = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.14, 0.04), [dark2, dark2, dark2, dark2, new THREE.MeshBasicMaterial({ map: tex }), dark2]); b.position.set((i - 1) * 0.25, 0, 0); g.add(b);
    const ring = new THREE.Mesh(new THREE.RingGeometry(0.02, 0.028, 24), new THREE.MeshBasicMaterial({ color: col })); ring.position.set((i - 1) * 0.25, -0.1, 0.022); ring.scale.setScalar(0.001); g.add(ring);
    choice.buttons.push({ kind, b, ring });
  });
  hands.forEach(h => pulse(h, 0.4, 80));
}
const dark2 = new THREE.MeshStandardMaterial({ color: '#2a2e33', metalness: 0.6, roughness: 0.5 });
function pickChoice(kind) {
  if (choice.kind === 'monster') { closeChoice(); choice.cool = 0.6; if (beast.setVariant) beast.setVariant(kind); setMode('monster'); return; }
  const s = choice.side; closeChoice(); choice.cool = 0.6;
  if (kind === 'normal') { me.regrow(s); podBusy = me.GROW_TIME || 8; } else { giveCyberArm(s, kind); podBusy = 3.2; }
  hands.forEach(h => pulse(h, 0.8, 120)); gore.sfx('thud', 0.5);
}
function updateChoice(dt) {
  if (!choice.grp) return; choice.grp.updateMatrixWorld(true);
  const head = camera.getWorldPosition(V()), look = camera.getWorldDirection(V());
  let gazed = null;
  for (const B of choice.buttons) { const c = B.b.getWorldPosition(V());
    if (hands.some(h => canPush(h) && h.mesh.position.distanceTo(c) < 0.11)) { pickChoice(B.kind); return; }
    if (look.angleTo(c.clone().sub(head)) < 0.09) gazed = B; }
  if (gazed !== choice.dwell) { choice.dwell = gazed; choice.dwellT = 0; }
  if (gazed) { choice.dwellT += dt; if (choice.dwellT > 2.0) { pickChoice(gazed.kind); return; } }
  for (const B of choice.buttons) { const k = B === gazed ? choice.dwellT / 2.0 : 0; B.ring.scale.setScalar(Math.max(0.001, k * 2.2)); B.b.position.z = B === gazed ? 0.01 : 0; }
}
function ripArm(s, by) {
  if (!me.armOn(s)) return;
  if (me.isCyber(s)) {   // a cyber arm comes off in one piece, with sparks (the shoulder underneath still bleeds)
    const C = cyber[s]; cyber[s] = null; me.root.updateMatrixWorld(true); const sh = me.shoulderPos(s);
    C.detach(); me.rip(s); bleeding[s] = 0; C.spark(sh, 30); gore.spurt(sh, V(0, 0.6, 0), 20, 2.4); gore.sfx('crunch', 1); hands.forEach(h => pulse(h, 1, 250));
    const L = addLimb({ o: C.root, jointLocal: null, dirLocal: null }, by); L.cyber = C; return;
  }
  me.root.updateMatrixWorld(true);
  const r = gore.makeLimb(s === 'L' ? 'Arm_L' : 'Arm_R'); const piece = r.o;
  const center = piece.position.clone(); const rq = me.root.getWorldQuaternion(new THREE.Quaternion());
  piece.position.copy(me.root.localToWorld(center.clone())); piece.quaternion.copy(rq); scene.add(piece);
  const sh = me.shoulderPos(s);
  me.rip(s); bleeding[s] = 0;
  // a big tearing burst
  const out = sh.clone().sub(camera.getWorldPosition(V())).setY(0).normalize();
  gore.spurt(sh, out.clone().add(V(0, 0.6, 0)), 45, 3.2); gore.sfx('tear', 1.2);
  addSplat(V(sh.x, 0, sh.z), V(0, 1, 0), 0.9);
  hands.forEach(h => pulse(h, 1, 250));
  addLimb(r, by);
}
function addLimb(r, by) {
  const L = { o: r.o, vel: V(), spin: V(), heldBy: null, offset: null, t: 0, jointLocal: r.jointLocal, dirLocal: r.dirLocal, rope: r.rope || null }; limbs.push(L);
  if (limbs.length > 10) { const old = limbs.find(l => !l.heldBy) || limbs[0]; limbs.splice(limbs.indexOf(old), 1); if (old.heldBy) old.heldBy.holding = null; scene.remove(old.o); if (old.cyber) old.cyber.dispose();
    if (old.dummy) { const j = looseDummies.indexOf(old.dummy); if (j >= 0) looseDummies.splice(j, 1); if (old.dummy.a) bleedingCheck(old.dummy.a); } }
  if (by) hold(L, by);
  return L;
}
function bleedingCheck(a) { if (a.parent) a.parent.remove(a); }
// grabbing a test dummy's head or arm
// dummies you picked up: the whole avatar hangs in a pivot that the limb system carries and throws
const looseDummies = [];
const allDummies = () => dummies.concat(looseDummies);
function pickUpDummy(d, h) {
  const a = d.a; a.scale.setScalar(DUMMY_SCALE); a.rotation.set(0, a.rotation.y, 0); a.updateMatrixWorld(true);
  const body = a.userData.parts.Body; const c = body ? body.getWorldPosition(V()) : a.getWorldPosition(V()).add(V(0, 0.65, 0));
  const pivot = new THREE.Group(); pivot.position.copy(c); scene.add(pivot); pivot.attach(a);
  const entry = { a, grow: 1, at: c.clone(), loose: true, limb: null, tornT: d.tornT };
  const L = addLimb({ o: pivot, jointLocal: null, dirLocal: null }, null); L.radius = 0.28; L.dummy = entry; entry.limb = L; if (h) hold(L, h);
  looseDummies.push(entry);
  d.a = null; d.respawn = 3; d.tornT = undefined;   // a fresh one appears on the stand
  gore.sfx('thud', 0.4); if (h) pulse(h, 0.6, 80);
  return L;
}
function unpinLoose(d) {   // take a loose dummy out of its pivot (before it gets torn apart)
  const L = d.limb; if (L) { if (L.heldBy) L.heldBy.holding = null; const i = limbs.indexOf(L); if (i >= 0) limbs.splice(i, 1); }
  if (d.a) scene.attach(d.a); if (L) scene.remove(L.o);
  const j = looseDummies.indexOf(d); if (j >= 0) looseDummies.splice(j, 1);
}
function updateLooseDummies(dt, hitters) {
  for (const d of looseDummies.slice()) {
    if (!d.a || !d.a.parent) { unpinLoose(d); continue; }
    const body = d.a.userData.parts.Body; d.at.copy(body ? body.getWorldPosition(V()) : d.limb.o.position).add(V(0, -0.75 * DUMMY_SCALE, 0));
    if (d.tornT !== undefined) d.tornT += dt;
    // punches / tools knock it around
    const c = d.at.clone().add(V(0, 0.75 * DUMMY_SCALE, 0));
    if (!d.limb.heldBy) for (const hit of hitters) { if (hit.h && hit.h === d.limb.heldBy) continue; const sp = hit.vel.length();
      if (hit.pos.distanceTo(c) < 0.4 && sp > hit.speed) { d.limb.vel.addScaledVector(hit.vel.clone().clampLength(0, 4), 0.25).add(V(0, 0.6, 0)); d.limb.spin.set(Math.random() * 6, Math.random() * 6, Math.random() * 6);
        gore.spurt(hit.pos.clone(), hit.vel.clone().normalize(), 8, 1 + sp * 0.3); gore.sfx('thud', Math.min(1, sp / 6)); if (hit.h && hit.h.gamepad) pulse(hit.h, 0.6, 60); break; } }
  }
}
function dummyPartNear(p) {
  let best = null, bd = Infinity;
  for (const d of allDummies()) { if (!d.a || d.grow < 1) continue;
    for (const name of ['Head', 'Arm_L', 'Arm_R', 'Body']) { const part = d.a.userData.parts[name]; if (!part) continue; const dist = part.getWorldPosition(V()).distanceTo(p);
      const reach = { Head: 0.23, Arm_L: 0.27, Arm_R: 0.27, Body: 0.36 }[name];
      if (dist < reach && dist - (name === 'Body' ? 0.12 : 0) < bd) { bd = dist - (name === 'Body' ? 0.12 : 0); best = { dummy: d, part: name, d0: dist }; } } }
  return best;
}
function tearDummyPart(d, name, h) {
  const r = gore.tearOff(d.a, name); if (!r) return null; d.tornT = d.tornT ?? 0; hands.forEach(x => pulse(x, x === h ? 1 : 0.4, 220)); return addLimb(r, h);
}
function hold(L, h) {
  if (L.heldBy) L.heldBy.holding = null;
  L.heldBy = h; h.holding = L;
  // keep where it was relative to the hand, but not further than 0.3 m away
  const hm = new THREE.Matrix4().compose(h.mesh.position, h.mesh.quaternion, V(1, 1, 1));
  L.o.updateMatrixWorld(true); L.offset = hm.clone().invert().multiply(L.o.matrixWorld);
  const tr = V().setFromMatrixPosition(L.offset); if (tr.length() > 0.3) { tr.setLength(0.3); L.offset.setPosition(tr); }
}
function release(h) {
  const L = h.holding; if (!L) return; h.holding = null; L.heldBy = null;
  L.vel.copy(h.vel).multiplyScalar(1.15); L.spin.set((Math.random() - 0.5) * 10, (Math.random() - 0.5) * 6, (Math.random() - 0.5) * 10).multiplyScalar(Math.min(1, h.vel.length() / 3));
}
// while you pull on a dummy part it stretches toward your hand, and the controller buzzes harder, until it tears
function letGoOfDummy(h) {
  const G = h.ripGrab; if (G && G.dummy && G.obj && G.rest && G.obj.parent) G.obj.position.copy(G.rest); h.ripGrab = null;
}
function pullDummy(h, p) {
  const G = h.ripGrab, d = G.dummy, part = d.a?.userData.parts[G.part]; if (!part) { h.ripGrab = null; return; }
  if (!G.obj) { G.obj = part; G.rest = part.position.clone(); }
  // how far the hand moved away from where it grabbed, measured against the part's resting place
  part.position.copy(G.rest); d.a.updateMatrixWorld(true);
  const restW = part.getWorldPosition(V()); const pull = restW.distanceTo(p) - G.d0;
  if (G.part === 'Body') {
    const other = hands.find(x => x !== h && x.ripGrab && x.ripGrab.dummy === d && x.ripGrab.part === 'Body');
    if (other) {   // two hands on the body: pull them apart to tear it in half
      const op = mode === 'monster' ? beastHandPos(sideOf(other)) : other.mesh.position; const sep = p.distanceTo(op);
      if (G.sep0 === undefined) G.sep0 = sep; const k = clamp((sep - G.sep0) / 0.28, 0, 1);
      if (k > 0.05) { pulse(h, 0.2 + 0.8 * k, 20); pulse(other, 0.2 + 0.8 * k, 20); }
      d.a.scale.set((1 + 0.12 * k) * DUMMY_SCALE, DUMMY_SCALE, DUMMY_SCALE);   // it stretches before it gives
      if (sep - G.sep0 > 0.28) { d.a.scale.setScalar(DUMMY_SCALE); const push = p.clone().sub(op).setY(0); h.ripGrab = null; other.ripGrab = null; smashDummy(d, V(push.z, 0, -push.x), true); hands.forEach(x => pulse(x, 1, 300)); }
      return;
    }
    G.sep0 = undefined; if (d.grow >= 1 && !d.loose) d.a.scale.setScalar(DUMMY_SCALE);
    if (d.loose) {   // a dummy lying around or carried: pick it up, or (if the other hand is carrying it) yank it in half
      const holder = d.limb.heldBy;
      if (!holder) { h.ripGrab = null; hold(d.limb, h); pulse(h, 0.5, 60); return; }
      const k = clamp(pull / 0.32, 0, 1); if (k > 0.05) { pulse(h, 0.2 + 0.8 * k, 20); pulse(holder, 0.2 + 0.8 * k, 20); }
      if (pull > 0.32) { h.ripGrab = null; smashDummy(d, p.clone().sub(restW), true); hands.forEach(x => pulse(x, 1, 300)); }
      return;
    }
    if (pull > 0.1) { h.ripGrab = null; pickUpDummy(d, h); }   // lift the whole thing off its stand, in one piece
    return;
  }
  const k = clamp(pull / 0.24, 0, 1);
  if (k > 0.03) { pulse(h, 0.2 + 0.7 * k, 20); const toward = d.a.worldToLocal(p.clone()).sub(G.rest); if (toward.lengthSq() > 1e-6) part.position.copy(G.rest).addScaledVector(toward.normalize(), 0.1 * k); }
  if (Math.random() < k * 0.3) gore.spurt(restW.clone().lerp(p, 0.4), p.clone().sub(restW).normalize(), 1, 0.6);   // it starts to tear
  if (pull > 0.24) { part.position.copy(G.rest); h.ripGrab = null; tearDummyPart(d, G.part, h); }
}
function updateRipping(dt) {
  for (const h of hands) {
    const s = sideOf(h), o = s === 'L' ? 'R' : 'L', g = gripOf(h), was = h.gripDown;
    h.gripDown = g > 0.7 ? true : g < 0.35 ? false : h.gripDown;
    if (mode === 'gorilla' && (!me.armOn(s) || me.isCyber(s))) { if (h.holding) release(h); h.ripGrab = null; continue; }   // no hand to grab with
    const p = mode === 'monster' ? beastHandPos(s) : h.mesh.position;
    // a held grip grabs as soon as the hand reaches a dummy part or a loose limb (not only at the moment you squeeze)
    if (h.gripDown && was && !h.ripGrab && !h.holding) {
      const near = limbs.find(L => !L.heldBy && L.o.position.distanceTo(p) < 0.25); const dp = dummyPartNear(p);
      if (near) hold(near, h); else if (dp) { h.ripGrab = dp; pulse(h, 0.5, 40); }
    }
    if (h.gripDown && !was) {
      const near = limbs.filter(L => !L.heldBy).sort((a, b) => a.o.position.distanceTo(p) - b.o.position.distanceTo(p))[0];
      const dp = dummyPartNear(p);
      if (near && near.o.position.distanceTo(p) < 0.32) hold(near, h);
      else if (dp) { h.ripGrab = dp; pulse(h, 0.5, 40); }
      else if (mode === 'gorilla' && me.armOn(o)) {
        let bi = -1, bd = 0.17; armPointsOf(o).forEach((q, i) => { const d = q.distanceTo(p); if (d < bd) { bd = d; bi = i; } });
        if (bi >= 0) { h.ripGrab = { o, bi, d0: bd }; pulse(h, 0.4, 40); }
      }
    }
    if (!h.gripDown) { if (h.holding) release(h); letGoOfDummy(h); }
    if (h.ripGrab && h.ripGrab.dummy) { pullDummy(h, p); continue; }
    if (h.ripGrab) {
      if (!me.armOn(h.ripGrab.o)) { h.ripGrab = null; continue; }
      const q = armPointsOf(h.ripGrab.o)[h.ripGrab.bi]; const pull = q.distanceTo(p) - h.ripGrab.d0; const k = clamp(pull / T.ripPull, 0, 1);
      if (k > 0.05) { pulse(h, 0.15 + 0.6 * k, 20); pulse(handOf(h.ripGrab.o), 0.15 + 0.7 * k, 20); }
      if (pull > T.ripPull) { const tgt = h.ripGrab.o; h.ripGrab = null; ripArm(tgt, h); }
    }
  }
}
const _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _s = V();
function updateLimbs(dt) {
  for (const L of limbs) {
    L.t += dt; const o = L.o;
    if (L.heldBy) { const h = L.heldBy; _m.compose(h.mesh.position, h.mesh.quaternion, V(1, 1, 1)).multiply(L.offset); _m.decompose(o.position, o.quaternion, _s); L.vel.copy(h.vel); }
    else {
      L.vel.y -= 9.8 * dt; o.position.addScaledVector(L.vel, dt);
      o.rotation.x += L.spin.x * dt; o.rotation.y += L.spin.y * dt; o.rotation.z += L.spin.z * dt;
      const lr = L.radius || 0.11; const c = contact(o.position, lr);
      if (c.dist < lr) { o.position.copy(c.rest); const vn = L.vel.dot(c.normal); if (vn < 0) { if (vn < -2) addSplat(c.point, c.normal, 0.35 + Math.random() * 0.3); L.vel.addScaledVector(c.normal, -1.3 * vn); } L.vel.multiplyScalar(0.72); L.spin.multiplyScalar(0.6); }
    }
    // a spine still inside the body: the controller buzzes harder the further it's pulled out, then a jolt when it pops free
    if (L.rope) { if (L.rope.attached && L.heldBy) pulse(L.heldBy, 0.1 + 0.6 * L.rope.tension, 20); if (L.rope.popped) { L.rope.popped = false; if (L.heldBy) pulse(L.heldBy, 1, 200); } }
    // the torn end spurts in pulses, then drips
    if (L.jointLocal && L.t < 7) { const w = o.localToWorld(L.jointLocal.clone()); const d = L.dirLocal.clone().applyQuaternion(o.quaternion);
      const k = Math.pow(Math.max(0, Math.sin(L.t * Math.PI * 3)), 3) * Math.max(0.15, 1 - L.t / 6);
      if (k > 0.3 && Math.random() < 0.8) { gore.spurt(w, d, 2, 0.8 + 2.4 * k); if (L.heldBy && k > 0.9) pulse(L.heldBy, 0.25, 15); }
      else if (Math.random() < dt * 4) gore.spurt(w, V(0, -1, 0), 1, 0.2); }
  }
  // open shoulders bleed too, until the arm grows back
  for (const s of ['L', 'R']) {
    if (bleeding[s] < 0) continue; if (!me.armGone(s)) { bleeding[s] = -1; continue; }
    bleeding[s] += dt; const b = bleeding[s];
    const kb = Math.pow(Math.max(0, Math.sin(b * Math.PI * 3)), 3) * Math.max(0.2, 1 - b / 6);
    if (me.root.visible && kb > 0.3 && Math.random() < 0.8) { const sh = me.shoulderPos(s); const out = sh.clone().sub(me.root.getWorldPosition(V())).setY(0).normalize(); gore.spurt(sh, out.add(V(0, 0.4, 0)), 2, 0.6 + 2.2 * kb); if (kb > 0.9) pulse(handOf(s === 'L' ? 'R' : 'L'), 0.15, 15); }
  }
}

// ---------------- the regen pod ----------------
let podBusy = 0;
function updatePod(dt, t, headPos) {
  const inPod = Math.hypot(headPos.x - POD.x, headPos.z - POD.z) < 0.9 && headPos.y < 3.2 && mode === 'gorilla';
  choice.cool = Math.max(0, choice.cool - dt);
  if (inPod && !choice.grp && choice.cool <= 0) { const s = ['L', 'R'].find(x => me.armGone(x)); if (s) openChoice(s); }
  if (!inPod && choice.grp && choice.kind === 'arm') closeChoice();
  if (choice.grp && choice.kind === 'monster' && headPos.distanceTo(V(BTN.x, 1.2, BTN.z)) > 2.6) closeChoice();
  updateChoice(dt);
  podBusy = Math.max(0, podBusy - dt);
  const k = podBusy > 0 ? 1 : 0;
  podGlow.emissiveIntensity = 1.0 + 0.4 * Math.sin(t * 2) + k * (1.5 + Math.sin(t * 14));
  podLight.intensity = 2.2 + k * 4 * (0.7 + 0.3 * Math.sin(t * 14));
  podRing.position.y = 0.2 + k * (Math.sin(t * 3) * 0.5 + 0.5) * 2.6; podRing2.position.y = 2.98 - k * (Math.sin(t * 3) * 0.5 + 0.5) * 2.6;
  sparks.material.opacity += ((k ? 0.9 : 0) - sparks.material.opacity) * Math.min(1, dt * 4);
  if (sparks.material.opacity > 0.01) {
    for (let i = 0; i < SPARKS; i++) { const [a, r, ph] = sparkSeed[i]; const y = ((t * 0.6 + ph) % 1) * 2.8 + 0.2; const rr = r * (1 - y / 4);
      sparkPos[i * 3] = POD.x + Math.cos(a + t * 1.7) * rr; sparkPos[i * 3 + 1] = y; sparkPos[i * 3 + 2] = POD.z + Math.sin(a + t * 1.7) * rr; }
    sparkGeo.attributes.position.needsUpdate = true;
  }
}

// ---------------- test dummies ----------------
const DUMMY_SCALE = 0.85;   // the same size as your gorilla when you're on the floor
const dummies = DUMMY_SPOTS.map(at => ({ at, a: null, grow: 1, respawn: 0 }));
function spawnDummy(d) { d.a = gore.makeAvatar(); d.a.position.copy(d.at); d.a.scale.setScalar(0.01); d.grow = 0; }
dummies.forEach(spawnDummy);
function smashDummy(d, push, split = false, pulp = false) {
  if (!d.a) return; const a = d.a;
  if (d.loose) unpinLoose(d); else a.scale.setScalar(DUMMY_SCALE);
  a.updateMatrixWorld(true); const dir = push.clone().setY(0); if (dir.lengthSq() < 1e-6) dir.set(0, 0, 1);
  gore.dismember(a, dir.normalize(), { split, pulp }); d.a = null; d.respawn = 4.5; d.tornT = undefined;
}
function updateDummies(dt, t, hitters) {
  updateLooseDummies(dt, hitters);
  dummies.forEach((d, i) => {
    if (!d.a) { d.respawn -= dt; if (d.respawn <= 0) spawnDummy(d); return; }
    if (d.grow < 1) { d.grow = Math.min(1, d.grow + dt / 0.9); d.a.scale.setScalar(Math.max(0.01, easeOutBack(d.grow, 1.6)) * DUMMY_SCALE); }
    if (d.tornT !== undefined) { d.tornT += dt; if (d.tornT > 25) { smashDummy(d, V(0, 0, 1)); return; } }   // a torn-up dummy falls apart after a while
    // wobble: a springy tilt that punches push on
    const w = d.w || (d.w = { x: 0, z: 0, vx: 0, vz: 0, cd: 0 }); w.cd -= dt;
    w.vx += (-w.x * 70 - w.vx * 5) * dt; w.vz += (-w.z * 70 - w.vz * 5) * dt; w.x = clamp(w.x + w.vx * dt, -0.5, 0.5); w.z = clamp(w.z + w.vz * dt, -0.5, 0.5);
    d.a.rotation.set(w.x, Math.sin(t * 0.8 + i) * 0.06, w.z);
    const grabbed = hands.some(h => h.ripGrab && h.ripGrab.dummy === d);
    const c = d.at.clone().add(V(0, 0.75 * DUMMY_SCALE, 0));
    if (w.cd <= 0 && !grabbed) for (const hit of hitters) {
      const dx = hit.pos.x - c.x, dz = hit.pos.z - c.z, dy = hit.pos.y - c.y; const sp = hit.vel.length();
      if (Math.hypot(dx, dz) < hit.r && Math.abs(dy) < 0.7 && sp > hit.speed) {
        const v = hit.vel.clone().setY(0); const f = Math.min(sp, 7) * 0.09;
        if (v.lengthSq() > 1e-4) { v.normalize(); w.vx += v.z * f * 6; w.vz += -v.x * f * 6; }
        gore.spurt(hit.pos.clone(), v.clone().add(V(0, 0.5, 0)), 6 + Math.round(sp * 2), 0.8 + sp * 0.3);
        if (sp > 3) addSplat(V(c.x + v.x * 0.6, 0, c.z + v.z * 0.6), V(0, 1, 0), 0.25 + Math.random() * 0.3, 0.3);
        gore.sfx('thud', Math.min(1, sp / 6)); gore.sfx('squelch', Math.min(1, sp / 8));
        if (hit.h && hit.h.gamepad) pulse(hit.h, Math.min(1, 0.3 + sp / 8), 60);
        w.cd = 0.22; break;
      }
    }
  });
}

// ---------------- the monster (you, after pressing the button) ----------------
const beast = makeMonster(scene); beast.g.visible = false;
if (beast.setAudio) beast.setAudio(gore.audio);   // the chainsaw arm's engine sound
// the monster's body, arms, hands and fingers are driven inside monster.js (beast.updatePlayer / beast.handPos)
function updateBeast(head, inputs, dt, t, talk) { beast.updatePlayer(head, inputs, dt, t, talk); }
const beastHandPos = (s) => beast.handPos(s);
// red flash inside your head when you change
const flash = new THREE.Mesh(new THREE.SphereGeometry(0.25, 16, 12), new THREE.MeshBasicMaterial({ color: '#b00010', side: THREE.BackSide, transparent: true, opacity: 0, depthTest: false }));
flash.renderOrder = 20; camera.add(flash);
function setMode(m) {
  mode = m; const monster = m === 'monster';
  beast.g.visible = monster; me.root.visible = !monster && (renderer.xr.isPresenting || VIEW === 'rip');
  beast.drips.forEach(d => d.visible = monster); beast.arms.forEach(a => a.bl.visible = false);
  flash.material.color.set(monster ? '#b00010' : '#20ff70'); flash.material.opacity = renderer.xr.isPresenting ? 0.5 : 0;
  hands.forEach(h => { h.stuck = null; if (h.holding) release(h); h.ripGrab = null; pulse(h, 1, monster ? 500 : 200); });
}
let btnArmed = true, btnPress = 0;
function updateButton(dt, t, points) {
  const top = V(BTN.x, 1.09, BTN.z); const near = points.some(p => p.distanceTo(top) < 0.14 * rig.scale.x);
  if (near && btnArmed) { btnArmed = false; btnPress = 1; if (mode === 'monster') setMode('gorilla'); else if (renderer.xr.isPresenting && beast.setVariant) openChoice(null, 'monster'); else setMode('monster'); }
  if (!points.some(p => p.distanceTo(top) < 0.3 * rig.scale.x)) btnArmed = true;
  btnPress = Math.max(0, btnPress - dt * 3); btnCap.position.y = 1.05 - 0.035 * btnPress;
  btnCap.material.emissiveIntensity = 0.6 + 0.4 * Math.sin(t * 4) + btnPress * 2; btnLight.intensity = 1 + 0.5 * Math.sin(t * 4);
}
// ---------------- gore switch (by the mirror) + the 17+ notice ----------------
const GSW = V(-2.5, 1.0, 6.6);
box(GSW.x, 0.48, GSW.z, 0.4, 0.96, 0.4, darkMetal);
const gswCap = add(new THREE.CylinderGeometry(0.12, 0.13, 0.06, 20), new THREE.MeshStandardMaterial({ color: '#2a7bff', emissive: '#0a3a9a', emissiveIntensity: 0.8, roughness: 0.35 }), GSW.x, 1.0, GSW.z);
let gswSign = null;
function drawGoreSign() { if (gswSign) scene.remove(gswSign); const full = gore.G.level === 'full';
  gswSign = sign(full ? 'GORE: FULL' : 'GORE: LOW', 1.0, 0.36, GSW.x, 1.5, GSW.z, Math.atan2(-GSW.x, 8 - GSW.z), { fg: full ? '#ff4040' : '#5aa8ff', sub: 'PRESS TO CHANGE' }); }
drawGoreSign();
let gswArmed = true, gswPress = 0;
function updateGoreSwitch(dt, points) {
  const top = V(GSW.x, 1.04, GSW.z); const near = points.some(p => p.distanceTo(top) < 0.13 * rig.scale.x);
  if (near && gswArmed) { gswArmed = false; gswPress = 1; gore.G.level = gore.G.level === 'full' ? 'low' : 'full'; try { localStorage.setItem('goreLevel', gore.G.level); } catch (e) {} drawGoreSign(); hands.forEach(h => pulse(h, 0.5, 60)); }
  if (!points.some(p => p.distanceTo(top) < 0.28 * rig.scale.x)) gswArmed = true;
  gswPress = Math.max(0, gswPress - dt * 3); gswCap.position.y = 1.0 - 0.03 * gswPress;
}
// a notice that floats in front of you for a few seconds when the game starts
const notice = (() => { const t = canvasTex(1024, 512, (g, W, H) => { g.fillStyle = 'rgba(12,12,14,0.92)'; g.fillRect(0, 0, W, H); g.strokeStyle = '#d4101c'; g.lineWidth = 14; g.strokeRect(10, 10, W - 20, H - 20);
    g.fillStyle = '#ff3a3a'; g.font = '900 120px Arial'; g.textAlign = 'center'; g.fillText('17+', W / 2, 150); g.fillStyle = '#fff'; g.font = '900 54px Arial'; g.fillText('MATURE CONTENT', W / 2, 235);
    g.font = '600 38px Arial'; g.fillStyle = '#ddd'; g.fillText('Blood, gore and dismemberment.', W / 2, 315); g.fillText('Turn it down at the blue GORE switch', W / 2, 375); g.fillText('next to the mirror.', W / 2, 425); });
  const m = new THREE.Mesh(new THREE.PlaneGeometry(1.2, 0.6), new THREE.MeshBasicMaterial({ map: t, transparent: true, opacity: 0, depthTest: false })); m.renderOrder = 30; m.visible = false; scene.add(m); return m; })();
let noticeT = -1;
function updateNotice(dt) {
  if (noticeT < 0) return; noticeT += dt;
  const o = noticeT < 0.5 ? noticeT / 0.5 : noticeT > 7 ? Math.max(0, 1 - (noticeT - 7) / 0.8) : 1; notice.material.opacity = o; notice.visible = o > 0;
  const hp = camera.getWorldPosition(V()), f = camera.getWorldDirection(V()).setY(0).normalize(); notice.position.copy(hp).addScaledVector(f, 1.3).add(V(0, -0.05, 0)); notice.lookAt(hp.x, notice.position.y, hp.z);
  if (noticeT > 8) { noticeT = -1; notice.visible = false; }
}
// rig size: smoothly grow when you're the monster, keeping your head where it is
function updateScale(dt) {
  const target = mode === 'monster' ? T.monsterScale : 1; const s = rig.scale.x; if (Math.abs(s - target) < 1e-3) return;
  rig.updateMatrixWorld(true); const before = camera.getWorldPosition(V());
  rig.scale.setScalar(s + (target - s) * Math.min(1, dt * 3)); rig.updateMatrixWorld(true);
  const after = camera.getWorldPosition(V()); rig.position.x += before.x - after.x; rig.position.z += before.z - after.z;
}

// mirror: show your own head in it (hidden in your eyes)
{ const before = mirror.onBeforeRender; mirror.onBeforeRender = (r, sc, c) => { me.hideHead(false); beast.head.visible = true; before(r, sc, c); if (renderer.xr.isPresenting) { me.hideHead(true); beast.head.visible = false; } }; }

// ---------------- one frame of you (works for the headset, and for the PC test views) ----------------
function updateAvatar(head, inputs, dt, t, talk) {
  if (mode === 'monster') { updateBeast(head, inputs, dt, t, talk); for (const s of ['L', 'R']) if (cyber[s]) cyber[s].setVisible(false); }
  else if (me.root.visible) {
    // the floor (or whatever you're over) under your head, so the body can stay above it
    const hp = head.getWorldPosition(V()); const probe = V(hp.x, hp.y - me.EYE.y, hp.z); const c = contact(probe, 0);
    const floorY = (c.dist < 0.02 && c.normal.y > 0.6) ? c.point.y : -Infinity;
    me.update({ camera: head, hands: inputs, talk, dt, floorY });
  }
}
function hittersFor(inputs) {
  const out = [];
  if (mode === 'monster') for (const s of ['L', 'R']) { const h = inputs[s]; if (h && h.pos) out.push({ pos: beastHandPos(s), vel: h.vel || V(), r: 0.45, speed: T.punchSpeed * 0.8, h: h.h }); }
  else for (const s of ['L', 'R']) { const h = inputs[s]; if (!h || !h.pos || !me.armOn(s)) continue;
    if (cyber[s]) { const C = cyber[s]; if (C.built >= 1) out.push({ pos: C.tip.getWorldPosition(V()), vel: C.tipVel, r: 0.4, speed: 1.5, h: h.h }); }
    else out.push({ pos: h.pos, vel: h.vel || V(), r: 0.38, speed: T.punchSpeed, h: h.h }); }
  for (const L of limbs) if (!L.heldBy || L.heldBy.gamepad) out.push({ pos: L.o.position, vel: L.vel, r: 0.45, speed: 2.0, h: L.heldBy });
  return out;
}

// ---------------- game modes: SANDBOX (this hall), ESCAPE (run from 3 monsters in the big facility), BE THE MONSTER (hunt NPC gorillas) ----------------
const facColliders = [];
const G7 = { mode: 'sandbox', phase: 'idle', t: 0, fac: null, monsters: [], npcs: [], keycards: [], keys: 0, caught: 0, total: 0, endT: 0, msg: '', loading: false, quitHold: 0 };
const LOBBY_SPAWN = V(0, 0, 8);
async function ensureFacility() {
  if (G7.fac) return G7.fac;
  const m = await import('./facility.js'); const fac = m.buildFacility(scene);
  fac.colliders.forEach(c => facColliders.push(c)); G7.fac = fac; return fac;
}
let NPCmod = null; async function ensureNPC() { if (!NPCmod) NPCmod = await import('./npc.js'); return NPCmod; }
function teleport(feet, yaw = 0) {
  rig.rotation.y = yaw; rig.updateMatrixWorld(true);
  const off = camera.position.clone().setY(0).applyAxisAngle(V(0, 1, 0), yaw);
  rig.position.set(feet.x - off.x, feet.y, feet.z - off.z); vel.set(0, 0, 0); history.length = 0; hands.forEach(h => { h.stuck = null; if (h.holding) release(h); h.ripGrab = null; });
}
// big message in front of you
const banner = (() => { const c = document.createElement('canvas'); c.width = 1024; c.height = 400; const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace;
  const m = new THREE.Mesh(new THREE.PlaneGeometry(1.1, 0.43), new THREE.MeshBasicMaterial({ map: t, transparent: true, depthTest: false })); m.renderOrder = 31; m.visible = false; scene.add(m);
  return { m, c, t, until: 0 }; })();
function showBanner(title, sub = '', col = '#ffd23a', secs = 3) {
  const g = banner.c.getContext('2d'); g.clearRect(0, 0, 1024, 400); g.fillStyle = 'rgba(10,10,12,0.85)'; g.fillRect(0, 0, 1024, 400); g.strokeStyle = col; g.lineWidth = 12; g.strokeRect(6, 6, 1012, 388);
  g.fillStyle = col; g.textAlign = 'center'; g.font = '900 110px Arial'; g.fillText(title, 512, 175, 980); g.fillStyle = '#eee'; g.font = '700 50px Arial'; g.fillText(sub, 512, 290, 980);
  banner.t.needsUpdate = true; banner.until = clock.elapsedTime + secs; banner.m.visible = true;
}
function updateBanner() {
  if (!banner.m.visible) return; if (clock.elapsedTime > banner.until) { banner.m.visible = false; return; }
  const hp = camera.getWorldPosition(V()), f = camera.getWorldDirection(V()); banner.m.position.copy(hp).addScaledVector(f, 1.4); banner.m.quaternion.copy(camera.getWorldQuaternion(new THREE.Quaternion()));
}
// wrist display (left wrist)
const wrist = (() => { const c = document.createElement('canvas'); c.width = 256; c.height = 128; const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace;
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: t, depthTest: false, transparent: true })); s.scale.set(0.17, 0.085, 1); s.renderOrder = 5; s.visible = false; scene.add(s); return { s, c, t, last: '' }; })();
function setWrist(l1, l2 = '', col = '#ffd23a') {
  const key = l1 + '|' + l2 + col; if (key === wrist.last) return; wrist.last = key; const g = wrist.c.getContext('2d'); g.clearRect(0, 0, 256, 128);
  g.fillStyle = 'rgba(12,14,16,0.8)'; g.beginPath(); g.roundRect(4, 4, 248, 120, 20); g.fill(); g.textAlign = 'center'; g.fillStyle = col; g.font = '900 46px Arial'; g.fillText(l1, 128, 58, 236); g.fillStyle = '#ddd'; g.font = '700 30px Arial'; g.fillText(l2, 128, 102, 236); wrist.t.needsUpdate = true;
}
// keycards
const cardMat = new THREE.MeshStandardMaterial({ color: '#29c8ff', emissive: '#29c8ff', emissiveIntensity: 1.6 });
const cardGeo = new THREE.BoxGeometry(0.16, 0.1, 0.012);
function spawnKeycards(n) {
  const spots = G7.fac.keycardSpots.slice().sort(() => Math.random() - 0.5).slice(0, n);
  G7.keycards = spots.map(p => { const m = new THREE.Mesh(cardGeo, cardMat); m.position.copy(p); scene.add(m);
    const glow = new THREE.PointLight('#29c8ff', 1.2, 3, 2); glow.position.copy(p); scene.add(glow); return { m, glow, base: p.clone(), got: false }; });
}
function clearRound() {
  G7.monsters.forEach(m => m.dispose()); G7.monsters = []; G7.npcs.forEach(n => { if (n.state !== 'caught') n.dispose(); }); G7.npcs = [];
  G7.keycards.forEach(k => { scene.remove(k.m); scene.remove(k.glow); }); G7.keycards = []; G7.keys = 0; G7.caught = 0;
  if (G7.fac) { G7.fac.setAlarm(false); G7.fac.exit.setOpen(false); }
}
function backToLobby(msg) {
  clearRound(); G7.mode = 'sandbox'; G7.phase = 'idle'; wrist.s.visible = false;
  if (mode === 'monster') setMode('gorilla'); teleport(LOBBY_SPAWN, 0); if (msg) showBanner(msg[0], msg[1], msg[2], 4);
}
async function startMode(which) {
  if (G7.loading) return; G7.loading = true;
  try {
    showBanner('LOADING...', which === 'escape' ? 'ESCAPE' : 'BE THE MONSTER', '#ffd23a', 10);
    const fac = await ensureFacility(); const N = await ensureNPC();
    clearRound(); G7.mode = which; G7.t = 0; G7.phase = 'intro';
    for (const s of ['L', 'R']) if (me.armGone(s)) me.regrow(s);
    if (which === 'escape') {
      if (mode === 'monster') setMode('gorilla');
      teleport(fac.spawn, fac.spawnYaw || 0); spawnKeycards(3);
      G7.monsters = ['ripper', 'crusher', 'sawjaw'].map((k, i) => { const m = N.makeMonsterNPC(scene, k); if (m.setAudio) m.setAudio(gore.audio);
        const sp = fac.monsterSpawns[i % fac.monsterSpawns.length]; m.pos.copy(sp); if (m.object) m.object.position.copy(sp); m.setActive(false); return m; });
      showBanner('ESCAPE', 'Find 3 keycards, then get out. They wake up in 10 s...', '#29c8ff', 5);
    } else {
      setMode('monster'); teleport(fac.monsterSpawns[0], 0);
      const spots = fac.npcSpawns.slice().sort(() => Math.random() - 0.5).slice(0, 8);
      G7.npcs = spots.map(p => { const n = N.makeGorillaNPC(scene); n.pos.copy(p); if (n.object) n.object.position.copy(p); return n; });
      G7.total = G7.npcs.length; G7.endT = 180;
      showBanner('BE THE MONSTER', `Catch all ${G7.total} gorillas in 3 minutes`, '#ff3a3a', 5);
    }
    wrist.s.visible = true;
  } catch (e) { console.error(e); showBanner('NOT READY YET', String(e.message || e).slice(0, 60), '#ff3a3a', 4); G7.mode = 'sandbox'; }
  G7.loading = false;
}
function noiseLevel(talk = 0) { const v = hands.reduce((m, h) => Math.max(m, h.vel.length()), 0); return Math.min(1, Math.max(talk, (v - 1.5) / 4)); }
function playerCaught(m) {
  G7.phase = 'caught'; G7.t = 0; m.lunge(camera.getWorldPosition(V()));
  flash.material.color.set('#b00010'); flash.material.opacity = 0.6; hands.forEach(h => pulse(h, 1, 600)); gore.sfx('tear', 1.4); gore.sfx('crunch', 1);
}
function updateModes(dt, t, talk = 0) {
  updateBanner();
  // hold B/Y on the left controller for 2 s to give up and go back to the lobby
  if (G7.mode !== 'sandbox') { const lh = handOf('L'); const b = lh?.gamepad?.buttons?.[5]?.pressed; G7.quitHold = b ? G7.quitHold + dt : 0; if (G7.quitHold > 2) { G7.quitHold = 0; backToLobby(['BACK TO THE LOBBY', '', '#ffd23a']); return; } }
  if (G7.mode === 'sandbox') { return; }
  const fac = G7.fac; fac.update(dt, t); G7.t += dt;
  const head = camera.getWorldPosition(V()); const lw = handOf('L').mesh.position; wrist.s.position.copy(lw).add(V(0, 0.13, 0));
  if (G7.mode === 'escape') {
    if (G7.phase === 'intro' && G7.t > 10) { G7.phase = 'play'; G7.monsters.forEach(m => m.setActive(true)); fac.setAlarm(true); setTimeout(() => { if (G7.fac && G7.keys < 3) G7.fac.setAlarm(false); }, 2500); showBanner('THEY ARE LOOSE', 'Stay quiet. Climb. Run.', '#ff3a3a', 3); hands.forEach(h => pulse(h, 0.8, 400)); }
    // keycards: touch with a hand or your head
    for (const k of G7.keycards) { if (k.got) continue; k.m.rotation.y += dt * 2; k.m.position.y = k.base.y + Math.sin(t * 2.5) * 0.04;
      if ([head, ...hands.map(h => h.mesh.position)].some(p => p.distanceTo(k.m.position) < 0.35)) { k.got = true; scene.remove(k.m); scene.remove(k.glow); G7.keys++; if (fac.exit.setCards) fac.exit.setCards(G7.keys); hands.forEach(h => pulse(h, 0.6, 120)); gore.sfx('thud', 0.4);
        if (G7.keys >= 3) { fac.exit.setOpen(true); fac.setAlarm(true); showBanner('EXIT OPEN', 'Get to the loading bay!', '#3dff7c', 4); } else showBanner(`KEYCARD ${G7.keys}/3`, '', '#29c8ff', 1.5); } }
    const play = G7.phase === 'play' || G7.phase === 'intro';
    for (const m of G7.monsters) { m.update(dt, t, { target: G7.phase === 'play' ? head : null, nav: fac.nav, contact, noise: noiseLevel(talk) });
      if (G7.phase === 'play' && m.canGrab(head)) { playerCaught(m); break; } }
    const near = Math.min(...G7.monsters.map(m => m.pos.distanceTo(head)));
    if (G7.phase === 'play' && near < 9 && Math.random() < dt * (10 - near) * 0.5) hands.forEach(h => pulse(h, 0.15 + (9 - near) * 0.04, 30));   // heartbeat when one is close
    setWrist(G7.keys >= 3 ? 'EXIT OPEN' : `KEYS ${G7.keys}/3`, G7.phase === 'intro' ? `wake in ${Math.max(0, 10 - G7.t).toFixed(0)}s` : `${Math.floor(G7.t)}s`, G7.keys >= 3 ? '#3dff7c' : '#29c8ff');
    if (G7.phase === 'play' && G7.keys >= 3 && fac.exit.isOpen() && head.distanceTo(fac.exit.pos) < fac.exit.radius) { const tt = G7.t; G7.phase = 'won'; G7.t = 0; showBanner('YOU ESCAPED', `in ${Math.floor(tt)} seconds`, '#3dff7c', 5); }
    if (G7.phase === 'caught' && G7.t > 0.45 && !G7.torn) { G7.torn = true;   // you get torn apart where you stood
      const a = gore.makeAvatar(); a.position.set(head.x, Math.max(0, head.y - 1.3), head.z); a.rotation.y = rig.rotation.y; gore.dismember(a, V(0, 0, 1).applyAxisAngle(V(0, 1, 0), rig.rotation.y), {});
      me.root.visible = false; showBanner('YOU WERE CAUGHT', 'Back to the lobby...', '#ff3a3a', 4); }
    if ((G7.phase === 'caught' && G7.t > 4.5) || (G7.phase === 'won' && G7.t > 5)) { const won = G7.phase === 'won'; G7.torn = false; me.root.visible = true; backToLobby(won ? ['YOU ESCAPED', 'Escape mode cleared', '#3dff7c'] : ['CAUGHT', 'Try again at the mode wall', '#ff3a3a']); }
  } else if (G7.mode === 'monster') {
    if (G7.phase === 'intro' && G7.t > 3) G7.phase = 'play';
    for (const n of G7.npcs) { if (n.state === 'caught') continue; n.update(dt, t, { threat: head, nav: fac.nav, contact, hidingSpots: fac.hidingSpots });
      // caught by a monster hand or weapon
      const body = n.headPos().clone().add(V(0, -0.45, 0));
      const touch = ['L', 'R'].some(s => beastHandPos(s).distanceTo(body) < 0.6) || activeWeapons().some(w => w.headPoint.getWorldPosition(V()).distanceTo(body) < 0.6);
      if (G7.phase === 'play' && touch) catchNPC(n);
    }
    const left = G7.total - G7.caught; const tl = Math.max(0, G7.endT - G7.t);
    setWrist(`LEFT ${left}`, `${Math.floor(tl / 60)}:${String(Math.floor(tl % 60)).padStart(2, '0')}`, '#ff3a3a');
    if (G7.phase === 'play' && left <= 0) { G7.phase = 'won'; G7.t = 0; showBanner('ALL CAUGHT', 'You are the apex specimen', '#3dff7c', 5); }
    if (G7.phase === 'play' && tl <= 0) { G7.phase = 'lost'; G7.t = 0; showBanner('TIME UP', `${left} got away`, '#ff3a3a', 5); }
    if ((G7.phase === 'won' || G7.phase === 'lost') && G7.t > 5) backToLobby(G7.phase === 'won' ? ['YOU WIN', 'Be the Monster cleared', '#3dff7c'] : ['THEY GOT AWAY', 'Try again at the mode wall', '#ff3a3a']);
  }
}
// a caught gorilla turns into a gore gorilla you're holding: rip it, saw it, smash it
function catchNPC(n) {
  const pose = n.pose(); n.state = 'caught'; n.dispose(); G7.caught++;
  const a = gore.makeAvatar(); a.position.copy(pose.position); a.rotation.y = pose.yaw; a.scale.setScalar(DUMMY_SCALE);
  const d = { a, grow: 1, at: pose.position.clone(), respawn: 1e9 };
  const h = ['L', 'R'].map(s => handOf(s)).sort((x, y) => beastHandPos(sideOf(x)).distanceTo(pose.position) - beastHandPos(sideOf(y)).distanceTo(pose.position))[0];
  const L = pickUpDummy(d, null); const hv = h.vel.clone().setY(0); if (hv.length() > 3) hv.setLength(3);
  if (L) { L.vel.copy(hv).multiplyScalar(0.5).add(V(0, 1.2, 0)); L.spin.set(Math.random() * 3, Math.random() * 3, Math.random() * 3); }   // knocked over, stays nearby
  gore.sfx('crunch', 0.8); gore.spurt(pose.position.clone().add(V(0, 0.8, 0)), V(0, 1, 0), 20, 2.5); pulse(h, 1, 200);
  showBanner('CAUGHT!', 'Grab it with GRIP to rip it apart', '#ff3a3a', 1.6);
}
// the mode wall in the lobby: three big buttons
const MODES = [['sandbox', 'SANDBOX', '#3dff7c', 'you are here'], ['escape', 'ESCAPE', '#29c8ff', 'run from 3 monsters'], ['monster', 'BE THE MONSTER', '#ff3a3a', 'hunt the gorillas']];
const modeBtns = MODES.map(([id, label, col, sub], i) => {
  const x = -9.2, z = 4.8 + i * 1.6;
  box(x, 0.5, z, 0.5, 1.0, 0.5, mat('#2a2e33', { metalness: 0.5 }));
  const cap = add(new THREE.CylinderGeometry(0.17, 0.18, 0.07, 24), new THREE.MeshStandardMaterial({ color: col, emissive: col, emissiveIntensity: 0.6, roughness: 0.4 }), x, 1.04, z);
  sign(label, 1.3, 0.42, x + 0.02, 1.65, z, Math.PI / 2, { fg: col, sub });
  return { id, cap, pos: V(x, 1.08, z), armed: true };
});
sign('GAME MODES', 3.2, 0.7, -9.2, 2.6, 6.4, Math.PI / 2, { fg: '#ffd23a', sub: 'TOUCH A BUTTON' });
function updateModeWall(points) {
  if (G7.mode !== 'sandbox') return;
  for (const B of modeBtns) { const near = points.some(p => p.distanceTo(B.pos) < 0.16 * rig.scale.x);
    if (near && B.armed) { B.armed = false; B.cap.position.y = 1.01; hands.forEach(h => pulse(h, 0.6, 80)); if (B.id === 'sandbox') showBanner('SANDBOX', 'You are already here', '#3dff7c', 2); else startMode(B.id); }
    if (!points.some(p => p.distanceTo(B.pos) < 0.32 * rig.scale.x)) { B.armed = true; B.cap.position.y = 1.04; } }
}


// ---------------- desktop test views (no headset) ----------------
const info = document.getElementById('info');
const fake = { head: new THREE.Object3D(), pads: [0, 1].map(() => ({ buttons: Array.from({ length: 6 }, () => ({ value: 0, pressed: false, touched: false })) })), prev: {}, cycle: -1 };
scene.add(fake.head);
function fakeInputs(t, dt, H = V(0.6, +(new URLSearchParams(location.search).get('headY') || 1.45), 7.4)) { fake.head.position.copy(H); fake.head.rotation.set(-0.1 * Math.sin(t * 0.7), 0.25 * Math.sin(t * 0.5), 0, 'YXZ'); fake.head.updateMatrixWorld(true);
  const inp = {};
  for (const [s, sx, i] of [['L', 1, 0], ['R', -1, 1]]) {
    const pos = H.clone().add(V(-sx * 0.38, -0.5 + 0.12 * Math.sin(t * 2 + i), -0.45));
    if (VIEW === 'monster') pos.add(V(-sx * 0.25 * Math.sin(t * 1.3), 0.35 * Math.sin(t * 1.3 + i * 2), -0.2));
    const quat = new THREE.Quaternion().setFromEuler(new THREE.Euler(-0.5, 0, 0, 'YXZ'));
    const v = fake.prev[s] ? pos.clone().sub(fake.prev[s]).divideScalar(Math.max(dt, 1e-3)) : V(); fake.prev[s] = pos.clone();
    inp[s] = { pos, quat, gamepad: fake.pads[i], stuck: false, vel: v };
  }
  return inp;
}
function desktopView(t, dt, talk) {
  if (VIEW === 'cyber') {   // chainsaw on the left, hammer on the right, standing at the dummies; 1 s: the arms build; 5 s: rev + cut; 8 s: hammer swing
    if (info) info.style.display = 'none'; document.querySelectorAll('button').forEach(b => b.style.display = 'none');
    if (!me.root.visible) me.root.visible = true;
    if (!fake.cy && t > 0.8) { fake.cy = true; me.rip('L'); me.rip('R'); giveCyberArm('L', 'chainsaw'); giveCyberArm('R', 'hammer'); }
    const X = t < 9.5 ? 3 : 6; const H = V(X, 1.25, t < 9.5 ? -4.65 : -5.0);
    const inp = fakeInputs(t, dt, H);
    fake.head.rotation.set(-0.3, 0, 0, 'YXZ'); fake.head.updateMatrixWorld(true);
    // 5-8 s: the chainsaw (left) revs and sweeps through the dummy's neck and shoulder; 10.5 s: the hammer (right) comes down on the next dummy
    const sw = Math.max(0, t - 5);
    inp.L.pos.copy(V(X - 0.45 + 0.6 * Math.sin(sw * 1.6) ** 2, 1.32 - 0.4 * Math.min(1, Math.max(0, t - 6.5)), -5.42)); inp.L.quat.setFromEuler(new THREE.Euler(0.05, 0, Math.PI / 2, 'YXZ'));
    inp.L.gamepad.buttons[0].value = t > 5 && t < 9 ? 1 : 0;
    const k = sstep(10.4, 10.6, t); inp.R.pos.copy(V(X + 0.15, 1.75 - 0.75 * k, -5.4 - 0.4 * k)); inp.R.quat.setFromEuler(new THREE.Euler(0.9 - 1.9 * k, 0, 0, 'YXZ'));
    updateAvatar(fake.head, inp, dt, t, talk);
    for (const s of ['L', 'R']) inp[s].h = null;
    updateCyberArms(dt, t, inp, true); updateCyberWeapons(dt);
    updateDummies(dt, t, hittersFor(inp));
    camera.position.set(X + 1.3, 1.75, -3.6); camera.lookAt(X - 0.1, 0.95, -5.7);
    return;
  }
  if (VIEW === 'pod') {   // the choice panel in the regen pod
    if (info) info.style.display = 'none';
    camera.position.set(POD.x - 0.1, 1.35, POD.z + 0.1); camera.rotation.set(0, Math.PI, 0); camera.updateMatrixWorld(true);
    if (!fake.pod) { fake.pod = true; me.rip('R'); } updatePod(dt, t, camera.getWorldPosition(V())); updateDummies(dt, t, []); return;
  }
  if (VIEW === 'rip' || VIEW === 'monster') {
    if (info) info.style.display = 'none'; document.querySelectorAll('button').forEach(b => b.style.display = 'none');
    if (VIEW === 'monster' && mode !== 'monster') setMode('monster');
    const vv = new URLSearchParams(location.search).get('variant'); if (vv && beast.setVariant && beast.variant !== vv) beast.setVariant(vv);
    if (VIEW === 'rip' && !me.root.visible) me.root.visible = true;
    const inp = fakeInputs(t, dt);
    if (VIEW === 'rip') {  // 0-2 s normal, 2 s the right hand rips the left arm off and pulls it away, 4 s throws it, 5 s regrow
      const cyc = Math.floor(t / 15), ph = t % 15;
      if (cyc !== fake.cycle) { fake.cycle = cyc; fake.ripped = false; fake.thrown = false; fake.regrown = false; }
      if (ph > 2 && !fake.ripped) { fake.ripped = true; const fh = { mesh: new THREE.Object3D(), vel: V(), holding: null }; fake.fh = fh; fh.mesh.position.copy(inp.R.pos); fh.mesh.quaternion.copy(inp.R.quat); ripArm('L', fh); }
      if (fake.fh && ph > 2 && ph < 4) { inp.R.pos.add(V(0.35 * Math.min(1, (ph - 2) * 2), 0.15, 0.1)); fake.fh.mesh.position.copy(inp.R.pos); fake.fh.vel.set(0.6, 0.3, 0.2); }
      if (ph > 4 && !fake.thrown && fake.fh) { fake.thrown = true; fake.fh.vel.set(1.5, 2.5, 1.2); release(fake.fh); }
      if (ph > 5 && !fake.regrown) { fake.regrown = true; me.regrow('L'); podBusy = me.GROW_TIME || 8; }
    }
    updateAvatar(fake.head, inp, dt, t, talk);
    updateDummies(dt, t, hittersFor(inp));
    const A = new URLSearchParams(location.search).get('angle') || 'front';
    camera.position.copy({ front: V(0.6, 1.3, 5.0), side: V(2.8, 1.3, 6.9), hands: V(0.6, 1.15, 6.2) }[A] || V(0.6, 1.3, 5.0)); camera.lookAt(0.6, 1.1, 7.4);
    if (VIEW === 'monster') { camera.position.set(0.6, 2.0, 4.2); camera.lookAt(0.6, 1.3, 7.4); }
    if (VIEW === 'monster') updateCyberWeapons(dt);
    return;
  }
  if (VIEW === 'dummies') {   // every second: rip a head off, split one in half, or smash one
    if (info) info.style.display = 'none';
    camera.position.set(0, 1.8, -1.5); camera.lookAt(0, 0.9, -6);
    if (Math.floor(t) !== fake.cycle && t > 1.5) { fake.cycle = Math.floor(t); const d = dummies[fake.cycle % 5]; const kind = fake.cycle % 3;
      if (d.a && d.grow >= 1) { if (kind === 0 && d.a.userData.parts.Head) { const L = tearDummyPart(d, 'Head', null); if (L) L.vel.set((Math.random() - 0.5) * 2, 3.5, 2.5); }
        else smashDummy(d, V(Math.random() - 0.5, 0, 1), kind === 1); } }
    updateDummies(dt, t, []); return;
  }
  if (VIEW === 'escape' || VIEW === 'hunt') {   // start a mode and watch from above
    if (info) info.style.display = 'none';
    if (!fake.modeStarted && t > 1) { fake.modeStarted = true; startMode(VIEW === 'escape' ? 'escape' : 'monster'); }
    if (G7.fac) { const o = G7.fac.spawn; const cam = new URLSearchParams(location.search).get('cam');
      if (cam === 'top') { camera.position.set(o.x, 45, o.z + 0.01); camera.lookAt(o.x, 0, o.z); }
      else { // stand at the spawn at eye height and look at the closest NPC (you are the target in escape)
        camera.position.set(o.x, 1.35, o.z); const list = VIEW === 'escape' ? G7.monsters : G7.npcs.filter(n => n.state !== 'caught');
        const c = list.map(m => m.pos).sort((a, b) => a.distanceTo(camera.position) - b.distanceTo(camera.position))[0]; if (c) camera.lookAt(c.x, 1.0, c.z); } }
    updateModes(dt, t, 0); updateDummies(dt, t, []); return;
  }
  if (VIEW === 'slice') {   // close-up of real cuts: 1.5 s diagonal through the right forearm, 2.5 s through the head, 3.5 s diagonally through the torso, 5 s re-cut a piece on the floor
    if (info) info.style.display = 'none';
    const d = dummies[2]; const at = d.at; const P = (x, y, z) => V(at.x + x, y, at.z + z);
    const steps = [[1.5, 'Arm_R', P(-0.3, 0.55, 0), V(0.3, 1, 0.2)], [2.5, 'Head', P(0, 1.35, 0.05), V(0.2, 1, 0.6)], [3.5, 'Body', P(0, 0.85, 0), V(0.7, 1, 0.1)]];
    fake.sl = fake.sl || 0;
    if (fake.sl < steps.length && t > steps[fake.sl][0] && d.a && d.grow >= 1) { const [, name, pt, n] = steps[fake.sl]; fake.sl++;
      const r = gore.cutAvatar(d.a, name, new THREE.Plane().setFromNormalAndCoplanarPoint(n.normalize(), pt), V(0, 0, 0.3)); if (name === 'Body' && r) { d.a = null; d.respawn = 99; } gore.spurt(pt, n, 30, 3); }
    if (fake.sl === 3 && t > 5) { fake.sl = 4; const big = gore.pieces.filter(q => q.o.userData.lb && (q.o.userData.size ?? 1) > 0.3).sort((a, b) => (b.o.userData.size ?? 1) - (a.o.userData.size ?? 1))[0];
      if (big) { big.o.updateMatrixWorld(true); const c = big.o.getWorldPosition(V()); gore.cutLoose(big.o, new THREE.Plane().setFromNormalAndCoplanarPoint(V(1, 0.3, 0.5).normalize(), c)); } }
    camera.position.set(at.x + 0.9, 1.5, at.z + 1.5); camera.lookAt(at.x, 0.7, at.z);
    updateDummies(dt, t, []); return;
  }
  if (VIEW === 'carry') {   // 2.5 s grab dummy 3's body with the right hand and lift it, 5 s throw it; 7 s grab it off the floor, 8.5 s the left hand yanks it in half
    if (info) info.style.display = 'none';
    const [hl, hr] = [hands[0], hands[1]]; hl.handed = 'left'; hr.handed = 'right';
    for (const h of [hl, hr]) if (!h.gamepad) h.gamepad = { buttons: Array.from({ length: 6 }, () => ({ value: 0, pressed: false, touched: false })), hapticActuators: [] };
    const d3 = dummies[2].at; const sm = (a, b, x) => sstep(a, b, x);
    let pl = V(-1.0, 1.0, -4.0), pr = V(1.0, 1.0, -4.0), gl = 0, gr = 0;
    const body = V(d3.x, 0.95, d3.z + 0.12);
    if (t > 2 && t < 5.2) { pr = body.clone().lerp(V(d3.x + 0.3, 1.5, d3.z + 1.2), sm(3.0, 4.2, t)); if (t > 4.6) pr.add(V(0.8 * sm(4.6, 5.0, t), 0.2, 0.6 * sm(4.6, 5.0, t))); gr = t < 5.0 && t > 2.5 ? 1 : 0; }
    const L = looseDummies[0];
    if (t > 6.2 && L) { const at = L.limb.o.position; if (!fake.carryAt || t < 6.6) fake.carryAt = at.clone(); pr = fake.carryAt.clone().add(V(0, 0.05 + 0.5 * sm(7.0, 7.8, t), 0)); gr = t > 6.6 ? 1 : 0;
      if (t > 8.0) { const bc = L.a.userData.parts.Body ? L.a.userData.parts.Body.getWorldPosition(V()) : at; if (!fake.lAt) fake.lAt = bc.clone().add(V(-0.15, 0, 0.05)); pl = fake.lAt.clone().add(V(-0.5 * sm(8.6, 9.2, t), 0, 0)); gl = t > 8.2 ? 1 : 0; } }
    for (const [h, p, g] of [[hl, pl, gl], [hr, pr, gr]]) { const prev = h.mesh.position.clone(); h.mesh.position.copy(p); h.vel.copy(p).sub(prev).divideScalar(Math.max(dt, 1e-3)); h.gamepad.buttons[1].value = g; }
    updateRipping(dt);
    camera.position.set(2.0, 1.7, -1.6); camera.lookAt(0, 0.9, -5.0);
    updateDummies(dt, t, []); return;
  }
  if (VIEW === 'grab') {   // the real grab code with fake hands: 1.5 s grab dummy 3's head and pull; 4.5 s both hands pull dummy 4 apart; 7 s punch dummy 2
    if (info) info.style.display = 'none';
    const [hl, hr] = [hands[0], hands[1]]; hl.handed = 'left'; hr.handed = 'right';
    for (const h of [hl, hr]) if (!h.gamepad) h.gamepad = { buttons: Array.from({ length: 6 }, () => ({ value: 0, pressed: false, touched: false })), hapticActuators: [] };
    const d3 = dummies[2].at, d4 = dummies[3].at, d2 = dummies[1].at; const sm = (a, b, x) => sstep(a, b, x);
    let pl = V(-1.2, 1.2, -4.0), pr = V(1.2, 1.2, -4.0), gl = 0, gr = 0;
    if (t > 2 && t < 9) { const head = V(d3.x, 1.36, d3.z + 0.1); pr = head.clone().lerp(head.clone().add(V(0.25, 0.25, 1.1)), sm(3.0, 6.0, t)); if (t > 6.5) pr.add(V(0.25 * Math.sin((t - 6.5) * 9), 0, 0)); gr = t > 2.5 ? 1 : 0; }
    if (t > 9.5 && t < 12.5) { const body = V(d4.x, 0.8, d4.z + 0.13); const k = sm(10.5, 11.7, t); pl = body.clone().add(V(-0.15 - 0.3 * k, 0, 0.05)); pr = body.clone().add(V(0.15 + 0.3 * k, 0, 0.05)); gl = gr = t > 10 ? 1 : 0; }
    if (t > 13 && t < 15) { pr = V(d2.x + 0.6 - 1.2 * sm(13.5, 13.7, t), 0.85, d2.z + 0.1); }
    for (const [h, p, g] of [[hl, pl, gl], [hr, pr, gr]]) { const prev = h.mesh.position.clone(); h.mesh.position.copy(p); h.vel.copy(p).sub(prev).divideScalar(Math.max(dt, 1e-3)); h.gamepad.buttons[1].value = g; }
    updateRipping(dt);
    const inputs = { L: { pos: hl.mesh.position, vel: hl.vel, h: hl }, R: { pos: hr.mesh.position, vel: hr.vel, h: hr } };
    if (new URLSearchParams(location.search).get('cam') === 'side') { camera.position.set(d3.x + 1.9, 1.35, d3.z + 0.7); camera.lookAt(d3.x, 1.0, d3.z + 0.55); } else { camera.position.set(1.6, 1.5, -2.6); camera.lookAt(0.8, 0.9, -5.6); }
    updateDummies(dt, t, hittersFor(inputs)); return;
  }
  if (VIEW === 'head' || VIEW === 'split') {   // close-ups: a torn-off head held up, or a dummy cut in half
    if (info) info.style.display = 'none';
    const d = dummies[2];
    if (!fake.done && d.a && d.grow >= 1 && t > 1.2) { fake.done = true;
      if (VIEW === 'head') { const fh = { mesh: new THREE.Object3D(), vel: V(), holding: null }; fake.fh = fh; fh.mesh.position.set(0, 1.6, -5.2); const L = tearDummyPart(d, 'Head', fh); L.offset = new THREE.Matrix4(); }
      else { smashDummy(d, V(0, 0, 0.25), true); } }
    if (fake.fh) { fake.fh.mesh.position.set(0, 1.55, -4.9); fake.fh.mesh.rotation.set(0.15, t * 0.6, 0); }
    if (VIEW === 'head') { camera.position.set(0.15, 1.45, -4.0); camera.lookAt(0, 1.35, -4.9); } else { camera.position.set(0.9, 1.6, -3.2); camera.lookAt(0, 0.3, -5.6); }
    updateDummies(dt, t, []); return;
  }
  if (VIEW === 'spawn') { if (info) info.style.display = 'none'; const yaw = +(new URLSearchParams(location.search).get('yaw') || 0); camera.position.set(0, 1.4, 8); camera.rotation.set(-0.08, yaw, 0, 'YXZ'); updateDummies(dt, t, []); return; }
  // overview: drift slowly around the hall
  const a = t * 0.08; camera.position.set(Math.sin(a) * 9, 4.2, 2 + Math.cos(a) * 8); camera.lookAt(0, 1.2, -2);
  updateDummies(dt, t, []);
}

renderer.xr.addEventListener('sessionstart', () => { camera.position.set(0, 0, 0); camera.rotation.set(0, 0, 0); rig.position.set(0, 0, 8); vel.set(0, 0, 0); voice.start(); gore.audio(); me.root.visible = mode === 'gorilla'; if (info) info.style.display = 'none'; if (gore.G.level === 'full') noticeT = 0; });
renderer.xr.addEventListener('sessionend', () => { if (info) info.style.display = ''; });

const clock = new THREE.Clock();
renderer.setAnimationLoop(() => {
  const dt = Math.min(clock.getDelta(), 1 / 30); const t = clock.elapsedTime;
  const talk = voice.update(dt, t);
  if (renderer.xr.isPresenting) {
    updateScale(dt); step(dt); updateHands(dt); updateRipping(dt);
    const inputs = {}; for (const s of ['L', 'R']) { const h = handOf(s); inputs[s] = { pos: h.mesh.position, quat: h.mesh.quaternion, gamepad: h.gamepad, stuck: !!h.stuck, vel: h.vel, h }; }
    updateAvatar(camera, inputs, dt, t, talk);
    if (mode === 'gorilla') me.hideHead(true); else beast.head.visible = false;
    updateCyberArms(dt, t, inputs, mode === 'gorilla'); updateCyberWeapons(dt);
    updateDummies(dt, t, hittersFor(inputs));
    const pts = mode === 'monster' ? ['L', 'R'].map(beastHandPos) : hands.filter(canPush).map(h => h.mesh.position);
    updateButton(dt, t, pts); updateGoreSwitch(dt, pts); updateModeWall(pts); updateModes(dt, t, talk);
    updatePod(dt, t, camera.getWorldPosition(V()));
  } else {
    desktopView(t, dt, talk); updateButton(dt, t, []); if (VIEW !== 'pod') updatePod(dt, t, V(0, 0, 100));
  }
  updateLimbs(dt); gore.update(dt); updateSplats(dt); updateNotice(dt);
  flash.material.opacity = Math.max(0, flash.material.opacity - dt * 0.6);
  renderer.render(scene, camera);
});
document.getElementById('mic')?.addEventListener('click', async (e) => { e.target.textContent = (await voice.start()) ? 'Mic on: talk!' : 'No mic found'; });
window.GAME = { catchNPC, G7, startMode, backToLobby, looseDummies, cyber, giveCyberArm, openChoice, voice, mirror, me, beast, T, rig, hands, limbs, dummies, colliders, contact, scene, gore, setMode, ripArm, get mode() { return mode; }, get t() { return clock.elapsedTime; } };
