// The Hollow Grin: an original monster built from code. Gaunt, pale, hunched, with a split grin of needle teeth.
// Interface used by game.js: { g, torso, neck, head, jaw, eyes, arms[{sh, el, hand, bl}], legs[], drips[], LEAN, NECK }
import * as THREE from 'three';

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

  // ---- torso: an emaciated ribcage on a thin waist, hunched forward ----
  const HIP = 1.15, LEAN = 0.55, NECK = 0.55;
  const torso = new THREE.Group(); torso.position.y = HIP; g.add(torso);
  const prof = [[0.0, 0.15], [0.12, 0.17], [0.28, 0.12], [0.45, 0.17], [0.62, 0.25], [0.82, 0.29], [0.98, 0.27], [1.08, 0.18], [1.14, 0.08]].map(([y, rr]) => new THREE.Vector2(rr, y));
  const chest = mesh(new THREE.LatheGeometry(prof, 20), skin, torso); chest.scale.z = 0.72;
  for (let i = 0; i < 6; i++) { const y = 0.5 + i * 0.075, rr = 0.2 + Math.sin((i + 1) / 7 * Math.PI) * 0.08; const rib = mesh(new THREE.TorusGeometry(rr, 0.014, 6, 18, Math.PI * 0.8), skinDark, torso, 0, y, 0.0); rib.rotation.set(Math.PI / 2, 0, Math.PI * 0.1); rib.scale.set(1, 0.72, 1); }
  for (let i = 0; i < 10; i++) mesh(new THREE.SphereGeometry(0.035, 8, 6), skin, torso, 0, 0.15 + i * 0.1, -0.15 - Math.sin(i / 9 * Math.PI) * 0.06); // spine bumps
  // collarbones / shoulder knobs
  for (const sx of [-1, 1]) { seg(torso, [0, 1.06, 0.06], [0.27 * sx, 1.0, 0], 0.03, 0.03, skinDark, false); mesh(new THREE.SphereGeometry(0.075, 12, 10), skin, torso, 0.28 * sx, 0.98, 0); }

  // ---- neck + head ----
  const neck = new THREE.Group(); neck.position.set(0, 1.1, 0.04); torso.add(neck); neck.rotation.x = NECK;
  seg(neck, [0, 0, 0], [0, 0.34, 0], 0.07, 0.055);
  const head = new THREE.Group(); head.position.set(0, 0.36, 0.02); neck.add(head);
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

  // ---- arms: very long, with knuckles it walks on and jointed clawed fingers ----
  const arms = [-1, 1].map(sx => {
    const sh = new THREE.Group(); sh.position.set(0.3 * sx, 0.98, 0); torso.add(sh);
    seg(sh, [0, 0, 0], [0, -0.85, 0], 0.06, 0.045);
    const el = new THREE.Group(); el.position.y = -0.85; sh.add(el);
    seg(el, [0, 0, 0], [0, -0.88, 0], 0.048, 0.035);
    const hand = new THREE.Group(); hand.position.y = -0.88; el.add(hand);
    mesh(new THREE.SphereGeometry(0.06, 12, 8), skin, hand, 0, -0.03, 0.02).scale.set(1.1, 0.7, 1.2);
    for (let f = 0; f < 4; f++) {
      const x = (f - 1.5) * 0.035; const a1 = [x, -0.04, 0.05], a2 = [x * 1.4, -0.14, 0.13], a3 = [x * 1.7, -0.22, 0.17];
      seg(hand, a1, a2, 0.016, 0.013); seg(hand, a2, a3, 0.013, 0.01);
      const c = mesh(new THREE.ConeGeometry(0.01, 0.09, 6), claw, hand, a3[0], a3[1] - 0.035, a3[2] + 0.02); c.rotation.x = Math.PI - 0.5;
      mesh(new THREE.SphereGeometry(0.012, 6, 4), oldBlood, hand, a3[0], a3[1] - 0.01, a3[2]);
    }
    const bl = mesh(new THREE.SphereGeometry(0.07, 8, 6), blood, hand, 0, -0.12, 0.1); bl.scale.set(1.2, 0.6, 1); bl.visible = false;
    return { sh, el, hand, bl };
  });

  // ---- legs: backward-bending, like a hound's ----
  const legs = [-1, 1].map(sx => {
    const l = new THREE.Group(); l.position.set(0.13 * sx, HIP, 0); g.add(l);
    seg(l, [0, 0, 0], [0, -0.52, 0.22], 0.07, 0.05); seg(l, [0, -0.52, 0.22], [0, -0.98, -0.12], 0.045, 0.03); seg(l, [0, -0.98, -0.12], [0, -1.12, 0.16], 0.03, 0.022);
    for (const tx of [-0.025, 0, 0.025]) { const c = mesh(new THREE.ConeGeometry(0.008, 0.06, 6), claw, l, tx, -1.13, 0.2); c.rotation.x = Math.PI / 2; }
    return l;
  });

  return { g, torso, neck, head, jaw, eyes, arms, legs, drips, LEAN, NECK, HIP };
}
