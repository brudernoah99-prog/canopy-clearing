// Scruff (the player critter, built in Blender: models/critter.glb) and what happens when the monster gets one:
// the head and arms pop off and tumble away, blood spurting from the stumps, splats where pieces land.
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

export async function initGore(scene, addSplat) {
  const gltf = await new GLTFLoader().loadAsync('./models/gorilla_parts.glb');
  gltf.scene.traverse(o => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
  // the gorilla's parts are exported in place (origin at the feet): give each a pivot at its own centre so it tumbles naturally
  for (const name of ['Body', 'Head', 'Arm_L', 'Arm_R']) {
    const o = gltf.scene.getObjectByName(name); if (!o) continue;
    const c = new THREE.Box3().setFromObject(o).getCenter(new THREE.Vector3());
    const pivot = new THREE.Group(); pivot.name = name; pivot.position.copy(c); o.name = name + '_mesh';
    gltf.scene.add(pivot); pivot.attach(o);
  }
  const partsOf = (root) => { const p = {}; root.traverse(o => { if (['Body', 'Head', 'Arm_L', 'Arm_R'].includes(o.name)) p[o.name] = o; }); return p; };
  const makePart = (name) => { const o = gltf.scene.getObjectByName(name).clone(true); o.traverse(m => { if (m.isMesh) m.castShadow = true; }); return o; };
  const makeAvatar = () => { const a = gltf.scene.clone(true); a.userData.parts = partsOf(a); scene.add(a); return a; };

  // blood droplets (a fixed pool, reused)
  const dropMat = new THREE.MeshStandardMaterial({ color: '#7a0009', roughness: 0.2 });
  const dropGeo = new THREE.SphereGeometry(0.025, 6, 4);
  const drops = Array.from({ length: 220 }, () => { const m = new THREE.Mesh(dropGeo, dropMat); m.visible = false; m.userData.v = new THREE.Vector3(); scene.add(m); return m; });
  let di = 0;
  const spurt = (pos, dir, n, speed) => { for (let i = 0; i < n; i++) { const d = drops[di = (di + 1) % drops.length]; d.visible = true; d.position.copy(pos);
    d.userData.v.copy(dir).multiplyScalar(speed * (0.6 + Math.random() * 0.6)).add(new THREE.Vector3((Math.random() - 0.5) * 1.2, Math.random() * 0.8, (Math.random() - 0.5) * 1.2)); d.scale.setScalar(0.6 + Math.random()); } };

  const corpses = [];
  // tear apart an avatar where it stands (it is consumed: its parts become loose pieces)
  function dismember(avatar, push = new THREE.Vector3(0, 0, 1)) {
    avatar.updateMatrixWorld(true); const P = avatar.userData.parts; const side = new THREE.Vector3(push.z, 0, -push.x).normalize();
    const pieces = [];
    const loose = (o, vel, spin, bleed, stumpDir) => { scene.attach(o); pieces.push({ o, vel, spin, bleed, stumpDir, landed: false }); };
    const r = () => Math.random() - 0.5;
    loose(P.Head, push.clone().multiplyScalar(1.5).add(new THREE.Vector3(r(), 5.2, r())), new THREE.Vector3(r() * 12, r() * 8, r() * 12), 1.4, new THREE.Vector3(0, -1, 0));
    loose(P.Arm_L, side.clone().multiplyScalar(3.2).add(new THREE.Vector3(r(), 2.8, r())), new THREE.Vector3(r() * 14, r() * 10, r() * 14), 1.1, side.clone());
    loose(P.Arm_R, side.clone().multiplyScalar(-3.2).add(new THREE.Vector3(r(), 2.8, r())), new THREE.Vector3(r() * 14, r() * 10, r() * 14), 1.1, side.clone().negate());
    loose(P.Body, push.clone().multiplyScalar(0.8).add(new THREE.Vector3(0, 0.6, 0)), new THREE.Vector3(2.2, 0, r()), 2.2, new THREE.Vector3(0, 1, 0));
    pieces[3].isBody = true;
    scene.remove(avatar);
    const at = pieces[3].o.getWorldPosition(new THREE.Vector3());
    for (let i = 0; i < 5; i++) addSplat(new THREE.Vector3(at.x + r() * 1.6, 0, at.z + r() * 1.6), new THREE.Vector3(0, 1, 0), 0.5 + Math.random() * 0.9);
    spurt(at.clone().setY(at.y + 0.4), new THREE.Vector3(0, 1, 0), 40, 3.5);
    corpses.push({ pieces, t: 0 });
    while (corpses.length > 7) corpses.shift().pieces.forEach(p => scene.remove(p.o));
  }

  const tmp = new THREE.Vector3(), q = new THREE.Quaternion();
  function update(dt) {
    for (const c of corpses) {
      c.t += dt;
      for (const p of c.pieces) {
        const o = p.o; p.vel.y -= 9.8 * dt; o.position.addScaledVector(p.vel, dt);
        o.rotation.x += p.spin.x * dt; o.rotation.y += p.spin.y * dt; o.rotation.z += p.spin.z * dt;
        const floor = p.isBody ? 0.3 : 0.1;
        if (o.position.y < floor) {
          o.position.y = floor; if (!p.landed) { p.landed = true; addSplat(new THREE.Vector3(o.position.x, 0, o.position.z), new THREE.Vector3(0, 1, 0), 0.4 + Math.random() * 0.5); }
          p.vel.y *= -0.3; p.vel.x *= 0.55; p.vel.z *= 0.55; p.spin.multiplyScalar(0.55);
          if (p.isBody) o.rotation.x += (Math.PI / 2 - o.rotation.x) * Math.min(1, dt * 6); // slumps onto its back
        }
        // blood spurts from the stump while it's fresh
        if (c.t < p.bleed && Math.random() < 0.7) { o.getWorldQuaternion(q); tmp.copy(p.stumpDir).applyQuaternion(q); spurt(o.getWorldPosition(new THREE.Vector3()), tmp, p.isBody ? 3 : 2, 2.2 * (1 - c.t / p.bleed) + 0.4); }
      }
    }
    for (const d of drops) {
      if (!d.visible) continue; d.userData.v.y -= 9.8 * dt; d.position.addScaledVector(d.userData.v, dt);
      if (d.position.y < 0.01) { d.visible = false; if (Math.random() < 0.08) addSplat(new THREE.Vector3(d.position.x, 0, d.position.z), new THREE.Vector3(0, 1, 0), 0.15 + Math.random() * 0.25); }
    }
  }
  // let a single loose piece (e.g. an arm you threw) fall and bleed with the gore physics
  function addLoose(o, vel, spin, bleed, stumpDir) { scene.attach(o); corpses.push({ pieces: [{ o, vel, spin, bleed, stumpDir, landed: false }], t: 0 }); while (corpses.length > 7) corpses.shift().pieces.forEach(p => scene.remove(p.o)); }
  return { makeAvatar, makePart, dismember, update, spurt, addLoose };
}
