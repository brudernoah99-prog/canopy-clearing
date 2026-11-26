// Weapons for the player-monster's custom variants (used by monster.js):
//  - makeBoneHammer(): an organic sledge grown out of its right arm: knobbly cracked bone, torn flesh and sinew at the base, fur, spikes, blood
//  - makeArmSaw():    a mechanical chainsaw that lives inside its right forearm and slides out through the split-open hand
// Both are built along +Y (the way the fingers point) with +Z the palm side; monster.js places them at the wrist each frame.
import * as THREE from 'three';

const V = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z);
const canvasTex = (w, h, draw) => { const c = document.createElement('canvas'); c.width = w; c.height = h; draw(c.getContext('2d'), w, h); const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.wrapS = t.wrapT = THREE.RepeatWrapping; return t; };
let seed = 7; const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;

// ---------- shared: sparks / steam puffs ----------
function makeParticles(scene, color, size, N = 60, additive = true) {
  const pos = new Float32Array(N * 3).fill(-99), vel = Array.from({ length: N }, () => V()), life = new Float32Array(N);
  const geo = new THREE.BufferGeometry(); geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  const pts = new THREE.Points(geo, new THREE.PointsMaterial({ color, size, transparent: true, opacity: additive ? 1 : 0.55, depthWrite: false, blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending }));
  pts.frustumCulled = false; scene.add(pts); let i = 0;
  return {
    emit(at, n, spread = 3, up = 2.5, grav = 9.8) { for (let k = 0; k < n; k++) { i = (i + 1) % N; pos.set([at.x, at.y, at.z], i * 3); vel[i].set((rnd() - 0.5) * spread, rnd() * up, (rnd() - 0.5) * spread); vel[i].grav = grav; life[i] = 0.35 + rnd() * 0.4; } },
    update(dt) { for (let k = 0; k < N; k++) { if (life[k] <= 0) { pos[k * 3 + 1] = -99; continue; } life[k] -= dt; vel[k].y -= (vel[k].grav ?? 9.8) * dt; pos[k * 3] += vel[k].x * dt; pos[k * 3 + 1] += vel[k].y * dt; pos[k * 3 + 2] += vel[k].z * dt; } geo.attributes.position.needsUpdate = true; },
    dispose() { scene.remove(pts); },
  };
}

// ---------- BONE HAMMER ----------
const boneTex = canvasTex(256, 256, (g, w, h) => {
  g.fillStyle = '#d9ccb0'; g.fillRect(0, 0, w, h);
  for (let i = 0; i < 900; i++) { g.fillStyle = ['#cbbd9f', '#e4d9c2', '#bfae8e'][i % 3]; g.fillRect(rnd() * w, rnd() * h, 2 + rnd() * 3, 2 + rnd() * 3); }
  g.strokeStyle = 'rgba(70,45,30,0.75)'; g.lineWidth = 1.6;                                    // cracks
  for (let i = 0; i < 14; i++) { let x = rnd() * w, y = rnd() * h; g.beginPath(); g.moveTo(x, y); for (let k = 0; k < 7; k++) { x += (rnd() - 0.5) * 34; y += (rnd() - 0.5) * 34; g.lineTo(x, y); } g.stroke(); }
  g.fillStyle = 'rgba(110,8,12,0.55)';                                                          // old blood
  for (let i = 0; i < 10; i++) { g.beginPath(); g.ellipse(rnd() * w, rnd() * h, 6 + rnd() * 22, 4 + rnd() * 10, rnd() * 3, 0, 7); g.fill(); }
});
const boneMat = new THREE.MeshStandardMaterial({ map: boneTex, roughness: 0.6, metalness: 0.02 });
const fleshMat = new THREE.MeshStandardMaterial({ color: '#7d1219', roughness: 0.32, emissive: '#1a0003' });
const fleshLight = new THREE.MeshStandardMaterial({ color: '#b03a42', roughness: 0.35 });
const sinewMat = new THREE.MeshStandardMaterial({ color: '#d8b8a8', roughness: 0.45 });
const furMat = new THREE.MeshStandardMaterial({ color: '#2a1c19', roughness: 0.95 });
const bloodMat = new THREE.MeshStandardMaterial({ color: '#6a0008', roughness: 0.12, metalness: 0.15 });
// bumpy geometry: push vertices in/out with a few sine "knobs"
function knobbly(geo, amt, freq = 9) {
  const p = geo.attributes.position, v = V();
  for (let i = 0; i < p.count; i++) { v.fromBufferAttribute(p, i); const n = Math.sin(v.x * freq + 1.3) * Math.sin(v.y * freq * 1.3 + 0.7) * Math.sin(v.z * freq * 0.9 + 2.1);
    const r = Math.hypot(v.x, v.z) || 1; const k = 1 + amt * (n + 0.35 * Math.sin((v.x + v.z) * freq * 2.7)); p.setXYZ(i, v.x * k, v.y + amt * 0.3 * n * r, v.z * k); }
  geo.computeVertexNormals(); return geo;
}
export function makeBoneHammer(scene) {
  const root = new THREE.Group();
  const m = (geo, mat, x = 0, y = 0, z = 0) => { const o = new THREE.Mesh(geo, mat); o.position.set(x, y, z); o.castShadow = true; root.add(o); return o; };
  // the base: where the hammer bursts out of the wrist - torn flesh, sinew strands, fur clumps
  m(knobbly(new THREE.CylinderGeometry(0.075, 0.095, 0.12, 14, 3), 0.12, 30), fleshMat, 0, 0.03, 0);
  m(knobbly(new THREE.SphereGeometry(0.085, 14, 10), 0.1, 26), fleshLight, 0, 0.09, 0).scale.set(1, 0.6, 1);
  for (let i = 0; i < 9; i++) { const a = i / 9 * Math.PI * 2; const c = m(new THREE.ConeGeometry(0.03, 0.11, 5), furMat, Math.cos(a) * 0.085, 0.0, Math.sin(a) * 0.085); c.rotation.set(Math.sin(a) * 0.9, 0, -Math.cos(a) * 0.9); c.rotateX(Math.PI); }
  for (let i = 0; i < 6; i++) { const a = rnd() * 6.28, r0 = 0.06, pts = [V(Math.cos(a) * r0, 0.04, Math.sin(a) * r0), V(Math.cos(a) * 0.045, 0.13, Math.sin(a) * 0.045), V(Math.cos(a + 0.5) * 0.03, 0.22 + rnd() * 0.05, Math.sin(a + 0.5) * 0.03)];
    m(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 12, 0.008 + rnd() * 0.005, 6), i % 2 ? sinewMat : fleshMat); }
  // the shaft: a thick, ridged bone
  m(knobbly(new THREE.CylinderGeometry(0.042, 0.055, 0.3, 12, 6), 0.1, 22), boneMat, 0, 0.22, 0);
  // the head: a huge knobbly bone sledge across the end (striking faces toward palm and back)
  const head = m(knobbly(new THREE.CylinderGeometry(0.125, 0.115, 0.42, 18, 6), 0.11, 11), boneMat, 0, 0.43, 0); head.rotation.x = Math.PI / 2;
  for (const z of [-0.21, 0.21]) { const cap = m(knobbly(new THREE.SphereGeometry(0.12, 16, 10), 0.08, 14), boneMat, 0, 0.43, z); cap.scale.set(1, 1, 0.45); }
  // bone spikes on top and sides
  for (const [x, y, z, rx, rz, h] of [[0, 0.56, 0.05, 0, 0, 0.12], [0, 0.55, -0.1, -0.3, 0, 0.1], [0.11, 0.47, 0.12, 0, -1.2, 0.09], [-0.11, 0.47, -0.05, 0, 1.2, 0.1], [0.1, 0.4, -0.14, 0.4, -1.4, 0.08]]) {
    const s = m(new THREE.ConeGeometry(0.022, h, 7), boneMat, x, y, z); s.rotation.set(rx, 0, rz); }
  // flesh still clinging where the shaft meets the head, and blood dripping
  m(knobbly(new THREE.TorusGeometry(0.06, 0.03, 8, 16), 0.15, 30), fleshMat, 0, 0.33, 0).rotation.x = Math.PI / 2;
  for (let i = 0; i < 6; i++) { const b = m(new THREE.SphereGeometry(0.025 + rnd() * 0.02, 8, 6), bloodMat, (rnd() - 0.5) * 0.2, 0.36 + rnd() * 0.12, (rnd() - 0.5) * 0.4); b.scale.set(1, 0.35, 1.2); }
  for (let i = 0; i < 4; i++) { const d = m(new THREE.CylinderGeometry(0.006, 0.002, 0.06 + rnd() * 0.07, 6), bloodMat, (rnd() - 0.5) * 0.16, 0.3, (rnd() - 0.5) * 0.3); d.position.y = 0.32 - 0.04; }
  const headPoint = new THREE.Object3D(); headPoint.position.set(0, 0.43, 0); root.add(headPoint);
  scene.add(root);
  const sparks = makeParticles(scene, '#ffdf9a', 0.03);
  return { root, headPoint, sparks, update(dt) { sparks.update(dt); }, dispose() { root.removeFromParent(); sparks.dispose(); } };
}

// ---------- MECHANICAL ARM SAW ----------
const steel = new THREE.MeshStandardMaterial({ color: '#a9b1b8', metalness: 0.88, roughness: 0.3 });
const gunmetal = new THREE.MeshStandardMaterial({ color: '#33373d', metalness: 0.75, roughness: 0.42 });
const chainMat = new THREE.MeshStandardMaterial({ color: '#d4d8dc', metalness: 0.9, roughness: 0.25 });
const redLed = new THREE.MeshStandardMaterial({ color: '#ff3a2a', emissive: '#ff1a0a', emissiveIntensity: 2.5 });
const hazardTex = canvasTex(128, 32, (g, w, h) => { g.fillStyle = '#d8a51a'; g.fillRect(0, 0, w, h); g.fillStyle = '#141414'; for (let x = -32; x < w + 32; x += 32) { g.beginPath(); g.moveTo(x, h); g.lineTo(x + 16, h); g.lineTo(x + 32, 0); g.lineTo(x + 16, 0); g.fill(); } });
const hazardMat = new THREE.MeshStandardMaterial({ map: hazardTex, metalness: 0.4, roughness: 0.5 });
export function makeArmSaw(scene) {
  // everything behind the wrist is clipped away, so the saw looks like it comes out of the arm through the split hand
  const clip = new THREE.Plane(V(0, 1, 0), 0);
  const M = {}; for (const [k, mat] of Object.entries({ steel, gunmetal, chainMat, redLed, hazardMat })) { M[k] = mat.clone(); M[k].clippingPlanes = [clip]; }
  const root = new THREE.Group();     // placed at the wrist each frame
  const slide = new THREE.Group(); root.add(slide);   // slides out of the forearm along +Y
  const m = (geo, mat, parent, x = 0, y = 0, z = 0) => { const o = new THREE.Mesh(geo, mat); o.position.set(x, y, z); o.castShadow = true; parent.add(o); return o; };
  // housing (the part that stays partly inside the forearm): pistons, a hazard band, a red light
  m(new THREE.BoxGeometry(0.07, 0.2, 0.1), M.gunmetal, slide, 0, -0.02, 0);
  m(new THREE.BoxGeometry(0.075, 0.04, 0.105), M.hazardMat, slide, 0, 0.07, 0);
  for (const z of [-0.04, 0.04]) { m(new THREE.CylinderGeometry(0.01, 0.01, 0.22, 8), M.steel, slide, 0.042, -0.04, z); }
  m(new THREE.SphereGeometry(0.012, 8, 6), M.redLed, slide, -0.038, 0.03, 0.03);
  // the bar and chain
  const BAR = 0.55, W = 0.09, Y0 = 0.1;
  m(new THREE.BoxGeometry(0.012, BAR, W), M.steel, slide, 0, Y0 + BAR / 2, 0);
  const tip = m(new THREE.CylinderGeometry(W / 2, W / 2, 0.012, 18), M.steel, slide, 0, Y0 + BAR, 0); tip.rotation.z = Math.PI / 2;
  m(new THREE.CylinderGeometry(0.02, 0.02, 0.016, 12), M.gunmetal, slide, 0, Y0, 0).rotation.z = Math.PI / 2;      // drive sprocket
  const N = 44, R = W / 2 + 0.006, per = 2 * BAR + 2 * Math.PI * R; const chain = [];
  const tooth = new THREE.BoxGeometry(0.018, 0.017, 0.011);
  for (let i = 0; i < N; i++) { const o = new THREE.Mesh(tooth, M.chainMat); slide.add(o); chain.push(o); }
  const place = (u) => { u = ((u % per) + per) % per;
    if (u < BAR) return [V(0, Y0 + u, R), 0];
    u -= BAR; if (u < Math.PI * R) { const a = u / R; return [V(0, Y0 + BAR + Math.sin(a) * R, Math.cos(a) * R), a]; }
    u -= Math.PI * R; if (u < BAR) return [V(0, Y0 + BAR - u, -R), Math.PI];
    u -= BAR; const a = u / R; return [V(0, Y0 - Math.sin(a) * R, -Math.cos(a) * R), Math.PI + a]; };
  const tipPoint = new THREE.Object3D(); tipPoint.position.set(0, Y0 + BAR, 0); slide.add(tipPoint);
  scene.add(root);
  const sparks = makeParticles(scene, '#ffd27a', 0.028), steam = makeParticles(scene, '#d9dde2', 0.07, 40, false);
  let u = 0;
  return {
    root, slide, tipPoint, sparks, steam, BAR, Y0,
    // deploy: 0 = hidden inside the forearm, 1 = fully out
    pose(deploy, rev, dt) {
      const e = deploy < 1 ? deploy * deploy * (3 - 2 * deploy) : 1;
      slide.position.y = -0.62 * (1 - e); slide.scale.setScalar(0.55 + 0.45 * e); root.visible = deploy > 0.02;
      u += dt * (0.12 + 8 * rev); for (let i = 0; i < N; i++) { const [p, a] = place(u + i * per / N); chain[i].position.copy(p); chain[i].rotation.set(-a, 0, 0); }
      slide.position.x = (rnd() - 0.5) * 0.005 * rev; slide.position.z = (rnd() - 0.5) * 0.005 * rev;
    },
    clipAt(point, dir) { clip.setFromNormalAndCoplanarPoint(dir.clone().normalize(), point); },
    cutPoints() { const out = []; if (!root.visible) return out; for (let k = 0; k <= 6; k++) out.push(slide.localToWorld(V(0, Y0 + 0.04 + k * (BAR - 0.04) / 6, 0))); return out; },
    update(dt) { sparks.update(dt); steam.update(dt); },
    dispose() { root.removeFromParent(); sparks.dispose(); steam.dispose(); },
  };
}
