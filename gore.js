// Gore (17+): gorillas (models/gorilla_parts.glb) come apart into head, arms and body.
//  - torn ends get a raw wound cap, bone ends stick out of arms and shoulders, a head comes off with its spine
//  - "full" gore adds guts, meat chunks and (for big hits) the body split down the middle with a cut face
//  - blood: stretched droplets (one instanced mesh), rhythmic spurts from wounds, growing wet splats and pools
//  - simple physics: pieces bounce off the world and each other; synthesized tearing / squelch / thud sounds
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

const V = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z);
// joints in model space (Y up, facing +Z, origin at the feet) and which way the wound faces
const NECK = V(0, 1.12, 0.04), SH = { L: V(0.36, 1.04, -0.02), R: V(-0.36, 1.04, -0.02) };
const JOINTS = {
  Head: [{ at: NECK, dir: V(0, -1, 0), r: 0.085, kind: 'spine' }],
  Arm_L: [{ at: SH.L, dir: V(-1, 0.2, 0).normalize(), r: 0.08, kind: 'bone' }],
  Arm_R: [{ at: SH.R, dir: V(1, 0.2, 0).normalize(), r: 0.08, kind: 'bone' }],
  Body: [{ at: NECK, dir: V(0, 1, 0), r: 0.1, kind: 'stub', for: 'Head' }, { at: SH.L, dir: V(1, 0.2, 0).normalize(), r: 0.09, kind: 'bone', for: 'Arm_L' }, { at: SH.R, dir: V(-1, 0.2, 0).normalize(), r: 0.09, kind: 'bone', for: 'Arm_R' }],
};
const RADIUS = { Head: 0.16, Arm_L: 0.18, Arm_R: 0.18, Body: 0.3, half: 0.22, chunk: 0.05 };

export async function initGore(scene, addSplat, contact = null) {
  const gltf = await new GLTFLoader().loadAsync('./models/gorilla_parts.glb');
  gltf.scene.traverse(o => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
  // each part gets a pivot at its own centre so it tumbles naturally
  for (const name of ['Body', 'Head', 'Arm_L', 'Arm_R']) {
    const o = gltf.scene.getObjectByName(name); if (!o) continue;
    const c = new THREE.Box3().setFromObject(o).getCenter(V());
    const pivot = new THREE.Group(); pivot.name = name; pivot.position.copy(c); pivot.userData.c = c.toArray(); o.name = name + '_mesh';
    gltf.scene.add(pivot); pivot.attach(o);
    const bb = new THREE.Box3().setFromObject(pivot); pivot.userData.lb = [bb.min.clone().sub(c).toArray(), bb.max.clone().sub(c).toArray()];   // local hit box
  }
  const bodySize = new THREE.Box3().setFromObject(gltf.scene.getObjectByName('Body')).getSize(V());
  const G = { level: 'full' };

  // ---------- materials ----------
  const meat = new THREE.MeshStandardMaterial({ color: '#7c0d16', roughness: 0.28, metalness: 0.05, emissive: '#1a0003' });
  const meatLight = new THREE.MeshStandardMaterial({ color: '#b3363f', roughness: 0.35 });
  const gut = new THREE.MeshStandardMaterial({ color: '#b04a52', roughness: 0.22, metalness: 0.05 });
  const bone = new THREE.MeshStandardMaterial({ color: '#e9dec6', roughness: 0.45 });
  const cutTex = (() => { const c = document.createElement('canvas'); c.width = c.height = 256; const g = c.getContext('2d');
    g.fillStyle = '#2b2220'; g.beginPath(); g.ellipse(128, 128, 126, 126, 0, 0, 7); g.fill();                   // fur edge
    g.fillStyle = '#8a1a22'; g.beginPath(); g.ellipse(128, 128, 112, 112, 0, 0, 7); g.fill();                   // meat
    g.fillStyle = '#6a0a12'; g.beginPath(); g.ellipse(128, 128, 88, 92, 0, 0, 7); g.fill();
    g.fillStyle = '#e5d7bd'; for (let i = 0; i < 6; i++) { g.beginPath(); g.ellipse(64 + i * 26, 60 - Math.sin(i / 5 * Math.PI) * 12, 9, 5, 0, 0, 7); g.fill(); } // ribs
    g.fillStyle = '#c04f58'; for (const [x, y, r] of [[110, 140, 26], [150, 150, 22], [128, 180, 24], [95, 175, 16], [165, 118, 15]]) { g.beginPath(); g.arc(x, y, r, 0, 7); g.fill(); } // gut loops
    g.fillStyle = '#e9dec6'; g.beginPath(); g.ellipse(128, 222, 16, 12, 0, 0, 7); g.fill(); g.fillStyle = '#9a7b70'; g.beginPath(); g.arc(128, 222, 6, 0, 7); g.fill(); // spine
    const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t; })();
  const cutMat = new THREE.MeshStandardMaterial({ map: cutTex, roughness: 0.3, side: THREE.DoubleSide });
  // the model's built-in wound caps stay hidden until that part is actually torn off
  // (they close the seams between head, arms and body, so on an intact gorilla they are just dark fur, never hidden)
  const seamFur = new THREE.MeshStandardMaterial({ color: '#1c1816', roughness: 0.95 });
  gltf.scene.traverse(o => { if (o.isMesh && o.material && o.material.name === 'Stump') { o.userData.stump = true; o.material = seamFur; } });

  // ---------- shared geometry ----------
  const capGeo = new THREE.SphereGeometry(1, 16, 10);
  const cylGeo = new THREE.CylinderGeometry(1, 1, 1, 10);
  const knobGeo = new THREE.SphereGeometry(1, 10, 8);
  const vertGeo = new THREE.CylinderGeometry(0.024, 0.027, 0.03, 10);
  const procGeo = new THREE.BoxGeometry(0.014, 0.022, 0.045);
  const discGeo = new THREE.CylinderGeometry(0.026, 0.026, 0.012, 10);
  const chunkGeo = new THREE.DodecahedronGeometry(1, 0);
  const circleGeo = new THREE.CircleGeometry(1, 28);
  const alongY = (m, dir) => m.quaternion.setFromUnitVectors(V(0, 1, 0), dir.clone().normalize());
  const mk = (geo, mat, parent) => { const m = new THREE.Mesh(geo, mat); m.castShadow = true; parent.add(m); return m; };
  const tube = (pts, r, mat, parent) => mk(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 24, r, 7, false), mat, parent);

  // the wound on a torn piece: a raw cap, plus a bone end / spine depending on the joint
  function woundAt(piece, j, full) {
    const c = V().fromArray(piece.userData.c); const at = j.at.clone().sub(c); const dir = j.dir.clone();
    const g = new THREE.Group(); g.position.copy(at); piece.add(g);
    const cap = mk(capGeo, meat, g); cap.scale.set(j.r, j.r * 0.32, j.r); alongY(cap, dir);
    if (!full) return g;
    const inner = mk(capGeo, meatLight, g); inner.scale.set(j.r * 0.6, j.r * 0.2, j.r * 0.6); alongY(inner, dir); inner.position.copy(dir).multiplyScalar(j.r * 0.12);
    if (j.kind === 'bone') {   // a ball-ended upper arm bone poking out
      const b = mk(cylGeo, bone, g); b.scale.set(0.022, 0.075, 0.022); alongY(b, dir); b.position.copy(dir).multiplyScalar(0.035);
      const k = mk(knobGeo, bone, g); k.scale.setScalar(0.032); k.position.copy(dir).multiplyScalar(0.075);
      for (let i = 0; i < 3; i++) { const s = mk(chunkGeo, meat, g); s.scale.setScalar(0.014 + Math.random() * 0.01); s.position.copy(dir).multiplyScalar(0.02 + Math.random() * 0.03).add(V((Math.random() - 0.5) * 0.06, (Math.random() - 0.5) * 0.06, (Math.random() - 0.5) * 0.06)); }
    } else if (j.kind === 'spine') {   // the spine itself is a separate long chain (makeRope); here: where it starts + stringy bits
      piece.userData.spineTop = at.clone().addScaledVector(dir, 0.01); piece.userData.spineDir = dir.clone();
      // stringy bits hanging off the top of the spine
      for (let i = 0; i < 3; i++) { const a = Math.random() * 6.28; const s = V(Math.cos(a) * 0.04, 0, Math.sin(a) * 0.04);
        tube([s, s.clone().addScaledVector(dir, 0.06).add(V(0, 0, 0.01)), s.clone().addScaledVector(dir, 0.11 + Math.random() * 0.06).add(V((Math.random() - 0.5) * 0.05, 0, (Math.random() - 0.5) * 0.05))], 0.006 + Math.random() * 0.004, i ? meat : meatLight, g); }
    } else if (j.kind === 'stub') {    // the neck hole: the bottom of the spine and a few loose bits
      for (let i = 0; i < 2; i++) { const v = mk(vertGeo, bone, g); alongY(v, dir); v.position.copy(dir).multiplyScalar(0.005 + i * 0.04).add(V(0, 0, -0.03)); }
      for (let i = 0; i < 3; i++) { const s = mk(chunkGeo, i ? meat : meatLight, g); s.scale.setScalar(0.016 + Math.random() * 0.012); s.position.set((Math.random() - 0.5) * 0.08, 0.01, (Math.random() - 0.5) * 0.06); }
    }
    return g;
  }
  const decorate = (piece, name, full, only = null) => { piece.traverse(m => { if (m.userData.stump) m.material = meat; }); for (const j of JOINTS[name] || []) if (!only || j.for === only) woundAt(piece, j, full); };
  const jointInfo = (piece, name) => { const j = JOINTS[name][0]; const c = V().fromArray(piece.userData.c); return { jointLocal: j.at.clone().sub(c), dirLocal: j.dir.clone() }; };

  const partsOf = (root) => { const p = {}; root.traverse(o => { if (['Body', 'Head', 'Arm_L', 'Arm_R'].includes(o.name)) p[o.name] = o; }); return p; };
  const makeAvatar = () => { const a = gltf.scene.clone(true); a.userData.parts = partsOf(a); a.userData.bleeds = []; scene.add(a); return a; };
  // a single torn-off part (used for your own arm), with its wound, in model space
  function makeLimb(name) { const o = gltf.scene.getObjectByName(name).clone(true); decorate(o, name, G.level === 'full'); return { o, ...jointInfo(o, name) }; }

  // ---------- the spine: a long chain of vertebrae hanging from a torn-off head ----------
  // attached: its lower end is still inside the body; pulling the head away slides it out, until all of it is out and it pops free.
  // free: a wobbly chain (verlet) swinging from the head.
  const SEG = 0.05, NV = 16;                     // 16 vertebrae, 0.8 m
  const ropes = [];
  function makeRope(piece, anchor = null) {
    const top = piece.userData.spineTop; if (!top) return null;
    const grp = new THREE.Group(); scene.add(grp);
    const R = { piece, anchor, grp, verts: [], procs: [], discs: [], p: [], prev: [], attached: !!anchor, tension: 0, popped: false, t: 0, dead: false };
    for (let i = 0; i < NV; i++) {
      const sc = 1 - i * 0.022;
      const v = mk(vertGeo, bone, grp); v.scale.set(sc, 1.25, sc); R.verts.push(v);
      const pr = mk(procGeo, bone, grp); pr.scale.setScalar(sc); R.procs.push(pr);
      const d = mk(discGeo, i % 2 ? meat : meatLight, grp); d.scale.setScalar(sc); R.discs.push(d);
    }
    const tip = mk(chunkGeo, meat, grp); tip.scale.setScalar(0.028); R.tip = tip;
    piece.updateMatrixWorld(true); const t0 = piece.localToWorld(top.clone()); const d0 = piece.userData.spineDir.clone().applyQuaternion(piece.getWorldQuaternion(new THREE.Quaternion()));
    for (let i = 0; i <= NV; i++) { const q = t0.clone().addScaledVector(d0, i * SEG * (anchor ? 0.05 : 1)); R.p.push(q); R.prev.push(q.clone()); }
    ropes.push(R); while (ropes.length > 6) { const o = ropes.shift(); scene.remove(o.grp); }
    return R;
  }
  const _a = V(), _b = V(), _dir = V(), _side = V(), UP = V(0, 1, 0);
  function updateRope(R, dt) {
    if (!R.piece.parent) { scene.remove(R.grp); R.dead = true; return; }
    R.t += dt; R.piece.updateMatrixWorld(true);
    const top = R.piece.localToWorld(R.piece.userData.spineTop.clone());
    const dirW = R.piece.userData.spineDir.clone().applyQuaternion(R.piece.getWorldQuaternion(_qq));
    let visible = NV;
    if (R.attached) {
      if (!R.anchor.obj.parent) R.attached = false;
      else {
        const A = R.anchor.obj.localToWorld(R.anchor.local.clone()); const D = top.distanceTo(A), total = NV * SEG;
        R.tension = Math.min(1, D / total);
        if (D > total + 0.03) {   // all of it is out: it pops free
          R.attached = false; R.popped = true; spurt(A, V(0, 1, 0), 30, 2.6); spurt(R.p[NV], V(0, -1, 0), 12, 1.2); sfx('crunch', 1); sfx('tear', 0.8);
          for (let i = 0; i <= NV; i++) R.prev[i].copy(R.p[i]);
        } else {
          // what's out so far runs from the head down into the neck hole, sagging a little; the rest is still inside
          visible = Math.min(NV, Math.ceil(D / SEG));
          const ctrl = top.clone().lerp(A, 0.5).add(V(0, -0.12 * (1 - R.tension), 0)).addScaledVector(dirW, 0.08 * (1 - R.tension));
          for (let i = 0; i <= NV; i++) { const u = Math.min(1, (i * SEG) / Math.max(D, 1e-3));
            const q = top.clone().multiplyScalar((1 - u) * (1 - u)).addScaledVector(ctrl, 2 * u * (1 - u)).addScaledVector(A, u * u);
            q.x += Math.sin(R.t * 30 + i) * 0.004 * R.tension; R.p[i].copy(q); R.prev[i].copy(q); }
        }
      }
    }
    if (!R.attached) {   // verlet chain, pinned at the head
      R.p[0].copy(top); R.prev[0].copy(top);
      for (let i = 1; i <= NV; i++) { const p = R.p[i], q = R.prev[i]; _a.copy(p).sub(q).multiplyScalar(0.985); q.copy(p); p.add(_a); p.y -= 9.8 * dt * dt; }
      for (let it = 0; it < 10; it++) {
        R.p[1].copy(top).addScaledVector(dirW, SEG).lerp(R.p[1], 0.75);       // the first joint leaves the head along the neck
        for (let i = 0; i < NV; i++) { const a = R.p[i], b = R.p[i + 1]; _dir.copy(b).sub(a); const L = _dir.length() || 1e-6; const k = (L - SEG) / L;
          if (i === 0) b.addScaledVector(_dir, -k); else { a.addScaledVector(_dir, k * 0.5); b.addScaledVector(_dir, -k * 0.5); } }
        R.p[0].copy(top);
      }
      for (let i = 1; i <= NV; i++) { const p = R.p[i]; if (contact) { const c = contact(p, 0.025); if (c.dist < 0.025) p.copy(c.rest); } else if (p.y < 0.025) p.y = 0.025; }
      if (R.t < 8 && Math.random() < 0.08) spurt(R.p[NV], V(0, -1, 0), 1, 0.3);   // drips off the end
    }
    // place the vertebrae along the chain
    for (let i = 0; i < NV; i++) {
      const a = R.p[i], b = R.p[i + 1]; _dir.copy(b).sub(a); const L = _dir.length(); const show = i < visible && L > 1e-4;
      R.verts[i].visible = R.procs[i].visible = R.discs[i].visible = show; if (!show) continue; _dir.divideScalar(L);
      _side.copy(_dir).cross(UP); if (_side.lengthSq() < 1e-4) _side.set(1, 0, 0); _side.normalize(); const back = _a.copy(_side).cross(_dir).normalize();
      const v = R.verts[i]; v.position.copy(a).lerp(b, 0.45); v.quaternion.setFromUnitVectors(UP, _dir);
      const pr = R.procs[i]; pr.position.copy(v.position).addScaledVector(back, 0.032); pr.quaternion.copy(v.quaternion);
      const d = R.discs[i]; d.position.copy(b); d.quaternion.copy(v.quaternion);
    }
    R.tip.visible = visible >= NV; R.tip.position.copy(R.p[NV]);
  }

  // ---------- sound (synthesized, no files) ----------
  let ac = null, noiseBuf = null;
  const audio = () => { if (!ac) { try { ac = new (window.AudioContext || window.webkitAudioContext)(); const n = ac.sampleRate; noiseBuf = ac.createBuffer(1, n, n); const d = noiseBuf.getChannelData(0); for (let i = 0; i < n; i++) d[i] = Math.random() * 2 - 1; } catch (e) { ac = null; } } if (ac && ac.state === 'suspended') ac.resume(); return ac; };
  function sfx(type, k = 1) {
    const a = audio(); if (!a) return; const t = a.currentTime; const out = a.createGain(); out.connect(a.destination);
    const noise = (dur, f0, f1, q, gain, t0 = 0) => { const s = a.createBufferSource(); s.buffer = noiseBuf; s.playbackRate.value = 0.6 + Math.random() * 0.5; const f = a.createBiquadFilter(); f.type = 'bandpass'; f.Q.value = q; f.frequency.setValueAtTime(f0, t + t0); f.frequency.exponentialRampToValueAtTime(f1, t + t0 + dur);
      const g = a.createGain(); g.gain.setValueAtTime(0.0001, t + t0); g.gain.exponentialRampToValueAtTime(gain, t + t0 + 0.015); g.gain.exponentialRampToValueAtTime(0.0001, t + t0 + dur); s.connect(f); f.connect(g); g.connect(out); s.start(t + t0, Math.random() * 0.5, dur + 0.05); };
    const tone = (dur, f0, f1, gain, t0 = 0) => { const o = a.createOscillator(); o.frequency.setValueAtTime(f0, t + t0); o.frequency.exponentialRampToValueAtTime(f1, t + t0 + dur); const g = a.createGain(); g.gain.setValueAtTime(gain, t + t0); g.gain.exponentialRampToValueAtTime(0.0001, t + t0 + dur); o.connect(g); g.connect(out); o.start(t + t0); o.stop(t + t0 + dur + 0.02); };
    if (type === 'tear') { noise(0.45, 2400, 350, 1.2, 0.5 * k); noise(0.25, 900, 200, 2, 0.4 * k, 0.05); for (let i = 0; i < 4; i++) noise(0.06, 1600, 600, 4, 0.25 * k, 0.1 + i * 0.07 + Math.random() * 0.03); tone(0.25, 140, 50, 0.5 * k); }
    else if (type === 'crunch') { for (let i = 0; i < 6; i++) noise(0.05, 3000, 1200, 3, 0.3 * k, i * 0.035); tone(0.2, 110, 45, 0.45 * k); }
    else if (type === 'squelch') noise(0.12, 700, 250, 3, 0.25 * k);
    else if (type === 'thud') { tone(0.18, 95, 40, 0.5 * k); noise(0.08, 400, 150, 1, 0.2 * k); }
  }

  // ---------- blood droplets: one instanced mesh, stretched along their velocity ----------
  const N = 500;
  const dropMat = new THREE.MeshStandardMaterial({ color: '#7a0009', roughness: 0.15, metalness: 0.15 });
  const drops = new THREE.InstancedMesh(new THREE.SphereGeometry(1, 6, 5), dropMat, N); drops.frustumCulled = false; drops.instanceMatrix.setUsage(THREE.DynamicDrawUsage); scene.add(drops);
  const D = Array.from({ length: N }, () => ({ alive: false, p: V(), v: V(), r: 0, life: 0 }));
  let di = 0;
  const spurt = (pos, dir, n, speed) => { n = G.level === 'full' ? n : Math.ceil(n * 0.4);
    for (let i = 0; i < n; i++) { const d = D[di = (di + 1) % N]; d.alive = true; d.p.copy(pos); d.life = 1.6 + Math.random();
      d.v.copy(dir).normalize().multiplyScalar(speed * (0.6 + Math.random() * 0.6)).add(V((Math.random() - 0.5) * 0.9, Math.random() * 0.5, (Math.random() - 0.5) * 0.9)); d.r = 0.008 + Math.random() * 0.012; } };
  const _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _s = V(), Z = V(0, 0, 1);
  let splatBudget = 0;
  function updateDrops(dt) {
    splatBudget = Math.min(6, splatBudget + dt * 6);
    for (let i = 0; i < N; i++) {
      const d = D[i];
      if (d.alive) {
        d.v.y -= 9.8 * dt; d.p.addScaledVector(d.v, dt); d.life -= dt;
        const hit = contact ? contact(d.p, 0) : { dist: d.p.y, point: V(d.p.x, 0, d.p.z), normal: V(0, 1, 0) };
        if (hit.dist < 0.005 || d.life <= 0) { d.alive = false;
          if (hit.dist < 0.005 && splatBudget >= 1 && Math.random() < 0.25) { splatBudget--; addSplat(hit.point, hit.normal, 0.06 + d.r * 8, 0.2); } }
      }
      if (!d.alive) { _m.makeScale(0, 0, 0); drops.setMatrixAt(i, _m); continue; }
      const sp = d.v.length(); _q.setFromUnitVectors(Z, sp > 1e-4 ? _s.copy(d.v).divideScalar(sp) : Z);
      const f = Math.min(1, d.life * 2); _s.set(d.r * f, d.r * f, d.r * f * (1 + sp * 0.9));
      _m.compose(d.p, _q, _s); drops.setMatrixAt(i, _m);
    }
    drops.instanceMatrix.needsUpdate = true;
  }

  // ---------- loose pieces ----------
  const pieces = [];   // { o, vel, spin, bleed, t, jointLocal, dirLocal, r, landed, clip, poolT }
  function loosen(o, vel, spin, bleed, info, r) {
    scene.attach(o); const p = { o, vel, spin, bleed, t: 0, jointLocal: info?.jointLocal, dirLocal: info?.dirLocal, r, landed: false, poolT: 0 }; pieces.push(p);
    while (pieces.length > 40) { const old = pieces.shift(); scene.remove(old.o); }
    return p;
  }
  const chunk = (at, vel) => { const g = new THREE.Group(); g.position.copy(at); const m = mk(chunkGeo, Math.random() < 0.5 ? meat : meatLight, g); m.scale.set(0.03 + Math.random() * 0.03, 0.025 + Math.random() * 0.02, 0.03 + Math.random() * 0.03); scene.add(g);
    loosen(g, vel, V(Math.random() * 10, Math.random() * 10, Math.random() * 10), 0, null, RADIUS.chunk); };
  const gutRope = (at, vel) => { const g = new THREE.Group(); g.position.copy(at); const pts = []; let p = V(); for (let i = 0; i < 6; i++) { pts.push(p.clone()); p = p.clone().add(V((Math.random() - 0.5) * 0.12, (Math.random() - 0.5) * 0.08, (Math.random() - 0.5) * 0.12)); }
    tube(pts, 0.02, gut, g); scene.add(g); loosen(g, vel, V(Math.random() * 6, Math.random() * 6, Math.random() * 6), 0.6, { jointLocal: pts[0], dirLocal: V(0, 1, 0) }, 0.08); };

  // split the body down the middle: two clipped copies, each with a cut face, guts hanging out of it and spine showing
  function splitBody(body, side, push) {
    const c = V().fromArray(body.userData.c); const halves = [];
    for (const sgn of [1, -1]) {
      const h = sgn === 1 ? body : body.clone(true);
      if (sgn === -1) { h.position.copy(body.position); h.quaternion.copy(body.quaternion); scene.add(h); }
      const local = new THREE.Plane(V(sgn, 0, 0), sgn * c.x);          // keeps the side where sgn*x_model >= 0
      const world = new THREE.Plane();
      h.traverse(m => { if (m.isMesh) { m.material = m.material.clone(); m.material.clippingPlanes = [world]; m.material.side = THREE.DoubleSide; } });
      const face = mk(circleGeo, cutMat, h); face.rotation.y = -sgn * Math.PI / 2; face.position.set(-c.x + sgn * 0.003, 0, 0); face.scale.set(bodySize.z * 0.46, bodySize.y * 0.44, 1);
      // guts slipping out of the cut, hanging down
      const o0 = V(-c.x, -0.05, 0.04), n = V(-sgn, 0, 0);
      tube([o0, o0.clone().addScaledVector(n, 0.07).add(V(0, -0.08, 0.06)), o0.clone().addScaledVector(n, 0.12).add(V(0, -0.26, 0.1)), o0.clone().addScaledVector(n, 0.06).add(V(0.0, -0.42, 0.03))], 0.024, gut, h);
      tube([o0.clone().add(V(0, 0.08, 0)), o0.clone().addScaledVector(n, 0.05).add(V(0, 0.0, 0.1)), o0.clone().addScaledVector(n, 0.09).add(V(0, -0.15, 0.15))], 0.018, meatLight, h);
      const p = loosen(h, push.clone().multiplyScalar(0.9).addScaledVector(side, 1.6 * sgn).add(V(0, 1.2, 0)), V((Math.random() - 0.5) * 2, (Math.random() - 0.5) * 2, sgn * 3), 2.2, { jointLocal: V(-c.x, 0, 0), dirLocal: V(-sgn, 0, 0) }, RADIUS.half);
      p.clip = { local, world }; halves.push(p);
    }
    return halves;
  }

  // tear one part off a standing avatar (you grabbed it): returns the piece, the avatar keeps a bleeding wound
  function tearOff(avatar, name) {
    const P = avatar.userData.parts; const o = P[name]; if (!o) return null;
    const full = G.level === 'full'; avatar.updateMatrixWorld(true); scene.attach(o); delete P[name];
    decorate(o, name, full);
    if (P.Body) { decorate(P.Body, 'Body', full, name); const j = JOINTS.Body.find(j => j.for === name); const c = V().fromArray(P.Body.userData.c); avatar.userData.bleeds.push({ body: P.Body, jointLocal: j.at.clone().sub(c), dirLocal: j.dir.clone(), t: 0 }); bleedingAvatars.add(avatar); }
    let rope = null;
    if (name === 'Head' && full && P.Body) { const cb = V().fromArray(P.Body.userData.c); rope = makeRope(o, { obj: P.Body, local: NECK.clone().sub(cb).add(V(0, -0.02, -0.03)) }); }
    const info = jointInfo(o, name); const wp = o.localToWorld(info.jointLocal.clone());
    spurt(wp, info.dirLocal.clone().applyQuaternion(o.quaternion).negate().add(V(0, 0.5, 0)), 30, 2.6);
    sfx(name === 'Head' ? 'crunch' : 'tear'); sfx('tear', 0.6);
    return { o, ...info, rope };
  }
  const bleedingAvatars = new Set();

  // tear an avatar apart where it stands (it is consumed: its parts become loose pieces)
  // smashed into little pieces (the hammer): the whole gorilla turns into chunks of fur, meat and bone
  const furChunk = new THREE.MeshStandardMaterial({ color: '#211b18', roughness: 0.95 });
  function pulverize(avatar, push) {
    avatar.updateMatrixWorld(true); const at = new THREE.Box3().setFromObject(avatar).getCenter(V()); const full = G.level === 'full'; const r = () => Math.random() - 0.5;
    scene.remove(avatar); bleedingAvatars.delete(avatar);
    const n = full ? 34 : 16;
    for (let i = 0; i < n; i++) { const g = new THREE.Group(); g.position.copy(at).add(V(r() * 0.5, r() * 0.7, r() * 0.4)); const kind = Math.random();
      const m = mk(chunkGeo, kind < 0.45 ? furChunk : kind < 0.8 || !full ? meat : kind < 0.9 ? meatLight : bone, g); const sz = 0.03 + Math.random() * 0.06; m.scale.set(sz, sz * (0.6 + Math.random() * 0.5), sz * (0.7 + Math.random() * 0.6)); scene.add(g);
      loosen(g, push.clone().multiplyScalar(2 + Math.random() * 3).add(V(r() * 5, 1.5 + Math.random() * 4, r() * 5)), V(r() * 20, r() * 20, r() * 20), Math.random() < 0.3 ? 1 : 0, Math.random() < 0.3 ? { jointLocal: V(), dirLocal: V(0, 1, 0) } : null, Math.max(0.04, sz)); }
    if (full) for (let i = 0; i < 3; i++) gutRope(at.clone().add(V(r() * 0.3, 0, r() * 0.3)), push.clone().multiplyScalar(2).add(V(r() * 3, 2 + Math.random() * 2, r() * 3)));
    for (let i = 0; i < 10; i++) addSplat(V(at.x + r() * 2.4 + push.x * 0.8, 0, at.z + r() * 2.4 + push.z * 0.8), V(0, 1, 0), 0.4 + Math.random() * 1.0, 0.25);
    spurt(at, push.clone().add(V(0, 0.8, 0)), 90, 4.5); spurt(at, V(0, 1, 0), 40, 3);
    sfx('crunch', 1.3); sfx('tear', 1.2); sfx('thud', 1);
  }
  function dismember(avatar, push = V(0, 0, 1), opts = {}) {
    if (opts.pulp) return pulverize(avatar, push);
    avatar.updateMatrixWorld(true); const P = avatar.userData.parts; const side = V(push.z, 0, -push.x).normalize(); const full = G.level === 'full';
    const r = () => Math.random() - 0.5;
    for (const name of ['Head', 'Arm_L', 'Arm_R']) if (P[name]) decorate(P[name], name, full);
    if (P.Body) for (const j of JOINTS.Body) if (P[j.for]) woundAt(P.Body, j, full);
    if (P.Head && full) makeRope(P.Head, null);
    if (P.Head) loosen(P.Head, push.clone().multiplyScalar(1.5).add(V(r(), 5.2, r())), V(r() * 12, r() * 8, r() * 12), 1.6, jointInfo(P.Head, 'Head'), RADIUS.Head);
    if (P.Arm_L) loosen(P.Arm_L, side.clone().multiplyScalar(3.2).add(V(r(), 2.8, r())), V(r() * 14, r() * 10, r() * 14), 1.3, jointInfo(P.Arm_L, 'Arm_L'), RADIUS.Arm_L);
    if (P.Arm_R) loosen(P.Arm_R, side.clone().multiplyScalar(-3.2).add(V(r(), 2.8, r())), V(r() * 14, r() * 10, r() * 14), 1.3, jointInfo(P.Arm_R, 'Arm_R'), RADIUS.Arm_R);
    let at = V();
    if (P.Body) {
      at = P.Body.getWorldPosition(V());
      if (opts.split && full) splitBody(P.Body, side, push);
      else loosen(P.Body, push.clone().multiplyScalar(0.8).add(V(0, 0.6, 0)), V(2.2, 0, r()), 2.4, { jointLocal: NECK.clone().sub(V().fromArray(P.Body.userData.c)), dirLocal: V(0, 1, 0) }, RADIUS.Body);
    }
    scene.remove(avatar); bleedingAvatars.delete(avatar);
    for (let i = 0; i < 5; i++) addSplat(V(at.x + r() * 1.6, 0, at.z + r() * 1.6), V(0, 1, 0), 0.4 + Math.random() * 0.8, 0.3);
    spurt(at.clone().setY(at.y + 0.4), V(0, 1, 0), 60, 3.8);
    if (full) { for (let i = 0; i < (opts.split ? 8 : 5); i++) chunk(at.clone().add(V(r() * 0.3, 0.3 + r() * 0.3, r() * 0.3)), push.clone().multiplyScalar(1.5).add(V(r() * 4, 2 + Math.random() * 3, r() * 4)));
      for (let i = 0; i < (opts.split ? 2 : 1); i++) gutRope(at.clone().add(V(0, 0.2, 0)), push.clone().add(V(r() * 2, 1.5 + Math.random() * 2, r() * 2))); }
    sfx('tear', 1.2); if (opts.split) sfx('crunch', 1);
  }

  // ---------- per frame ----------
  const _w = V(), _d = V(), _qq = new THREE.Quaternion();
  const pulseAt = (t) => Math.pow(Math.max(0, Math.sin(t * Math.PI * 2 * 1.5)), 3);   // heartbeat-like spurts, 1.5 per second
  function update(dt) {
    updateDrops(dt);
    for (const r of ropes) if (!r.dead) updateRope(r, dt);
    for (const p of pieces) {
      const o = p.o; p.t += dt;
      p.vel.y -= 9.8 * dt; o.position.addScaledVector(p.vel, dt);
      o.rotation.x += p.spin.x * dt; o.rotation.y += p.spin.y * dt; o.rotation.z += p.spin.z * dt;
      const hit = contact ? contact(o.position, p.r) : { dist: o.position.y - p.r, rest: V(o.position.x, p.r, o.position.z), normal: V(0, 1, 0), point: V(o.position.x, 0, o.position.z) };
      if (hit.dist < p.r) {
        o.position.copy(hit.rest); const vn = p.vel.dot(hit.normal);
        if (vn < 0) { if (vn < -1.5) { sfx(p.r > 0.1 ? 'thud' : 'squelch', Math.min(1, -vn / 5)); addSplat(hit.point, hit.normal, 0.3 + p.r * 2 + Math.random() * 0.3, 0.25); } p.vel.addScaledVector(hit.normal, -1.3 * vn); }
        if (!p.landed) p.landed = true;
        p.vel.multiplyScalar(Math.pow(0.02, dt)); p.spin.multiplyScalar(Math.pow(0.004, dt));   // friction + angular damping while touching
      } else p.spin.multiplyScalar(Math.pow(0.7, dt));
      if (p.clip) { o.updateMatrixWorld(true); p.clip.world.copy(p.clip.local).applyMatrix4(o.matrixWorld); }
      // wounds spurt in pulses while fresh, then drip and pool
      if (p.jointLocal && p.t < p.bleed + 4) {
        _w.copy(p.jointLocal); o.localToWorld(_w); o.getWorldQuaternion(_qq); _d.copy(p.dirLocal).applyQuaternion(_qq);
        if (p.t < p.bleed) { const k = pulseAt(p.t) * (1 - p.t / p.bleed); if (k > 0.3 && Math.random() < 0.8) spurt(_w, _d, 2, 0.8 + 2.6 * k); }
        else if (Math.random() < dt * 3) spurt(_w, V(0, -1, 0), 1, 0.2);
        if (p.landed && p.vel.lengthSq() < 0.05 && p.t < p.bleed + 3) { p.poolT -= dt; if (p.poolT <= 0) { p.poolT = 1.2; addSplat(V(_w.x, 0, _w.z), V(0, 1, 0), 0.35 + Math.random() * 0.35, 2.5); } }
      }
    }
    // pieces push each other apart (simple spheres)
    for (let i = 0; i < pieces.length; i++) for (let j = i + 1; j < pieces.length; j++) {
      const a = pieces[i], b = pieces[j]; const d = b.o.position.clone().sub(a.o.position); const L = d.length(), R = (a.r + b.r) * 0.8;
      if (L > 1e-4 && L < R) { d.divideScalar(L); const push = (R - L) * 0.5; a.o.position.addScaledVector(d, -push); b.o.position.addScaledVector(d, push);
        const rel = b.vel.clone().sub(a.vel).dot(d); if (rel < 0) { a.vel.addScaledVector(d, rel * 0.5); b.vel.addScaledVector(d, -rel * 0.5); } }
    }
    // standing avatars that had a part ripped off keep bleeding from the hole
    for (const a of bleedingAvatars) {
      if (!a.parent) { bleedingAvatars.delete(a); continue; }
      for (const b of a.userData.bleeds) {
        b.t += dt; if (b.t > 9) continue;
        _w.copy(b.jointLocal); b.body.localToWorld(_w); b.body.getWorldQuaternion(_qq); _d.copy(b.dirLocal).applyQuaternion(_qq);
        const k = pulseAt(b.t) * Math.max(0.15, 1 - b.t / 7); if (k > 0.3 && Math.random() < 0.8) spurt(_w, _d.clone().add(V(0, 0.4, 0)), 2, 0.8 + 3 * k);
        b.poolT = (b.poolT ?? 0.8) - dt; if (b.poolT <= 0) { b.poolT = 1.4; addSplat(V(_w.x, 0, _w.z).addScaledVector(_d, 0.25), V(0, 1, 0), 0.3 + Math.random() * 0.4, 2.5); }
      }
    }
  }
  return { G, makeAvatar, makeLimb, dismember, tearOff, update, spurt, sfx, audio, jointInfo };
}
