// The Hollow Grin: an original monster built from code. Gaunt, pale, with a split grin of needle teeth.
// It is a PLAYER avatar (you become it with the red button): no legs, a floating ribcage under your head,
// arms with a real joint chain (shoulder > upper arm > elbow > forearm > wrist > hand) solved with two-bone IK
// to your controllers, wrists that turn with them, and 3-joint clawed fingers that curl with trigger / grip / thumb.
// Interface used by game.js: { g, torso, neck, head, jaw, eyes, arms[{sh, el, wr, palm, bl}], drips[], NECK, updatePlayer(head, inputs, dt, t, talk), handPos(s) }
import * as THREE from 'three';
import { twoBoneIK } from './gorilla.js';

function skinTexture() {
  const c = document.createElement('canvas'); c.width = c.height = 512; const g = c.getContext('2d');
  let s = 4242; const r = () => (s = (s * 16807) % 2147483647) / 2147483647;
  g.fillStyle = '#c9bfae'; g.fillRect(0, 0, 512, 512);
  for (let i = 0; i < 900; i++) { g.fillStyle = `rgba(${90 + r() * 40},${95 + r() * 40},${80 + r() * 30},${0.05 + r() * 0.08})`; g.beginPath(); g.arc(r() * 512, r() * 512, 4 + r() * 30, 0, 7); g.fill(); }
  for (let v = 0; v < 26; v++) { // veins
    let x = r() * 512, y = r() * 512, a = r() * 6.28; g.strokeStyle = `rgba(${70 + r() * 30},${50 + r() * 20},${90 + r() * 30},0.35)`; g.lineWidth = 1 + r() * 2; g.beginPath(); g.moveTo(x, y);
    for (let k = 0; k < 30; k++) { a += (r() - 0.5) * 0.8; x += Math.cos(a) * 8; y += Math.sin(a) * 8; g.lineTo(x, y); } g.stroke();
  }
  for (let i = 0; i < 400; i++) { g.fillStyle = `rgba(60,50,40,${r() * 0.12})`; g.fillRect(r() * 512, r() * 512, 2, 2); }
  const t = new THREE.CanvasTexture(c); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.colorSpace = THREE.SRGBColorSpace; return t;
}

export function makeMonster(scene) {
  const tex = skinTexture();
  const skin = new THREE.MeshStandardMaterial({ map: tex, roughness: 0.62, metalness: 0 });
  const skinDark = new THREE.MeshStandardMaterial({ color: '#8c8175', roughness: 0.7 });
  const cavity = new THREE.MeshStandardMaterial({ color: '#1c0003', roughness: 0.9 });
  const gum = new THREE.MeshStandardMaterial({ color: '#3a0408', roughness: 0.4 });
  const tooth = new THREE.MeshStandardMaterial({ color: '#e9dfc6', roughness: 0.3 });
  const claw = new THREE.MeshStandardMaterial({ color: '#2b241c', roughness: 0.35 });
  const socket = new THREE.MeshStandardMaterial({ color: '#030303', roughness: 1 });
  const pupil = new THREE.MeshStandardMaterial({ color: '#fff4c8', emissive: '#fff0b0', emissiveIntensity: 2.2 });
  const oldBlood = new THREE.MeshStandardMaterial({ color: '#3d0506', roughness: 0.55 });
  const blood = new THREE.MeshStandardMaterial({ color: '#7a0009', roughness: 0.15, metalness: 0.1 });
  let s = 99; const r = () => (s = (s * 16807) % 2147483647) / 2147483647;

  const g = new THREE.Group(); scene.add(g);
  const mesh = (geo, m, parent, x = 0, y = 0, z = 0) => { const o = new THREE.Mesh(geo, m); o.position.set(x, y, z); o.castShadow = true; parent.add(o); return o; };
  // a tapered limb segment from a to b (in parent space), with a joint ball at a
  const seg = (parent, a, b, r0, r1, m = skin, joint = true) => {
    const A = new THREE.Vector3(...a), B = new THREE.Vector3(...b), d = B.clone().sub(A), L = d.length();
    const o = mesh(new THREE.CylinderGeometry(r1, r0, L, 12, 1), m, parent); o.position.copy(A).addScaledVector(d, 0.5);
    o.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), d.normalize()); if (joint) mesh(new THREE.SphereGeometry(r0 * 1.05, 12, 10), m, parent, ...a); return o;
  };

  // ---- torso: an emaciated ribcage on a thin waist, no legs (it floats under your head, like the gorilla) ----
  const HIP = 0.55, LEAN = 0.1, NECK = 0.12;
  const torso = new THREE.Group(); torso.position.y = HIP; g.add(torso);
  const prof = [[-0.08, 0.0], [-0.06, 0.07], [0.0, 0.13], [0.12, 0.16], [0.28, 0.12], [0.45, 0.17], [0.62, 0.25], [0.82, 0.29], [0.98, 0.27], [1.08, 0.18], [1.14, 0.08]].map(([y, rr]) => new THREE.Vector2(rr, y));
  const chest = mesh(new THREE.LatheGeometry(prof, 20), skin, torso); chest.scale.z = 0.72;
  for (let i = 0; i < 6; i++) { const y = 0.5 + i * 0.075, rr = 0.2 + Math.sin((i + 1) / 7 * Math.PI) * 0.08; const rib = mesh(new THREE.TorusGeometry(rr, 0.014, 6, 18, Math.PI * 0.8), skinDark, torso, 0, y, 0.0); rib.rotation.set(Math.PI / 2, 0, Math.PI * 0.1); rib.scale.set(1, 0.72, 1); }
  for (let i = 0; i < 10; i++) mesh(new THREE.SphereGeometry(0.035, 8, 6), skin, torso, 0, 0.05 + i * 0.105, -0.15 - Math.sin(i / 9 * Math.PI) * 0.06); // spine bumps
  // collarbones / shoulder knobs
  for (const sx of [-1, 1]) { seg(torso, [0, 1.06, 0.06], [0.27 * sx, 1.0, 0], 0.03, 0.03, skinDark, false); mesh(new THREE.SphereGeometry(0.075, 12, 10), skin, torso, 0.28 * sx, 0.98, 0.07); }

  // ---- neck + head ----
  const neck = new THREE.Group(); neck.position.set(0, 1.1, 0.04); torso.add(neck); neck.rotation.x = NECK;
  seg(neck, [0, 0, 0], [0, 0.17, 0], 0.07, 0.06);
  const head = new THREE.Group(); head.position.set(0, 0.19, 0.02); neck.add(head);
  mesh(new THREE.SphereGeometry(0.23, 24, 18), skin, head, 0, 0.07, -0.02).scale.set(0.92, 1.05, 1.15);           // long skull
  mesh(new THREE.SphereGeometry(0.2, 20, 14), skin, head, 0, 0.13, 0.08).scale.set(1.0, 0.45, 1.0);              // heavy brow
  const eyes = [];
  for (const sx of [-1, 1]) {
    mesh(new THREE.SphereGeometry(0.058, 14, 10), socket, head, 0.085 * sx, 0.075, 0.205).scale.set(1, 0.8, 0.6); // sunken sockets
    eyes.push(mesh(new THREE.SphereGeometry(0.013, 8, 6), pupil, head, 0.085 * sx, 0.07, 0.235));               // pinprick pupils
  }
  mesh(new THREE.SphereGeometry(0.03, 8, 6), socket, head, -0.022, 0.0, 0.25); mesh(new THREE.SphereGeometry(0.03, 8, 6), socket, head, 0.022, 0.0, 0.25); // nose slits
  // the split grin: a dark cavity wider than the face, ringed by gums and long uneven needle teeth
  mesh(new THREE.SphereGeometry(0.2, 24, 12), cavity, head, 0, -0.08, 0.12).scale.set(1.35, 0.42, 0.75);
  const grinArc = (u) => { const a = (u - 0.5) * 2.4; return [Math.sin(a) * 0.26, -0.05 + Math.pow(Math.abs(u - 0.5) * 2, 2) * 0.06, 0.13 + Math.cos(a) * 0.12]; };
  const upperGum = new THREE.Group(); head.add(upperGum);
  for (let i = 0; i <= 20; i++) { const [x, y, z] = grinArc(i / 20); mesh(new THREE.SphereGeometry(0.014, 8, 6), gum, upperGum, x, y + 0.008, z);
    const L = 0.05 + r() * 0.08 + (i % 4 === 0 ? 0.05 : 0); const t = mesh(new THREE.ConeGeometry(0.011 + r() * 0.006, L, 6), tooth, upperGum, x, y - L / 2, z); t.rotation.z = Math.PI + (r() - 0.5) * 0.3; t.rotation.x = (r() - 0.5) * 0.3; }
  for (const sx of [-1, 1]) { const lip = mesh(new THREE.TorusGeometry(0.06, 0.012, 6, 12, Math.PI), skinDark, head, 0.27 * sx, -0.06, 0.08); lip.rotation.y = sx * 1.2; } // stretched mouth corners
  const jaw = new THREE.Group(); jaw.position.set(0, -0.06, -0.02); head.add(jaw);
  mesh(new THREE.SphereGeometry(0.2, 20, 12, 0, Math.PI * 2, Math.PI * 0.5, Math.PI * 0.5), skin, jaw, 0, -0.03, 0.14).scale.set(1.3, 0.55, 0.9); // lower jaw
  for (let i = 0; i <= 18; i++) { const [x, y, z] = grinArc(0.04 + i / 18 * 0.92); mesh(new THREE.SphereGeometry(0.013, 8, 6), gum, jaw, x * 0.95, y - 0.045, z * 0.97 - 0.01);
    const L = 0.04 + r() * 0.06; const t = mesh(new THREE.ConeGeometry(0.01 + r() * 0.005, L, 6), tooth, jaw, x * 0.95, y - 0.04 + L / 2, z * 0.97 - 0.01); t.rotation.x = (r() - 0.5) * 0.3; }
  for (let i = 0; i < 5; i++) mesh(new THREE.SphereGeometry(0.035 + r() * 0.03, 8, 6), oldBlood, jaw, (r() - 0.5) * 0.3, -0.1 - r() * 0.03, 0.22 + r() * 0.04).scale.set(1, 0.35, 0.5); // dried blood on the chin
  const drips = []; for (let i = 0; i < 9; i++) { const [x, y, z] = grinArc(0.1 + i / 8 * 0.8); const d = mesh(new THREE.CylinderGeometry(0.008, 0.003, 0.12 + r() * 0.12, 6), blood, head, x, y - 0.12, z + 0.01); d.visible = false; drips.push(d); }

  // ---- arms: a real joint chain sized to YOUR arms (hands land where your controllers are) ----
  // shoulder group > upper arm (bicep bulge) > elbow group (knob) > forearm (thick at the elbow, tapering) > wrist group > palm + fingers.
  // At rest every segment hangs along -Y. In the wrist frame: fingers point -Y, the palm faces +Z, the thumb is on +X (left) / -X (right).
  const L1 = 0.5, L2 = 0.47;                       // upper arm, forearm (world metres; your rig is 1.35x when you are the monster)
  const lathe = (pts, m, parent, segs = 14) => mesh(new THREE.LatheGeometry(pts.map(([y, rr]) => new THREE.Vector2(rr * 1.3, y)), segs), m, parent);
  const tendon = new THREE.MeshStandardMaterial({ color: '#b3a691', roughness: 0.55 });
  const FINGERS = ['index', 'middle', 'ring', 'pinky', 'thumb'];
  const arms = [-1, 1].map(sx => {
    const sh = new THREE.Group(); sh.position.set(0.3 * sx, 0.98, 0.09); torso.add(sh);
    mesh(new THREE.SphereGeometry(0.082, 14, 10), skin, sh);                                               // shoulder ball
    // upper arm, with a bicep bulge at the front and a triceps at the back
    lathe([[-L1, 0.046], [-0.42, 0.044], [-0.3, 0.05], [-0.16, 0.06], [-0.06, 0.062], [0, 0.058]], skin, sh);
    mesh(new THREE.SphereGeometry(1, 14, 10), skin, sh, 0, -0.2, 0.036).scale.set(0.062, 0.14, 0.058);       // bicep
    mesh(new THREE.SphereGeometry(1, 12, 8), skin, sh, 0, -0.17, -0.034).scale.set(0.056, 0.15, 0.05);      // triceps
    const el = new THREE.Group(); el.position.y = -L1; sh.add(el);
    mesh(new THREE.SphereGeometry(0.064, 12, 10), skin, el);                                                // elbow joint
    mesh(new THREE.SphereGeometry(1, 10, 8), skinDark, el, 0, 0.005, -0.04).scale.set(0.03, 0.035, 0.03); // pointy elbow bone at the back
    // forearm: thick near the elbow, then a long taper to a thin wrist, with tendons standing out near the wrist
    lathe([[-L2, 0.03], [-0.38, 0.032], [-0.26, 0.042], [-0.14, 0.056], [-0.06, 0.06], [0, 0.05]], skin, el);
    mesh(new THREE.SphereGeometry(1, 12, 8), skin, el, 0.012 * sx, -0.11, 0.026).scale.set(0.064, 0.12, 0.056); // forearm muscle bulge
    for (const [x, z] of [[0.016, 0.026], [-0.012, 0.028], [0.0, -0.028]]) mesh(new THREE.CylinderGeometry(0.005, 0.006, 0.22, 6), tendon, el, x, -0.34, z);
    const wr = new THREE.Group(); wr.position.y = -L2; el.add(wr);
    mesh(new THREE.SphereGeometry(0.034, 12, 8), skin, wr);                                                // wrist knob
    const palm = new THREE.Group(); palm.position.set(0, -0.06, 0); wr.add(palm);
    mesh(new THREE.SphereGeometry(1, 16, 10), skin, palm).scale.set(0.052, 0.065, 0.024);
    mesh(new THREE.SphereGeometry(1, 10, 8), skinDark, palm, 0, -0.005, 0.016).scale.set(0.04, 0.05, 0.01);   // palm pad
    // fingers: 3 joints each (long and bony), knuckles, a claw at each tip
    const joints = {};
    FINGERS.forEach((f, k) => {
      const chain = []; const base = new THREE.Group();
      if (f === 'thumb') { base.position.set(0.045 * sx, -0.035, 0.012); base.rotation.set(0.35, 0, sx * 0.75); }
      else { base.position.set((1.5 - k) * 0.026 * sx, -0.118, 0.004); base.rotation.z = (1.5 - k) * 0.06 * sx; }
      wr.add(base);
      const lens = f === 'thumb' ? [0.045, 0.04, 0.03] : [0.065 - (k === 3 ? 0.012 : 0), 0.05 - (k === 3 ? 0.008 : 0), 0.04];
      const rads = f === 'thumb' ? [0.014, 0.012, 0.01] : [0.012, 0.0105, 0.009];
      let p = base;
      for (let j = 0; j < 3; j++) {
        const jg = new THREE.Group(); if (j > 0) jg.position.y = -lens[j - 1]; p.add(jg);
        mesh(new THREE.SphereGeometry(rads[j] * 1.15, 8, 6), j === 0 ? skin : skinDark, jg);             // knuckle
        const sgm = mesh(new THREE.CylinderGeometry(rads[j] * 0.85, rads[j], lens[j], 8), skin, jg); sgm.position.y = -lens[j] / 2;
        chain.push(jg); p = jg;
      }
      const c = mesh(new THREE.ConeGeometry(0.008, 0.05, 6), claw, p, 0, -lens[2] - 0.02, 0.004); c.rotation.x = Math.PI + 0.25;   // claw, hooked toward the palm
      joints[f] = chain;
    });
    const bl = mesh(new THREE.SphereGeometry(0.05, 8, 6), blood, palm, 0, -0.03, 0.03); bl.scale.set(1.2, 0.6, 1); bl.visible = false;
    return { sh, el, wr, palm, hand: wr, joints, bl, sx };
  });

  // ---------------- driving it from the headset and controllers ----------------
  const _v = () => new THREE.Vector3(), _q = () => new THREE.Quaternion();
  const UP = new THREE.Vector3(0, 1, 0);
  const setWorldQuat = (o, qw) => { const pq = _q(); o.parent.getWorldQuaternion(pq); o.quaternion.copy(pq.invert().multiply(qw)); o.updateMatrixWorld(true); };
  // eye midpoint relative to g, at rest (no yaw, no pitch)
  torso.rotation.x = LEAN; neck.rotation.x = NECK; head.rotation.set(-(LEAN + NECK), 0, 0); g.position.set(0, 0, 0); g.rotation.set(0, 0, 0); g.updateMatrixWorld(true);
  const EYE = eyes[0].getWorldPosition(_v()).add(eyes[1].getWorldPosition(_v())).multiplyScalar(0.5);
  const curl = {}; for (const s of ['L', 'R']) for (const f of FINGERS) curl[f + s] = 0;
  const armOf = (s) => arms[s === 'R' ? 0 : 1];          // arms[0] is on its right side (x < 0)

  function updatePlayer(headObj, inputs, dt, t, talk = 0) {
    const camPos = headObj.getWorldPosition(_v()), camQ = headObj.getWorldQuaternion(_q());
    const fwd = _v().set(0, 0, -1).applyQuaternion(camQ); const yaw = Math.atan2(fwd.x, fwd.z), pitch = Math.asin(THREE.MathUtils.clamp(fwd.y, -1, 1));
    g.rotation.set(0, yaw, 0); g.position.copy(camPos).sub(EYE.clone().applyAxisAngle(UP, yaw));
    torso.rotation.set(LEAN, 0, 0); neck.rotation.set(NECK, 0, 0);
    head.rotation.set(-(LEAN + NECK) - pitch * 0.9, 0, 0);
    jaw.rotation.x = 0.06 + 0.85 * talk;
    eyes.forEach(e => e.material.emissiveIntensity = 1.8 + Math.sin(t * 9) * 0.6 + talk * 2);
    g.updateMatrixWorld(true);
    const k = 1 - Math.exp(-dt * 18);
    for (const s of ['L', 'R']) {
      const A = armOf(s), sx = s === 'L' ? 1 : -1, inp = inputs[s];
      A.sh.quaternion.identity(); A.el.quaternion.identity(); A.wr.quaternion.identity();
      if (!inp || !inp.pos) continue;
      const gq = inp.quat;
      const fingerDir = _v().set(0, 0, -1).applyQuaternion(gq);
      const palmN = _v().set(sx, 0, 0).applyQuaternion(gq);                       // grip space: palm normal +X (left) / -X (right)
      const wristT = inp.pos.clone().addScaledVector(fingerDir, -0.07);           // the palm centre sits on the controller
      const pole = _v().set(sx * 0.9, -0.55, -0.6).applyAxisAngle(UP, yaw);       // elbows out, down and back
      twoBoneIK(A.sh, A.el, A.wr, wristT, pole, L1, L2);
      // wrist frame: fingers along -Y, palm along +Z
      const yAx = fingerDir.clone().negate(); const zAx = palmN.sub(yAx.clone().multiplyScalar(palmN.dot(yAx))).normalize();
      const basis = new THREE.Matrix4().makeBasis(yAx.clone().cross(zAx).normalize(), yAx, zAx);
      setWorldQuat(A.wr, _q().setFromRotationMatrix(basis));
      // fingers from the controller, smoothed
      const gp = inp.gamepad, b = (i) => gp && gp.buttons && gp.buttons[i];
      const trig = b(0) ? b(0).value : 0, grip = b(1) ? b(1).value : 0;
      const thumb = gp ? [3, 4, 5].some(i => b(i) && (b(i).touched || b(i).pressed)) : false;
      const target = { index: 0.15 + trig * 1.15, middle: 0.2 + grip * 1.1, ring: 0.25 + grip * 1.1, pinky: 0.3 + grip * 1.1, thumb: thumb ? 0.9 : 0.15 };
      for (const f of FINGERS) {
        const key = f + s; curl[key] += (target[f] - curl[key]) * k; const c = curl[key];
        A.joints[f].forEach((jg, j) => { jg.rotation.x = -c * [0.85, 1.1, 0.9][j]; });   // negative X curls toward the palm (+Z)
      }
    }
    g.updateMatrixWorld(true);
  }
  const handPos = (s) => armOf(s).palm.getWorldPosition(_v());

  return { g, torso, neck, head, jaw, eyes, arms, drips, LEAN, NECK, HIP, L1, L2, updatePlayer, handPos };
}
