// The gorilla player: a rigged model (models/gorilla.glb) driven by the VR headset and controllers.
//  - your head turns its head (the body follows your facing direction)
//  - two-bone IK puts its shoulders/elbows/wrists where your hands are, wrists turn with your controllers
//  - fingers: TRIGGER curls the index, GRIP curls middle/ring/pinky, touching a button/stick puts the thumb down;
//    while a hand presses on a surface the fingers spread and press flat
//  - voice: jaw opens with your volume; screaming makes the eyes bulge
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import * as SkeletonUtils from 'three/addons/utils/SkeletonUtils.js';

const gltf = await new GLTFLoader().loadAsync('./models/gorilla.glb');
const FINGERS = ['index', 'middle', 'ring', 'pinky', 'thumb'];
const V = () => new THREE.Vector3(), Q = () => new THREE.Quaternion();
const X = new THREE.Vector3(1, 0, 0), Yax = new THREE.Vector3(0, 1, 0), Z = new THREE.Vector3(0, 0, 1);
const clamp = (x, a, b) => Math.max(a, Math.min(b, x));
const sstep = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };

function setWorldQuat(bone, qWorld) {
  const pq = Q(); bone.parent.getWorldQuaternion(pq); bone.quaternion.copy(pq.invert().multiply(qWorld)); bone.updateMatrixWorld(true);
}
export function aim(bone, childBone, target) {          // rotate a bone so that its child joint lands on target
  const s = bone.getWorldPosition(V()), c = childBone.getWorldPosition(V());
  const q = Q().setFromUnitVectors(c.sub(s).normalize(), target.clone().sub(s).normalize());
  const wq = Q(); bone.getWorldQuaternion(wq); setWorldQuat(bone, q.multiply(wq));
}

// two-bone IK: rotate upper and lower so the end joint reaches target, the middle joint bending toward pole
export function twoBoneIK(upper, lower, end, target, pole, L1, L2) {
  const S = upper.getWorldPosition(V()); const toT = target.clone().sub(S);
  const d = clamp(toT.length(), Math.abs(L1 - L2) + 0.02, L1 + L2 - 0.002); const dir = toT.normalize();
  const a = (L1 * L1 - L2 * L2 + d * d) / (2 * d), h = Math.sqrt(Math.max(0, L1 * L1 - a * a));
  const bend = pole.clone().sub(dir.clone().multiplyScalar(pole.dot(dir))).normalize();
  aim(upper, lower, S.clone().addScaledVector(dir, a).addScaledVector(bend, h));
  aim(lower, end, S.clone().addScaledVector(dir, d));
}
const easeOutBack = (x, c = 1.25) => 1 + (c + 1) * Math.pow(x - 1, 3) + c * Math.pow(x - 1, 2);
const GROW_TIME = 8;   // seconds for a ripped arm to grow back: blood rushes in, then muscle + tendons, then skin
const ARM_BONE = /^(upperarm|forearm|hand|index\d|middle\d|ring\d|pinky\d|thumb\d)_(L|R)$/;
const ramp = (a, b, x) => clamp((x - a) / (b - a), 0, 1);

// fur/skin: arm fragments past the skin front are cut away, with a raw red edge right at the front
function furRegrowShader(mat, U) {
  mat.onBeforeCompile = (sh) => {
    sh.uniforms.uSkinL = U.skinL; sh.uniforms.uSkinR = U.skinR;
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nattribute float armSide;\nattribute float armT;\nvarying float vArmSide;\nvarying float vArmT;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvArmSide = armSide; vArmT = armT;');
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform float uSkinL;\nuniform float uSkinR;\nvarying float vArmSide;\nvarying float vArmT;')
      .replace('#include <clipping_planes_fragment>', `#include <clipping_planes_fragment>
        float skinFront = vArmSide > 0.5 ? uSkinL : (vArmSide < -0.5 ? uSkinR : 9.0);
        if (vArmT > skinFront) discard;`)
      .replace('#include <map_fragment>', `#include <map_fragment>
        { float raw = (1.0 - smoothstep(0.0, 0.08, skinFront - vArmT)) * step(skinFront, 1.5);
          diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.42, 0.035, 0.045), raw * 0.9); }`);
  };
  mat.customProgramCacheKey = () => 'gorilla-fur-regrow';
}
// the inside layers of a regrowing arm: pulsing veins first, then striated muscle with pale tendons
function layerShader(mat, U) {
  mat.onBeforeCompile = (sh) => {
    for (const k of ['bloodL', 'bloodR', 'muscleL', 'muscleR', 'skinL', 'skinR', 'time']) sh.uniforms['u' + k[0].toUpperCase() + k.slice(1)] = U[k];
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nattribute float armSide;\nattribute float armT;\nattribute float armA;\nvarying float vArmSide;\nvarying float vArmT;\nvarying float vArmA;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\ntransformed -= objectNormal * 0.004;\nvArmSide = armSide; vArmT = armT; vArmA = armA;');
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', `#include <common>
        uniform float uBloodL; uniform float uBloodR; uniform float uMuscleL; uniform float uMuscleR; uniform float uSkinL; uniform float uSkinR; uniform float uTime;
        varying float vArmSide; varying float vArmT; varying float vArmA;`)
      .replace('#include <clipping_planes_fragment>', `#include <clipping_planes_fragment>
        float sd = vArmSide;
        if (abs(sd) < 0.5) discard;
        float bF = sd > 0.0 ? uBloodL : uBloodR, mF = sd > 0.0 ? uMuscleL : uMuscleR, sF = sd > 0.0 ? uSkinL : uSkinR;
        float t = vArmT, a = vArmA;
        if (t > bF || t < sF - 0.03) discard;                       // not grown yet, or already under the skin
        float l1 = abs(sin(a * 4.0 + sin(t * 23.0 + a * 2.0) * 0.9));
        float l2 = abs(sin(a * 7.0 - sin(t * 31.0 + 1.3) * 1.2 + 2.0));
        float l3 = abs(sin(a * 11.0 + t * 9.0 + sin(t * 47.0) * 0.6));
        float vein = max(max(1.0 - smoothstep(0.08, 0.2, l1), (1.0 - smoothstep(0.05, 0.15, l2)) * 0.95), (1.0 - smoothstep(0.02, 0.09, l3)) * 0.75);
        float muscle = 1.0 - smoothstep(mF - 0.04, mF, t);
        if (muscle < 0.5 && vein < 0.4) discard;                    // ahead of the muscle only the vessels exist
        float pulse = 0.5 + 0.5 * sin(t * 26.0 - uTime * 11.0);     // blood rushing outward along the vessels
        float bloodHead = 1.0 - smoothstep(0.0, 0.08, bF - t);      // the leading tip of the blood glows brightest`)
      .replace('#include <map_fragment>', `#include <map_fragment>
        { float fib = 0.5 + 0.5 * sin(a * 30.0 + sin(t * 18.0) * 0.8);
          float fib2 = 0.5 + 0.5 * sin(a * 63.0 + t * 5.0);
          float handZone = smoothstep(0.78, 0.84, t);   // the hand has no clean axis: calmer fibres there
          vec3 musc = mix(vec3(0.30, 0.025, 0.035), vec3(0.66, 0.11, 0.12), mix(fib * 0.75 + fib2 * 0.25, 0.45 + 0.15 * fib2, handZone));
          float tz = smoothstep(0.38, 0.43, t) * (1.0 - smoothstep(0.50, 0.55, t)) + smoothstep(0.58, 0.63, t) * (1.0 - smoothstep(0.76, 0.8, t)) + smoothstep(0.8, 0.84, t) * 0.35;
          float tendon = clamp(tz, 0.0, 1.0) * smoothstep(0.93, 0.995, abs(sin(a * 6.0 + sin(t * 12.0) * 0.3))) * mix(1.0, 0.6, handZone);
          musc = mix(musc, vec3(0.88, 0.82, 0.72), tendon);
          vec3 veinCol = mix(vec3(0.28, 0.0, 0.02), vec3(0.85, 0.05, 0.07), max(pulse, bloodHead));
          diffuseColor.rgb = muscle > 0.5 ? mix(musc, veinCol, vein * 0.5 * (1.0 - tendon)) : veinCol; }`)
      .replace('#include <roughnessmap_fragment>', '#include <roughnessmap_fragment>\nroughnessFactor = 0.32;')
      .replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\ntotalEmissiveRadiance += vein * max(pulse, bloodHead) * vec3(0.4, 0.0, 0.03) * (muscle > 0.5 ? 0.35 : 1.0);');
  };
  mat.customProgramCacheKey = () => 'gorilla-arm-layers';
}

export function makeGorilla(scene) {
  const root = SkeletonUtils.clone(gltf.scene); scene.add(root);
  const B = {}; const headBits = []; const skinned = [];
  root.traverse(o => {
    if (o.isBone) B[o.name] = o;
    if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; o.frustumCulled = false; }
    if (o.isSkinnedMesh) skinned.push(o);
  });
  root.traverse(o => { if (o.isMesh && !o.isSkinnedMesh) headBits.push(o); });   // eyes, mouth bag, tongue
  const rest = {}; for (const [n, b] of Object.entries(B)) rest[n] = b.quaternion.clone();
  root.updateMatrixWorld(true);
  const wp = (n) => B[n].getWorldPosition(V());
  const EYE = wp('eye_L').add(wp('eye_R')).multiplyScalar(0.5);                     // eye midpoint, model at origin facing +z
  const len = {}; for (const s of ['L', 'R']) len[s] = [wp(`upperarm_${s}`).distanceTo(wp(`forearm_${s}`)), wp(`forearm_${s}`).distanceTo(wp(`hand_${s}`))];
  // rest hand frame: fingers along the hand bone's Y, palm normal = finger bones' Z (pointing inward)
  const handOffset = {};
  for (const s of ['L', 'R']) {
    const hq = Q(); B[`hand_${s}`].getWorldQuaternion(hq);
    const fq = Q(); B[`middle1_${s}`].getWorldQuaternion(fq);
    const fy = Yax.clone().applyQuaternion(hq), pz = Z.clone().applyQuaternion(fq);
    const basis = new THREE.Matrix4().makeBasis(fy.clone().cross(pz).normalize(), fy, pz.clone().sub(fy.clone().multiplyScalar(pz.dot(fy))).normalize());
    handOffset[s] = Q().setFromRotationMatrix(basis).invert().multiply(hq);           // hand bone relative to that frame
  }
  const state = { curl: {}, brace: { L: 0, R: 0 }, headHidden: false, arm: { L: { mode: 'on', t: 1 }, R: { mode: 'on', t: 1 } } };
  // a raw, red stump that shows at the shoulder while an arm is missing
  const stumpMat = new THREE.MeshStandardMaterial({ color: '#8a0a10', roughness: 0.35, emissive: '#2a0003' });
  const boneMat = new THREE.MeshStandardMaterial({ color: '#e8dcc4', roughness: 0.5 });
  const stumps = {};
  for (const s of ['L', 'R']) {
    const g = new THREE.Group(); const sh = B[`shoulder_${s}`] || B[`upperarm_${s}`].parent; sh.add(g); g.position.copy(B[`upperarm_${s}`].position);
    g.add(new THREE.Mesh(new THREE.SphereGeometry(0.075, 14, 10), stumpMat)); const bn = new THREE.Mesh(new THREE.SphereGeometry(0.028, 10, 8), boneMat); bn.position.y = 0.05; g.add(bn);
    g.visible = false; stumps[s] = g;
  }
  // ---- regrow layers ----
  // per-vertex arm coordinates (computed once per geometry, at rest): armSide (+1 left arm, -1 right arm, 0 body),
  // armT (0 at the shoulder .. 1 at the fingertips) and armA (angle around the arm, for fibres / vessels)
  const U = {}; for (const k of ['bloodL', 'bloodR', 'muscleL', 'muscleR', 'skinL', 'skinR', 'time']) U[k] = { value: k === 'time' ? 0 : 9 };
  const axis = {};
  for (const s of ['L', 'R']) {
    const S = wp(`upperarm_${s}`), m3 = wp(`middle3_${s}`), m2 = wp(`middle2_${s}`);
    const tip = m3.clone().add(m3.clone().sub(m2).multiplyScalar(0.8)); const D = tip.clone().sub(S); const L = D.length(); D.normalize();
    const u = V().crossVectors(D, Z).normalize(), w = V().crossVectors(D, u); axis[s] = { S, D, L, u, w };
  }
  const layers = [];
  for (const mesh of skinned) {
    const geo = mesh.geometry; const pos = geo.attributes.position, si = geo.attributes.skinIndex, sw = geo.attributes.skinWeight; if (!si || !sw) continue;
    if (!geo.attributes.armSide) {
      const bones = mesh.skeleton.bones; const sideOf = bones.map(b => { const m = ARM_BONE.exec(b.name); return m ? (m[2] === 'L' ? 1 : -1) : 0; });
      const n = pos.count, aS = new Float32Array(n), aT = new Float32Array(n), aA = new Float32Array(n); const v = V(), r = V(); let any = false;
      mesh.updateMatrixWorld(true);
      for (let i = 0; i < n; i++) {
        let wL = 0, wR = 0; for (let k = 0; k < 4; k++) { const sb = sideOf[si.array[i * 4 + k]] || 0, wt = sw.array[i * 4 + k]; if (sb > 0) wL += wt; else if (sb < 0) wR += wt; }
        const side = wL > 0.4 ? 1 : wR > 0.4 ? -1 : 0; aS[i] = side; if (!side) continue; any = true;
        const ax = axis[side > 0 ? 'L' : 'R']; v.fromBufferAttribute(pos, i).applyMatrix4(mesh.matrixWorld); r.copy(v).sub(ax.S);
        const along = r.dot(ax.D); aT[i] = clamp(along / ax.L, 0, 1); r.addScaledVector(ax.D, -along); aA[i] = Math.atan2(r.dot(ax.w), r.dot(ax.u));
      }
      geo.setAttribute('armSide', new THREE.BufferAttribute(aS, 1)); geo.setAttribute('armT', new THREE.BufferAttribute(aT, 1)); geo.setAttribute('armA', new THREE.BufferAttribute(aA, 1));
      geo.userData.hasArm = any;
    }
    if (!geo.userData.hasArm) continue;
    mesh.material = mesh.material.clone(); furRegrowShader(mesh.material, U);
    // the inside layers: same geometry and skeleton, slightly shrunk, only drawn while an arm is regrowing
    const lm = new THREE.MeshStandardMaterial({ color: '#8a1018', roughness: 0.35, metalness: 0.05 }); layerShader(lm, U);
    const layer = new THREE.SkinnedMesh(geo, lm); layer.bind(mesh.skeleton, mesh.bindMatrix); layer.bindMode = mesh.bindMode;
    layer.position.copy(mesh.position); layer.quaternion.copy(mesh.quaternion); layer.scale.copy(mesh.scale); layer.frustumCulled = false; layer.castShadow = true; layer.visible = false;
    mesh.parent.add(layer); layers.push(layer);
  }
  for (const s of ['L', 'R']) for (const f of FINGERS) state.curl[f + s] = 0;

  function resetPose() { for (const [n, b] of Object.entries(B)) b.quaternion.copy(rest[n]); }

  // fingers: c in [-0.35 (straight back) .. 1.25 (full curl)], spread for bracing
  function fingers(s, values, spread) {
    const sx = s === 'L' ? 1 : -1;
    FINGERS.forEach((f, k) => {
      const c = values[f];
      for (let j = 1; j <= 3; j++) {
        const b = B[`${f}${j}_${s}`]; if (!b) continue;
        const ang = c >= 0 ? c * [1.0, 1.25, 1.0][j - 1] : c * [1.0, 0.4, 0.2][j - 1];
        const q = Q().setFromAxisAngle(X, ang);
        if (j === 1 && f !== 'thumb') q.multiply(Q().setFromAxisAngle(Z, spread * (k - 1.5) * 0.6 * sx));
        b.quaternion.copy(rest[b.name]).multiply(q);
      }
    });
  }

  // input: { camera, hands: {L: {pos, quat, gamepad, stuck}, R: ...}, talk, dt }
  const HEAD_REST = Q(); B.head.getWorldQuaternion(HEAD_REST);   // head bone's rest rotation (model facing +z)
  let tilt = 0;
  function update({ camera, hands, talk = 0, dt = 1 / 72, floorY = -Infinity }) {
    resetPose();
    const camPos = camera.getWorldPosition(V()), camQ = Q(); camera.getWorldQuaternion(camQ);
    const fwd = V().set(0, 0, -1).applyQuaternion(camQ); const yaw = Math.atan2(fwd.x, fwd.z);
    // keep the body out of the floor: if your head is lower than the gorilla is tall, the body swings back behind you at the neck
    const room = camPos.y - floorY - 0.06; const want = room < EYE.y ? Math.acos(clamp(room / EYE.y, 0.15, 1)) : 0;
    tilt += (want - tilt) * Math.min(1, dt * 12);
    const yawQ = Q().setFromAxisAngle(Yax, yaw); root.quaternion.copy(yawQ).multiply(Q().setFromAxisAngle(X, tilt));
    root.position.copy(camPos).sub(EYE.clone().applyQuaternion(root.quaternion));
    root.updateMatrixWorld(true);
    // head follows the headset (relative to the body's facing, whatever the body's tilt)
    const camYaw = Q().setFromAxisAngle(Yax, Math.atan2(-fwd.x, -fwd.z));
    const delta = camQ.clone().multiply(camYaw.invert());
    setWorldQuat(B.head, delta.multiply(yawQ.clone().multiply(HEAD_REST)));
    // arms: IK to the controllers, wrists follow controller rotation
    for (const s of ['L', 'R']) {
      const h = hands[s]; if (!h || !h.pos) continue;
      const sx = s === 'L' ? 1 : -1;
      const gq = h.quat.clone();
      const fingerDir = V().set(0, 0, -1).applyQuaternion(gq);                          // controller forward
      const palm = V().set(sx, 0, 0).applyQuaternion(gq);                               // grip space: palm normal is +X (left) / -X (right)
      const wrist = h.pos.clone().addScaledVector(fingerDir, -0.09);
      const S = B[`upperarm_${s}`].getWorldPosition(V());
      const [L1, L2] = len[s]; const toT = wrist.clone().sub(S); const d = clamp(toT.length(), 0.05, L1 + L2 - 0.002); const dir = toT.normalize();
      const a = (L1 * L1 - L2 * L2 + d * d) / (2 * d), hgt = Math.sqrt(Math.max(0, L1 * L1 - a * a));
      const pole = V().set(sx * 1.0, -0.4, -0.6).applyAxisAngle(Yax, yaw);              // elbows point out, down and back
      const bend = pole.sub(dir.clone().multiplyScalar(pole.dot(dir))).normalize();
      const elbow = S.clone().addScaledVector(dir, a).addScaledVector(bend, hgt);
      const wristT = S.clone().addScaledVector(dir, d);
      aim(B[`upperarm_${s}`], B[`forearm_${s}`], elbow);
      aim(B[`forearm_${s}`], B[`hand_${s}`], wristT);
      const pz = palm.sub(fingerDir.clone().multiplyScalar(palm.dot(fingerDir))).normalize();
      const basis = new THREE.Matrix4().makeBasis(fingerDir.clone().cross(pz).normalize(), fingerDir, pz);
      setWorldQuat(B[`hand_${s}`], Q().setFromRotationMatrix(basis).multiply(handOffset[s]));
      // fingers from the controller (smoothed), flattened while bracing on a surface
      const gp = h.gamepad, btn = (i) => gp && gp.buttons[i];
      const trig = btn(0) ? btn(0).value : 0, grip = btn(1) ? btn(1).value : 0;
      const thumb = gp ? [3, 4, 5].some(i => btn(i) && (btn(i).touched || btn(i).pressed)) : false;
      const target = { index: trig * 1.25, middle: grip * 1.25, ring: grip * 1.25, pinky: grip * 1.25, thumb: thumb ? 0.85 : 0.1 };
      const k = 1 - Math.exp(-dt * 18);
      state.brace[s] += ((h.stuck ? 1 : 0) - state.brace[s]) * (1 - Math.exp(-dt * 14));
      const vals = {};
      for (const f of FINGERS) {
        const key = f + s; state.curl[key] += (target[f] - state.curl[key]) * k;
        vals[f] = state.curl[key] * (1 - state.brace[s]) + (-0.3) * state.brace[s];
      }
      fingers(s, vals, 0.3 * state.brace[s]);
    }
    // arms that were ripped off, or are growing back (8 s):
    //   0-30%  the arm pushes out of the stump as a web of vessels, blood pulsing outward to the fingertips
    //   27-64% muscle (fibres along the arm) and pale tendons fill in from the shoulder down
    //   60-97% skin and fur wipe down over it, raw red at the edge; the fist opens at the very end
    let growing = false; U.time.value += dt;
    for (const s of ['L', 'R']) {
      const A = state.arm[s];
      if (A.mode === 'grow') { A.t += dt / GROW_TIME; if (A.t >= 1) { A.t = 1; A.mode = 'on'; } }
      const p = (A.mode === 'off' || A.mode === 'cyber') ? 0 : A.mode === 'on' ? 1 : A.t;   // a cyber arm replaces the flesh one, which stays folded away
      const g = A.mode === 'grow';
      const wob = g ? 1 + 0.03 * Math.sin(A.t * 60) * (1 - ramp(0, 0.3, p)) : 1;
      const sA = Math.max(0.02, easeOutBack(sstep(0.0, 0.14, p), 0.8) * wob), sB = Math.max(0.05, easeOutBack(sstep(0.07, 0.21, p), 0.8)), sC = Math.max(0.05, easeOutBack(sstep(0.14, 0.28, p), 1.0));
      B[`upperarm_${s}`].scale.setScalar(p >= 1 ? 1 : sA); B[`forearm_${s}`].scale.setScalar(p >= 1 ? 1 : sB); B[`hand_${s}`].scale.setScalar(p >= 1 ? 1 : sC);
      U[`blood${s}`].value = g ? ramp(0.0, 0.3, p) * 1.06 : 9;
      U[`muscle${s}`].value = g ? ramp(0.27, 0.64, p) * 1.08 : 9;
      U[`skin${s}`].value = g ? 0.06 + ramp(0.6, 0.97, p) * 1.0 : 9;
      if (g) {
        growing = true;
        const open = sstep(0.84, 1.0, p), c = 1.1 * (1 - open) - 0.25 * Math.sin(open * Math.PI);   // a loose fist that opens and stretches at the end
        fingers(s, { index: c, middle: c, ring: c, pinky: c, thumb: c * 0.7 }, 0.25 * Math.sin(open * Math.PI));
      }
      stumps[s].visible = p < 0.12 && A.mode !== 'cyber'; stumps[s].scale.setScalar(1 - p / 0.12 * 0.6);
    }
    layers.forEach(l => { l.visible = growing; });
    // voice: jaw + scream eyes
    B.jaw.quaternion.copy(rest.jaw).multiply(Q().setFromAxisAngle(X, 0.5 * talk));
    const scream = sstep(0.55, 0.9, talk); for (const s of ['L', 'R']) B[`eye_${s}`].scale.setScalar(1 + 0.45 * scream);
    root.updateMatrixWorld(true);
  }

  // first person: collapse the head so it doesn't fill your view; the mirror shows it normally
  function hideHead(hidden) {
    B.head.scale.setScalar(hidden ? 0.001 : 1); headBits.forEach(m => { m.visible = !hidden; });
    B.head.updateMatrixWorld(true); skinned.forEach(m => m.skeleton.update());
  }
  const armOn = (s) => state.arm[s].mode === 'on' || state.arm[s].mode === 'cyber';
  const isCyber = (s) => state.arm[s].mode === 'cyber';
  const setCyber = (s) => { state.arm[s].mode = 'cyber'; state.arm[s].t = 1; };
  const armGone = (s) => state.arm[s].mode === 'off';
  const rip = (s) => { state.arm[s].mode = 'off'; state.arm[s].t = 0; };
  const regrow = (s) => { if (state.arm[s].mode === 'off') { state.arm[s].mode = 'grow'; state.arm[s].t = 0; } };
  const armPoints = (s) => [`upperarm_${s}`, `forearm_${s}`, `hand_${s}`].map(wp);
  const shoulderPos = (s) => wp(`upperarm_${s}`);
  return { root, B, update, hideHead, fingers, resetPose, EYE, armOn, armGone, rip, regrow, isCyber, setCyber, armPoints, shoulderPos, state, GROW_TIME, armLen: len };
}
