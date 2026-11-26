// Canopy Clearing: an original arm-movement VR prototype (WebXR + three.js).
// You have no legs: push your hands against the ground, walls and trees to move, fling yourself to jump.
import * as THREE from 'three';
import { VRButton } from './lib/VRButton.js';
import { makeMonster } from './monster.js';
import { initGore } from './gore.js';
import { createVoice, setMouth } from './talk.js';
import { makeGorilla } from './gorilla.js';
import { Reflector } from 'three/addons/objects/Reflector.js';

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
};

// ---------------- renderer, scene ----------------
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.setSize(innerWidth, innerHeight);
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.shadowMap.enabled = true;
renderer.xr.enabled = true;
renderer.xr.setReferenceSpaceType('local-floor');
document.body.appendChild(renderer.domElement);
document.body.appendChild(VRButton.createButton(renderer));
// When installed as a Quest app, the flat page isn't shown at all: go straight into VR on launch.
// The headset's VR system can take a moment to be ready, so keep trying every second until it works.
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
scene.background = new THREE.Color('#8fd0ff');
scene.fog = new THREE.Fog('#a8dcff', 25, 80);
scene.add(new THREE.HemisphereLight('#ffffff', '#4a7a35', 1.3));
const sun = new THREE.DirectionalLight('#fff4dd', 2.0); sun.position.set(12, 25, 8); sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048); sun.shadow.bias = -0.0005; sun.shadow.normalBias = 0.03; Object.assign(sun.shadow.camera, { left: -25, right: 25, top: 25, bottom: -25, near: 1, far: 70 }); scene.add(sun);

// the player rig: XR moves the camera and controllers inside it, physics moves the rig
const rig = new THREE.Group(); scene.add(rig);
const camera = new THREE.PerspectiveCamera(75, innerWidth / innerHeight, 0.03, 200); rig.add(camera);
camera.position.set(0, 1.4, 0);
addEventListener('resize', () => { camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix(); renderer.setSize(innerWidth, innerHeight); });

// ---------------- colliders ----------------
// every collider answers: closest point on its surface to p, and the outward normal there
const colliders = [];
const V = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z);
const tmp = V(), tmp2 = V();
function groundCol() { return { surf(p) { return { point: V(p.x, 0, p.z), normal: V(0, 1, 0), inside: p.y < 0 }; } }; }
function boxCol(min, max) {
  return { surf(p) {
    const inside = p.x > min.x && p.x < max.x && p.y > min.y && p.y < max.y && p.z > min.z && p.z < max.z;
    if (!inside) { const c = V(THREE.MathUtils.clamp(p.x, min.x, max.x), THREE.MathUtils.clamp(p.y, min.y, max.y), THREE.MathUtils.clamp(p.z, min.z, max.z)); const n = p.clone().sub(c); const l = n.length(); return { point: c, normal: l > 1e-6 ? n.divideScalar(l) : V(0, 1, 0), inside: false }; }
    // inside: push out through the nearest face
    const d = [p.x - min.x, max.x - p.x, p.y - min.y, max.y - p.y, p.z - min.z, max.z - p.z]; const i = d.indexOf(Math.min(...d));
    const pt = p.clone(), n = V(); ['x', 'x', 'y', 'y', 'z', 'z'].forEach((a, k) => { if (k === i) { pt[a] = k % 2 ? max[a] : min[a]; n[a] = k % 2 ? 1 : -1; } });
    return { point: pt, normal: n, inside: true };
  } };
}
function cylCol(cx, cz, R, y0, y1) {
  return { surf(p) {
    const dx = p.x - cx, dz = p.z - cz, d = Math.hypot(dx, dz); const yIn = p.y > y0 && p.y < y1;
    const nx = d > 1e-6 ? dx / d : 1, nz = d > 1e-6 ? dz / d : 0;
    if (yIn) return { point: V(cx + nx * R, p.y, cz + nz * R), normal: V(nx, 0, nz), inside: d < R };
    const y = p.y >= y1 ? y1 : y0; const rr = Math.min(d, R); const pt = V(cx + nx * rr, y, cz + nz * rr);
    if (d <= R) return { point: pt, normal: V(0, p.y >= y1 ? 1 : -1, 0), inside: false };
    const n = p.clone().sub(pt).normalize(); return { point: pt, normal: n, inside: false };
  } };
}
function sphereCol(c, R) { return { surf(p) { const n = p.clone().sub(c); const l = n.length() || 1e-6; n.divideScalar(l); return { point: c.clone().addScaledVector(n, R), normal: n, inside: l < R }; } }; }

// signed distance from a point to the nearest surface, plus where to put a sphere of radius r so it just touches it
function contact(p, r) {
  let best = null;
  for (const c of colliders) {
    const s = c.surf(p); const dist = s.inside ? -p.distanceTo(s.point) : p.distanceTo(s.point);
    if (!best || dist < best.dist) best = { dist, point: s.point, normal: s.normal };
  }
  best.rest = best.point.clone().addScaledVector(best.normal, r); // where a sphere of radius r rests on it
  return best;
}

// ---------------- the map (original): a forest clearing ----------------
const mat = (color, o = {}) => new THREE.MeshStandardMaterial({ color, roughness: 0.9, ...o });
const flat = (color) => new THREE.MeshStandardMaterial({ color, roughness: 1 });
const add = (geo, m, x, y, z) => { const o = new THREE.Mesh(geo, m); o.position.set(x, y, z); o.castShadow = o.receiveShadow = true; scene.add(o); return o; };
const grass = (() => { const c = document.createElement('canvas'); c.width = c.height = 256; const g = c.getContext('2d'); g.fillStyle = '#5fa046'; g.fillRect(0, 0, 256, 256);
  for (let i = 0; i < 1500; i++) { g.fillStyle = ['#6bb04f', '#549238', '#77ba58'][i % 3]; g.fillRect(Math.random() * 256, Math.random() * 256, 2, 5); }
  const t = new THREE.CanvasTexture(c); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(40, 40); t.colorSpace = THREE.SRGBColorSpace; return t; })();
const ground = add(new THREE.PlaneGeometry(200, 200), new THREE.MeshStandardMaterial({ map: grass, roughness: 1 }), 0, 0, 0); ground.rotation.x = -Math.PI / 2;
colliders.push(groundCol());

const box = (x, y, z, w, h, d, color) => { add(new THREE.BoxGeometry(w, h, d), mat(color), x, y, z); colliders.push(boxCol(V(x - w / 2, y - h / 2, z - d / 2), V(x + w / 2, y + h / 2, z + d / 2))); };
const tree = (x, z, R = 0.45, H = 7, leaf = '#2f7d32') => {
  add(new THREE.CylinderGeometry(R * 0.8, R, H, 10), mat('#7a5232'), x, H / 2, z); colliders.push(cylCol(x, z, R, 0, H));
  for (const [lx, ly, lz, r] of [[0, H + 0.6, 0, 2.4], [1.2, H - 0.4, 0.4, 1.7], [-1.1, H - 0.2, -0.5, 1.8]]) { add(new THREE.IcosahedronGeometry(r, 3), flat(leaf), x + lx, ly, z + lz); colliders.push(sphereCol(V(x + lx, ly, z + lz), r * 0.85)); }
};
const rock = (x, z, R) => { const m = add(new THREE.IcosahedronGeometry(R, 2), flat('#8b8f96'), x, R * 0.55, z); m.scale.y = 0.8; colliders.push(sphereCol(V(x, R * 0.55, z), R * 0.85)); };

// big central tree with a wooden ring deck to climb up to
tree(0, 0, 1.1, 10, '#347f34');
add(new THREE.CylinderGeometry(4, 4, 0.25, 32), mat('#a8743f'), 0, 4.5, 0); colliders.push(cylCol(0, 0, 4, 4.375, 4.625));
// step-up platforms and crates around it
box(5.5, 0.6, 2, 1.6, 1.2, 1.6, '#b07b45'); box(5.2, 1.7, 3.3, 1.4, 1.0, 1.4, '#9a6936'); box(4.2, 2.8, 4.0, 1.4, 1.0, 1.4, '#b07b45'); box(3.0, 3.8, 3.6, 1.4, 1.0, 1.4, '#9a6936');
box(-6, 0.9, -3, 3, 1.8, 0.3, '#8a6a45'); // a low wall to climb over
box(-8, 1.6, 4, 0.4, 3.2, 6, '#7d828a'); // a tall wall to climb
box(8, 2.4, -6, 4, 0.3, 4, '#a8743f'); box(9.6, 1.2, -4.4, 0.3, 2.4, 0.3, '#6b4a2b'); box(6.4, 1.2, -7.6, 0.3, 2.4, 0.3, '#6b4a2b'); box(9.6, 1.2, -7.6, 0.3, 2.4, 0.3, '#6b4a2b'); box(6.4, 1.2, -4.4, 0.3, 2.4, 0.3, '#6b4a2b');
box(3, 3.6, -6, 6, 0.25, 0.8, '#a8743f'); // plank bridge from the tree deck to the platform
for (const [x, z, R] of [[-4, 6, 1.2], [7, 7, 1.6], [-9, -8, 1.4], [2, -10, 1.0], [11, 1, 1.1]]) rock(x, z, R);
// a ring of forest at the edge
for (let i = 0; i < 26; i++) { const a = i / 26 * Math.PI * 2, r = 16 + (i % 3) * 3; tree(Math.cos(a) * r, Math.sin(a) * r, 0.4 + (i % 2) * 0.15, 6 + (i % 4)); }
for (const [x, z] of [[-11, 2], [10, 10], [-3, -13], [13, -9]]) tree(x, z, 0.5, 7);

// ---------------- bananas to collect ----------------
const bananaGeo = new THREE.TorusGeometry(0.14, 0.045, 8, 16, Math.PI * 0.9);
const bananaMat = new THREE.MeshStandardMaterial({ color: '#ffd83a', emissive: '#6b5200', roughness: 0.5 });
const bananaSpots = [[0, 5.0, 3.2], [3.0, 4.6, 3.6], [8, 3.0, -6], [-8, 3.6, 4], [-6, 2.2, -3], [7, 3.4, 7], [-4, 2.8, 6], [0, 12.0, 0.2], [11, 2.6, 1], [-9, 3.2, -8], [5.5, 1.6, 2], [2, 2.2, -10]];
const bananas = bananaSpots.map(([x, y, z]) => { const b = add(bananaGeo, bananaMat, x, y, z); b.userData.base = y; return b; });
let collected = 0;

// ---------------- hands ----------------
const HAND_C = '#4a3021', PALM_C = '#c49372'; // the ape's fur and palms
const handMat = new THREE.MeshStandardMaterial({ color: HAND_C, roughness: 0.95 });
const palmMat = new THREE.MeshStandardMaterial({ color: PALM_C, roughness: 0.9 });
const makeHand = () => { const g = new THREE.Group(); const b = new THREE.Mesh(new THREE.SphereGeometry(T.handRadius, 16, 12), handMat); b.castShadow = true; g.add(b);
  const p = new THREE.Mesh(new THREE.SphereGeometry(T.handRadius * 0.75, 12, 8), palmMat); p.scale.set(1, 0.4, 1); p.position.y = -T.handRadius * 0.55; g.add(p); scene.add(g); return g; };
const hands = [0, 1].map(i => ({ grip: renderer.xr.getControllerGrip(i), mesh: makeHand(), stuck: null, gamepad: null, handed: null }));
hands.forEach(h => { rig.add(h.grip); h.grip.addEventListener('connected', e => { h.gamepad = e.data.gamepad; h.handed = e.data.handedness; }); h.grip.addEventListener('disconnected', () => { h.gamepad = null; }); });

// banana counter on the left wrist
const counter = (() => { const c = document.createElement('canvas'); c.width = 256; c.height = 128; const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace;
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: t, depthTest: false, transparent: true })); s.scale.set(0.16, 0.08, 1); s.renderOrder = 5; scene.add(s);
  const draw = () => { const g = c.getContext('2d'); g.clearRect(0, 0, 256, 128); g.fillStyle = 'rgba(20,20,20,0.7)'; g.beginPath(); g.roundRect(4, 4, 248, 120, 24); g.fill();
    g.fillStyle = '#ffd83a'; g.font = '900 64px Arial'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(`${collected}/${bananas.length}`, 128, 68); t.needsUpdate = true; };
  draw(); return { s, draw }; })();

// ---------------- the movement ----------------
const vel = V(); const history = []; let wasTouching = false; let turnLatch = false;
const handWorld = (h) => h.grip.getWorldPosition(V());

function step(dt) {
  rig.updateMatrixWorld(true);
  let move = V(), n = 0;
  const head = camera.getWorldPosition(V());
  for (const h of hands) {
    if (!h.gamepad && !renderer.xr.isPresenting) continue;
    const tracked = handWorld(h);
    if (h.stuck) {
      const c = contact(tracked, T.handRadius);
      const tooFar = h.stuck.distanceTo(head) > T.maxArmReach;
      const away = tracked.clone().sub(h.stuck).dot(h.normal);                       // how far the real hand moved off the surface
      if (away > 0.004 || c.dist > T.handRadius + T.releaseSlack || tooFar) h.stuck = null;   // lifting off lets go right away
      else { move.add(h.stuck.clone().sub(tracked)); n++; }                         // still pressing: hand stays put, body moves
    } else {
      const c = contact(tracked, T.handRadius);
      if (c.dist < T.handRadius + T.touchSlack) {                                   // touched something: grab that spot
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
    if (wasTouching && history.length) {                                           // just let go: fling
      vel.set(0, 0, 0); history.forEach(v => vel.add(v)); vel.divideScalar(history.length).multiplyScalar(T.jumpMultiplier);
      if (vel.length() > T.maxJumpSpeed) vel.setLength(T.maxJumpSpeed);
    }
    wasTouching = false; history.length = 0;
    vel.y -= T.gravity * dt; rig.position.addScaledVector(vel, dt);
  }
  // keep the head out of solid things
  rig.updateMatrixWorld(true);
  const hp = camera.getWorldPosition(V()); const hc = contact(hp, T.headRadius);
  if (hc.dist < T.headRadius) { rig.position.add(hc.rest.clone().sub(hp)); const into = vel.dot(hc.normal); if (into < 0) vel.addScaledVector(hc.normal, -into); }
  if (rig.position.y < -30) { rig.position.set(0, 0, 8); vel.set(0, 0, 0); }       // fell off the world
  snapTurn();
}

function snapTurn() {
  const right = hands.find(h => h.handed === 'right'); const ax = right?.gamepad?.axes?.[2] ?? 0;
  if (Math.abs(ax) < 0.3) { turnLatch = false; return; } if (turnLatch || Math.abs(ax) < 0.7) return; turnLatch = true;
  const head = camera.getWorldPosition(V()); const a = -Math.sign(ax) * T.snapTurn;
  rig.position.sub(head).applyAxisAngle(V(0, 1, 0), a).add(head); rig.rotation.y += a;
  hands.forEach(h => { if (h.stuck) h.stuck = null; });
}
function pulse(h, strength, ms) { try { h.gamepad?.hapticActuators?.[0]?.pulse(strength, ms); } catch (e) {} }

function updateHands() {
  rig.updateMatrixWorld(true);
  for (const h of hands) {
    const p = h.stuck ? h.stuck : handWorld(h); h.mesh.position.copy(p); h.mesh.visible = renderer.xr.isPresenting && !me;
    h.grip.getWorldQuaternion(h.mesh.quaternion);
  }
  const left = hands.find(h => h.handed === 'left') || hands[0];
  counter.s.visible = renderer.xr.isPresenting; counter.s.position.copy(left.mesh.position).add(V(0, 0.12, 0));
}

function updateBananas(t) {
  const pts = hands.map(h => h.mesh.position).concat([camera.getWorldPosition(V())]);
  for (const b of bananas) {
    if (!b.visible) continue; b.rotation.y = t * 1.5; b.position.y = b.userData.base + Math.sin(t * 2 + b.position.x) * 0.08;
    if (renderer.xr.isPresenting && pts.some(p => p.distanceTo(b.position) < 0.3)) { b.visible = false; collected++; counter.draw(); hands.forEach(h => pulse(h, 0.6, 80)); }
  }
}

// ---------------- horror: the Hollow Grin (an original monster) ----------------
const monster = Object.assign(makeMonster(scene), { state: 'hunt', timer: 0, speed: 2.0 });

// blood splatter decals (a few splat shapes drawn once, reused)
const splatTex = [0, 1, 2].map(seed => { const c = document.createElement('canvas'); c.width = c.height = 256; const g = c.getContext('2d'); let s = seed * 97 + 13; const r = () => (s = (s * 16807) % 2147483647) / 2147483647;
  // an irregular pool made of overlapping blobs, a few streaks thrown one way, and droplets that shrink with distance
  const blob = (x, y, rad, col) => { g.fillStyle = col; g.beginPath(); for (let k = 0; k <= 40; k++) { const a = k / 40 * Math.PI * 2, rr = rad * (0.85 + r() * 0.2); g.lineTo(x + Math.cos(a) * rr, y + Math.sin(a) * rr); } g.fill(); };
  for (let i = 0; i < 9; i++) blob(128 + (r() - 0.5) * 60, 128 + (r() - 0.5) * 60, 22 + r() * 26, i % 2 ? '#5c0006' : '#6e0009');
  const throwA = r() * 6.28;
  for (let i = 0; i < 5; i++) { const a = throwA + (r() - 0.5) * 0.9, len = 50 + r() * 60; for (let s = 0; s < 1; s += 0.08) blob(128 + Math.cos(a) * len * s, 128 + Math.sin(a) * len * s, (1 - s) * 9 + 2, '#640007'); }
  for (let i = 0; i < 40; i++) { const a = r() * 6.28, d = 55 + r() * 70; blob(128 + Math.cos(a) * d, 128 + Math.sin(a) * d, Math.max(1.5, 9 - d / 16) * (0.5 + r()), '#600006'); }
  blob(118, 118, 20, 'rgba(150,20,30,0.45)');                                            // wet highlight
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t; });
const splats = [];
function addSplat(pos, normal, size) {
  const m = new THREE.Mesh(new THREE.PlaneGeometry(size, size), new THREE.MeshStandardMaterial({ map: splatTex[splats.length % 3], transparent: true, roughness: 0.25, metalness: 0.1, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2 }));
  m.position.copy(pos).addScaledVector(normal, 0.01); m.lookAt(pos.clone().add(normal)); m.rotateZ(Math.random() * 6.28); scene.add(m); splats.push(m);
  if (splats.length > 40) scene.remove(splats.shift());
}
// Scruff, the player critter, and the tear-apart when you're caught
const gore = await initGore(scene, addSplat);
const voice = createVoice(); if (/faketalk/.test(location.search)) voice.setFake(true);
let me = null; // your own gorilla body in VR (seen in the mirror, and your arms when you look down)
// a mirror by the spawn point, so you can see your ape talk
const mirror = new Reflector(new THREE.PlaneGeometry(2.4, 2.6), { textureWidth: 1024, textureHeight: 1024, color: 0xc4ccd0 });
mirror.position.set(-3.2, 1.45, 8.3); mirror.rotation.y = Math.PI / 2; scene.add(mirror);
add(new THREE.BoxGeometry(0.12, 2.9, 2.7), mat('#6b4a2b'), -3.27, 1.45, 8.3); colliders.push(boxCol(V(-3.33, 0, 6.95), V(-3.21, 2.9, 9.65)));
{ const before = mirror.onBeforeRender; mirror.onBeforeRender = (r, sc, c) => { if (me) me.hideHead(false); before(r, sc, c); if (me && renderer.xr.isPresenting) me.hideHead(true); }; }
let dummy = null; const DUMMY_AT = V(0.6, 0, 7.4);
function placeDummy() { if (dummy) return; dummy = gore.makeAvatar(); dummy.position.copy(DUMMY_AT); dummy.rotation.y = Math.PI; }
function tearApart() {
  const M = monster; const push = V(Math.sin(M.g.rotation.y), 0, Math.cos(M.g.rotation.y));
  if (renderer.xr.isPresenting) {
    const head = camera.getWorldPosition(V()); const yaw = Math.atan2(-camera.getWorldDirection(V()).x, -camera.getWorldDirection(V()).z);
    const a = gore.makeAvatar(); a.position.set(head.x, Math.max(0, head.y - 1.3), head.z); a.rotation.y = yaw + Math.PI; gore.dismember(a, push);
    rig.position.addScaledVector(push, 2.6).add(V(0, 1.4, 0)); vel.set(0, 0, 0); hands.forEach(h => h.stuck = null); // knocked back: watch it happen
  } else if (dummy) { gore.dismember(dummy, push); dummy = null; }
  if (me) me.root.visible = false;
}
// red flash: an inside-out sphere around your head
const flash = new THREE.Mesh(new THREE.SphereGeometry(0.25, 16, 12), new THREE.MeshBasicMaterial({ color: '#b00010', side: THREE.BackSide, transparent: true, opacity: 0, depthTest: false }));
flash.renderOrder = 20; camera.add(flash);
let bloodyHands = 0;
const SPAWNS = [V(-14, 0, -14), V(14, 0, -12), V(-13, 0, 12), V(15, 0, 10)];
const playerHead = () => (!renderer.xr.isPresenting && dummy) ? dummy.userData.parts.Head.getWorldPosition(V()).add(V(0, 0.15, 0)) : camera.getWorldPosition(V());
function respawnMonster() { if (!renderer.xr.isPresenting) { monster.g.position.set(-2.5, 0, -2); monster.state = 'hunt'; monster.timer = 0; return; } const p = playerHead(); const s = SPAWNS.slice().sort((a, b) => b.distanceTo(p) - a.distanceTo(p))[0]; monster.g.position.copy(s); monster.state = 'hunt'; monster.timer = 0; }
respawnMonster();

function updateMonster(dt, t) {
  const M = monster, head = playerHead(); const flat = V(head.x, 0, head.z); const to = flat.clone().sub(M.g.position); const dist = to.length();
  M.timer += dt;
  // crawl-walk cycle: knuckles and hind legs swing in turn, head swaying, jaw working
  const w = t * 5.5, L = M.LEAN;
  M.torso.rotation.x = L; M.torso.position.y = M.HIP + Math.abs(Math.sin(w)) * 0.05;
  M.legs.forEach((l, i) => l.rotation.x = Math.sin(w + i * Math.PI) * 0.45);
  M.arms.forEach((a, i) => { a.sh.rotation.set(-L - 0.1 + Math.sin(w + i * Math.PI + Math.PI) * 0.45, 0, (i ? 1 : -1) * 0.14); a.el.rotation.x = -0.35; });
  M.head.rotation.set(-(L + M.NECK) + 0.3 + Math.sin(t * 7) * 0.05, Math.sin(t * 1.3) * 0.3, Math.sin(t * 11) * 0.05);
  M.jaw.rotation.x = 0.08 + 0.05 * Math.sin(t * 3);
  M.eyes.forEach(e => e.material.emissiveIntensity = 1.8 + Math.sin(t * 9) * 0.6);
  if (M.state === 'hunt') {
    if (dist > 0.01) { M.g.rotation.y = Math.atan2(to.x, to.z); M.g.position.addScaledVector(to.normalize(), Math.min(dist, M.speed * dt)); }
    const body = contact(M.g.position.clone().setY(1.0), 0.45); if (body.dist < 0.45) M.g.position.add(body.rest.clone().setY(1.0).sub(M.g.position.clone().setY(1.0)).setY(0)); // slide around trees and walls
    if (head.distanceTo(M.g.position.clone().setY(Math.min(head.y, 2.4))) < 1.1 && head.y < 3.2) catchPlayer();
  } else if (M.state === 'lunge') {                                       // jump scare: it rears up into your face, arms wide
    // it bends down so its face ends up right in front of yours, arms spread wide, jaw dropping open
    const k = 1 - Math.pow(1 - Math.min(1, M.timer / 0.3), 3); const lean = M.LEAN + 0.45 * k;
    M.torso.rotation.x = lean; M.torso.position.y = M.HIP - 0.05 * k; M.legs.forEach(l => l.rotation.x = 0.2 * k);
    M.arms.forEach((a, i) => { a.sh.rotation.set(-lean - 0.15 - 1.1 * k, 0, (i ? 1 : -1) * (0.14 + 0.9 * k)); a.el.rotation.x = -0.35 - 0.6 * k; });
    M.head.rotation.set(-(lean + M.NECK) + 0.2, 0, Math.sin(t * 40) * 0.07); M.jaw.rotation.x = 0.1 + 0.7 * k;
    M.g.rotation.y = Math.atan2(head.x - M.g.position.x, head.z - M.g.position.z);
    if (M.timer > 0.4 && !M.torn) { M.torn = true; tearApart(); }
    if (M.timer > 1.6) { M.state = 'gone'; M.timer = 0; M.g.visible = false; if (renderer.xr.isPresenting) { rig.position.set(0, 0, 8); vel.set(0, 0, 0); hands.forEach(h => h.stuck = null); } }
  } else if (M.state === 'gone' && M.timer > 4.5) { M.g.visible = true; M.torn = false; if (!renderer.xr.isPresenting) placeDummy(); if (me) me.root.visible = true; respawnMonster(); }
  // fades
  flash.material.opacity = Math.max(0, flash.material.opacity - dt * 0.45);
  bloodyHands = Math.max(0, bloodyHands - dt * 0.08); handMat.color.set(HAND_C).lerp(new THREE.Color('#7a0008'), Math.min(1, bloodyHands)); palmMat.color.set(PALM_C).lerp(new THREE.Color('#8a0010'), Math.min(1, bloodyHands));
}
function catchPlayer() {
  const M = monster; M.state = 'lunge'; M.timer = 0; M.drips.forEach(d => d.visible = true); M.arms.forEach(a => a.bl.visible = true);
  flash.material.opacity = renderer.xr.isPresenting ? 0.42 : 0; bloodyHands = 1.4; hands.forEach(h => pulse(h, 1.0, 400));
  const head = playerHead(); const feet = V(head.x, 0, head.z);
  const away = M.g.position.clone().sub(feet).setY(0); if (away.lengthSq() < 1e-4) away.set(0, 0, -1); M.g.position.copy(feet).addScaledVector(away.normalize(), 2.0 + Math.max(0, head.y - 1.4) * 0.6);
  for (let i = 0; i < 7; i++) { const a = Math.random() * 6.28, d = 0.3 + Math.random() * 1.2; addSplat(feet.clone().add(V(Math.cos(a) * d, 0, Math.sin(a) * d * 0.6 - 0.5)), V(0, 1, 0), 0.6 + Math.random() * 1.1); }
  for (let i = 0; i < 3; i++) { const dir = V(Math.random() - 0.5, 0.15, Math.random() - 0.5).normalize(); const c = contact(head.clone().addScaledVector(dir, 2.5), 0); if (c.dist < 1.2) addSplat(c.point, c.normal, 0.5 + Math.random() * 0.6); }
}

// ---------------- desktop preview (no headset): watch the monster hunt the camera ----------------
const info = document.getElementById('info');
const demoCam = { pos: V(3.6, 2.1, 11.2) };
const VIEW = new URLSearchParams(location.search).get('view');   // preview helpers: ?view=face or ?view=mirror
function desktopPreview(t) {
  if (VIEW && VIEW !== 'gorilla' && dummy) { monster.g.position.set(-15, 0, -15); monster.state = 'hunt'; monster.speed = 0; dummy.rotation.y = VIEW === 'face' ? 0.25 : -0.9;
    if (VIEW === 'face') { camera.position.set(DUMMY_AT.x + 0.35, 1.3, DUMMY_AT.z + 1.25); camera.lookAt(DUMMY_AT.x, 1.15, DUMMY_AT.z); }
    else { camera.position.set(1.6, 1.6, 10.6); camera.lookAt(-3.2, 1.2, 8.0); }
    return; }
  camera.position.copy(demoCam.pos);
  const target = DUMMY_AT.clone().setY(1.0); if (monster.g.visible && monster.state === 'hunt') target.lerp(monster.g.position.clone().setY(1.4), 0.35);
  camera.lookAt(target);
}
// ?view=gorilla : the player gorilla driven by a fake headset + controllers (for checking arms, wrists and fingers on a PC)
let gp = null;
function gorillaPreview(t, dt, talk) {
  if (!gp) { gp = { head: new THREE.Object3D(), me: makeGorilla(scene), pads: [0, 1].map(() => ({ buttons: Array.from({ length: 6 }, () => ({ value: 0, pressed: false, touched: false })) })) };
    if (dummy) { scene.remove(dummy); dummy = null; } monster.g.position.set(-15, 0, -15); monster.speed = 0; scene.add(gp.head); if (info) info.style.display = 'none'; document.querySelectorAll('button').forEach(b => b.style.display = 'none'); }
  const H = V(0.6, 1.45, 7.4); gp.head.position.copy(H); gp.head.rotation.set(-0.15 * Math.sin(t * 0.7), 0.3 * Math.sin(t * 0.5), 0, 'YXZ'); gp.head.updateMatrixWorld(true);
  const phase = Math.floor(t / 2.5) % 4;                    // 0 open, 1 fist, 2 point, 3 brace on a surface
  const mk = (sx, i) => { const p = gp.pads[i]; const b = p.buttons;
    b[0].value = phase === 1 ? 1 : 0; b[1].value = phase === 1 || phase === 2 ? 1 : 0; b[3].touched = phase === 1 || phase === 2;
    const pos = H.clone().add(V(-sx * 0.38, -0.55 + 0.12 * Math.sin(t * 2 + i), -0.42));
    const quat = new THREE.Quaternion().setFromEuler(new THREE.Euler(phase === 3 ? -1.4 : -0.5, 0, 0, 'YXZ'));
    return { pos, quat, gamepad: p, stuck: phase === 3 }; };
  gp.me.update({ camera: gp.head, hands: { L: mk(1, 0), R: mk(-1, 1) }, talk, dt });
  const VA = new URLSearchParams(location.search).get('angle') || 'front';
  const camAt = { front: V(0.6, 1.3, 5.0), side: V(2.8, 1.3, 6.9), hands: V(0.6, 1.15, 6.2) }[VA] || V(0.6, 1.3, 5.0);
  camera.position.copy(camAt); camera.lookAt(0.6, VA === 'hands' ? 0.9 : 1.1, 7.4);
}
placeDummy();
renderer.xr.addEventListener('sessionstart', () => { camera.position.set(0, 0, 0); camera.rotation.set(0, 0, 0); rig.position.set(0, 0, 8); vel.set(0, 0, 0); respawnMonster(); if (dummy) { scene.remove(dummy); dummy = null; } voice.start(); if (!me) me = makeGorilla(scene); me.root.visible = true; if (info) info.style.display = 'none'; });
renderer.xr.addEventListener('sessionend', () => { if (info) info.style.display = ''; });

const clock = new THREE.Clock();
renderer.setAnimationLoop(() => {
  const dt = Math.min(clock.getDelta(), 1 / 30); const t = clock.elapsedTime;
  if (renderer.xr.isPresenting) { step(dt); updateHands(); } else if (VIEW !== 'gorilla') desktopPreview(t);
  updateMonster(dt, t); gore.update(dt);
  const talk = voice.update(dt, t);
  if (me && renderer.xr.isPresenting && me.root.visible) {
    const side = (name, i) => { const h = hands.find(x => x.handed === name) || hands[i]; return { pos: h.mesh.position, quat: h.mesh.quaternion, gamepad: h.gamepad, stuck: !!h.stuck }; };
    me.update({ camera, hands: { L: side('left', 0), R: side('right', 1) }, talk, dt });
    me.hideHead(true);                                   // your own head stays out of your eyes (the mirror shows it)
  } else if (VIEW === 'gorilla') gorillaPreview(t, dt, talk);
  if (dummy) setMouth(dummy, talk);
  updateBananas(t);
  renderer.render(scene, camera);
});
document.getElementById('mic')?.addEventListener('click', async (e) => { e.target.textContent = (await voice.start()) ? 'Mic on: talk!' : 'No mic found'; });
window.GAME = { voice, mirror, get me() { return me; },  T, rig, hands, colliders, contact, scene, monster, flash, splats, gore }; // for debugging from the console
