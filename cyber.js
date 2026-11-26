// Cyber arms: what the regen pod can build instead of a flesh arm.
//  - a metal arm (shoulder socket, piston upper arm, elbow, armoured forearm, wrist) driven by two-bone IK to your controller
//  - a tool on the end that turns with your controller: CHAINSAW (hold trigger to rev, the chain runs) or HAMMER (big sledge)
//  - it assembles itself piece by piece out of the shoulder, with sparks
import * as THREE from 'three';
import { twoBoneIK } from './gorilla.js';

const V = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z);
const clamp = (x, a, b) => Math.max(a, Math.min(b, x));
const easeOutBack = (x, c = 1.6) => 1 + (c + 1) * Math.pow(x - 1, 3) + c * Math.pow(x - 1, 2);
const steel = new THREE.MeshStandardMaterial({ color: '#a7b0b8', metalness: 0.85, roughness: 0.32 });
const dark = new THREE.MeshStandardMaterial({ color: '#2a2e33', metalness: 0.7, roughness: 0.45 });
const led = new THREE.MeshStandardMaterial({ color: '#7fe8ff', emissive: '#29c8ff', emissiveIntensity: 2.2 });
const orange = new THREE.MeshStandardMaterial({ color: '#e2611b', metalness: 0.3, roughness: 0.45 });
const chainMat = new THREE.MeshStandardMaterial({ color: '#cfd4d9', metalness: 0.9, roughness: 0.25 });
const hazardTex = (() => { const c = document.createElement('canvas'); c.width = 128; c.height = 32; const g = c.getContext('2d'); g.fillStyle = '#e0b31c'; g.fillRect(0, 0, 128, 32); g.fillStyle = '#151515';
  for (let x = -32; x < 160; x += 32) { g.beginPath(); g.moveTo(x, 32); g.lineTo(x + 16, 32); g.lineTo(x + 32, 0); g.lineTo(x + 16, 0); g.fill(); } const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.wrapS = THREE.RepeatWrapping; t.repeat.set(3, 1); return t; })();
const hazard = new THREE.MeshStandardMaterial({ map: hazardTex, metalness: 0.4, roughness: 0.5 });
const sparkMat = new THREE.PointsMaterial({ color: '#ffd27a', size: 0.03, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending });

export function makeCyberArm(scene, type, side, L1, L2, audio = null) {
  const sx = side === 'L' ? 1 : -1;
  const root = new THREE.Group(); scene.add(root);
  const sh = new THREE.Group(); root.add(sh);
  const el = new THREE.Group(); el.position.y = -L1; sh.add(el);
  const wr = new THREE.Group(); wr.position.y = -L2; el.add(wr);
  const tool = new THREE.Group(); wr.add(tool);
  const pieces = [];   // { o, home: {p, q}, at: time it arrives }
  const mesh = (geo, mat, parent, x = 0, y = 0, z = 0, order = 0) => { const m = new THREE.Mesh(geo, mat); m.position.set(x, y, z); m.castShadow = true; parent.add(m); pieces.push({ o: m, order }); return m; };
  const cyl = (r0, r1, h, seg = 10) => new THREE.CylinderGeometry(r1, r0, h, seg);
  // shoulder socket
  mesh(new THREE.SphereGeometry(0.075, 14, 10), dark, sh, 0, 0, 0, 0);
  const ring = mesh(new THREE.TorusGeometry(0.07, 0.012, 8, 24), led, sh, 0, -0.02, 0, 0); ring.rotation.x = Math.PI / 2;
  // upper arm: a strut with two pistons and an LED strip
  mesh(cyl(0.05, 0.042, L1 * 0.8), steel, sh, 0, -L1 * 0.5, 0, 1);
  for (const dx of [-0.05, 0.05]) { mesh(cyl(0.014, 0.014, L1 * 0.62, 8), dark, sh, dx, -L1 * 0.46, -0.02, 2); mesh(cyl(0.009, 0.009, L1 * 0.4, 8), chainMat, sh, dx, -L1 * 0.68, -0.02, 2); }
  mesh(new THREE.BoxGeometry(0.012, L1 * 0.5, 0.01), led, sh, 0, -L1 * 0.5, 0.047, 2);
  // elbow
  mesh(new THREE.SphereGeometry(0.056, 12, 10), dark, el, 0, 0, 0, 3);
  const ed = mesh(cyl(0.06, 0.06, 0.03, 16), steel, el, 0, 0, 0, 3); ed.rotation.z = Math.PI / 2;
  // forearm: armoured, tapering, with a hazard band
  mesh(cyl(0.055, 0.044, L2 * 0.82), steel, el, 0, -L2 * 0.5, 0, 4);
  mesh(cyl(0.058, 0.056, 0.05, 14), hazard, el, 0, -L2 * 0.28, 0, 4);
  mesh(new THREE.BoxGeometry(0.03, L2 * 0.5, 0.02), dark, el, 0.0, -L2 * 0.5, -0.05, 5);
  // wrist
  mesh(cyl(0.05, 0.05, 0.04, 14), dark, wr, 0, 0, 0, 6);
  // the tool, pointing along the wrist's -Y (the controller's forward)
  const chain = [];
  let headPoint = null, tip = null;
  if (type === 'chainsaw') {
    mesh(new THREE.BoxGeometry(0.1, 0.14, 0.12), orange, tool, 0, -0.08, 0, 7);
    mesh(new THREE.BoxGeometry(0.06, 0.05, 0.06), dark, tool, 0.06 * sx, -0.06, 0.03, 7);
    mesh(cyl(0.012, 0.012, 0.06, 8), dark, tool, -0.04 * sx, -0.06, 0.05, 7);   // exhaust
    const BAR = 0.46, W = 0.08;
    mesh(new THREE.BoxGeometry(0.012, BAR, W), steel, tool, 0, -0.15 - BAR / 2, 0, 8);
    const tipM = mesh(new THREE.CylinderGeometry(W / 2, W / 2, 0.012, 16), steel, tool, 0, -0.15 - BAR, 0, 8); tipM.rotation.z = Math.PI / 2;
    // chain teeth run around the bar (a stadium shape)
    const N = 40, R = W / 2 + 0.006, straight = BAR, per = 2 * straight + 2 * Math.PI * R;
    const tooth = new THREE.BoxGeometry(0.018, 0.016, 0.01);
    for (let i = 0; i < N; i++) { const m = new THREE.Mesh(tooth, chainMat); tool.add(m); chain.push(m); }
    const place = (u) => { u = ((u % per) + per) % per; const y0 = -0.15;
      if (u < straight) return [V(0, y0 - u, R), 0];
      u -= straight; if (u < Math.PI * R) { const a = u / R; return [V(0, y0 - straight - Math.sin(a) * R, Math.cos(a) * R), a]; }
      u -= Math.PI * R; if (u < straight) return [V(0, y0 - straight + u, -R), Math.PI];
      u -= straight; const a = u / R; return [V(0, y0 + Math.sin(a) * R, -Math.cos(a) * R), Math.PI + a]; };
    chain.place = place; chain.per = per; chain.N = N;
    tip = new THREE.Object3D(); tip.position.set(0, -0.15 - BAR, 0); tool.add(tip);
  } else {
    mesh(cyl(0.028, 0.024, 0.32, 10), dark, tool, 0, -0.16, 0, 7);
    mesh(cyl(0.032, 0.032, 0.05, 10), hazard, tool, 0, -0.1, 0, 7);
    const head = mesh(cyl(0.085, 0.085, 0.26, 18), steel, tool, 0, -0.36, 0, 8); head.rotation.x = Math.PI / 2;   // the sledge head, faces toward palm/back
    for (const z of [-0.13, 0.13]) { const f = mesh(cyl(0.09, 0.09, 0.02, 18), dark, tool, 0, -0.36, z, 8); f.rotation.x = Math.PI / 2; }
    const band = mesh(cyl(0.087, 0.087, 0.08, 18), hazard, tool, 0, -0.36, 0, 8); band.rotation.x = Math.PI / 2;
    headPoint = new THREE.Object3D(); headPoint.position.set(0, -0.36, 0); tool.add(headPoint); tip = headPoint;
  }
  pieces.forEach(p => { p.home = { p: p.o.position.clone(), q: p.o.quaternion.clone() }; p.dir = V(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5).normalize(); });
  const maxOrder = Math.max(...pieces.map(p => p.order));

  // sparks while it builds itself
  const SP = 60; const spPos = new Float32Array(SP * 3); const spVel = Array.from({ length: SP }, () => V()); const spLife = new Float32Array(SP);
  const spGeo = new THREE.BufferGeometry(); spGeo.setAttribute('position', new THREE.BufferAttribute(spPos, 3));
  const sparks = new THREE.Points(spGeo, sparkMat); sparks.frustumCulled = false; scene.add(sparks); let si = 0;
  const spark = (at, n) => { for (let i = 0; i < n; i++) { si = (si + 1) % SP; spPos.set([at.x, at.y, at.z], si * 3); spVel[si].set((Math.random() - 0.5) * 3, Math.random() * 2.5, (Math.random() - 0.5) * 3); spLife[si] = 0.4 + Math.random() * 0.4; } };

  // chainsaw engine sound
  let snd = null;
  if (type === 'chainsaw' && audio) { const a = audio(); if (a) { const o = a.createOscillator(); o.type = 'sawtooth'; const f = a.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = 900; const g = a.createGain(); g.gain.value = 0; o.connect(f); f.connect(g); g.connect(a.destination); o.start(); snd = { a, o, f, g }; } }

  const S = { type, side, root, sh, el, wr, tool, built: 0, rev: 0, chainU: 0, attached: true, tip, headPoint, prevTip: V(), tipVel: V() };
  const BUILD = 3.2;   // seconds to assemble
  const _q = new THREE.Quaternion(), _m = new THREE.Matrix4();
  S.update = ({ shoulder, yaw, target, quat, trigger = 0, dt, t }) => {
    // assemble: each piece flies in from around the shoulder and clicks into place, in order
    if (S.built < 1) {
      S.built = Math.min(1, S.built + dt / BUILD);
      for (const p of pieces) { const k = clamp((S.built * (maxOrder + 1.6) - p.order) / 1.6, 0, 1); const e = easeOutBack(k);
        p.o.visible = k > 0; p.o.position.copy(p.home.p).addScaledVector(p.dir, (1 - e) * 0.35); p.o.quaternion.copy(p.home.q).multiply(_q.setFromAxisAngle(p.dir, (1 - e) * 3));
        p.o.scale.setScalar(0.3 + 0.7 * Math.min(1, e)); if (k > 0.85 && !p.clicked) { p.clicked = true; p.o.updateMatrixWorld(true); spark(p.o.getWorldPosition(V()), 6); } }
    }
    if (S.attached) {
      root.position.copy(shoulder); root.rotation.set(0, yaw, 0); root.updateMatrixWorld(true);
      sh.rotation.set(0, 0, 0); el.rotation.set(0, 0, 0); wr.rotation.set(0, 0, 0);
      const fwd = V(0, 0, -1).applyQuaternion(quat); const wristT = target.clone().addScaledVector(fwd, -0.09);
      twoBoneIK(sh, el, wr, wristT, V(sx * 1.0, -0.4, -0.6).applyAxisAngle(V(0, 1, 0), yaw), L1, L2);
      // the wrist/tool turns with the controller: tool along controller forward, its flat side facing the palm direction
      const palm = V(sx, 0, 0).applyQuaternion(quat); const y = fwd.clone().negate(); const z = palm.sub(y.clone().multiplyScalar(palm.dot(y))).normalize(); const x = y.clone().cross(z).normalize();
      const wq = _q.setFromRotationMatrix(_m.makeBasis(x, y, z)); const pq = new THREE.Quaternion(); wr.parent.getWorldQuaternion(pq); wr.quaternion.copy(pq.invert().multiply(wq));
      S.rev += ((trigger > 0.2 ? 1 : 0) - S.rev) * Math.min(1, dt * 8);
      tool.position.set((Math.random() - 0.5) * 0.004 * S.rev, 0, (Math.random() - 0.5) * 0.004 * S.rev);   // it shakes when revving
    } else S.rev += (0 - S.rev) * Math.min(1, dt * 3);
    root.updateMatrixWorld(true);
    if (chain.length) { S.chainU += dt * (0.15 + 7.5 * S.rev); for (let i = 0; i < chain.N; i++) { const [p, a] = chain.place(S.chainU + i * chain.per / chain.N); chain[i].position.copy(p); chain[i].rotation.set(-a, 0, 0); } }
    if (snd) { const now = snd.a.currentTime; snd.o.frequency.setTargetAtTime(55 + 120 * S.rev, now, 0.05); snd.g.gain.setTargetAtTime(S.built >= 1 && S.attached ? 0.008 + 0.08 * S.rev : 0, now, 0.08); snd.f.frequency.setTargetAtTime(500 + 1400 * S.rev, now, 0.05); }
    const tp = tip.getWorldPosition(V()); S.tipVel.copy(tp).sub(S.prevTip).divideScalar(Math.max(dt, 1e-3)); S.prevTip.copy(tp);
    // sparks fall
    for (let i = 0; i < SP; i++) { if (spLife[i] <= 0) { spPos[i * 3 + 1] = -99; continue; } spLife[i] -= dt; spVel[i].y -= 9.8 * dt; spPos[i * 3] += spVel[i].x * dt; spPos[i * 3 + 1] += spVel[i].y * dt; spPos[i * 3 + 2] += spVel[i].z * dt; }
    spGeo.attributes.position.needsUpdate = true;
  };
  // points along the chainsaw bar that cut (world space)
  S.cutPoints = () => { if (type !== 'chainsaw') return []; const out = []; for (let k = 0; k <= 5; k++) out.push(tool.localToWorld(V(0, -0.17 - k * 0.085, 0))); return out; };
  S.points = () => [sh, el, wr].map(o => o.getWorldPosition(V()));
  S.spark = spark;
  S.detach = () => { S.attached = false; if (snd) snd.g.gain.setTargetAtTime(0, snd.a.currentTime, 0.05); };
  S.dispose = () => { scene.remove(root); scene.remove(sparks); if (snd) { try { snd.o.stop(); } catch (e) {} } };
  S.setVisible = (v) => { root.visible = v; if (!v && snd) snd.g.gain.setTargetAtTime(0, snd.a.currentTime, 0.05); };
  return S;
}
