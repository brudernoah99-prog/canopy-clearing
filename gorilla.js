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
function aim(bone, childBone, target) {          // rotate a bone so that its child joint lands on target
  const s = bone.getWorldPosition(V()), c = childBone.getWorldPosition(V());
  const q = Q().setFromUnitVectors(c.sub(s).normalize(), target.clone().sub(s).normalize());
  const wq = Q(); bone.getWorldQuaternion(wq); setWorldQuat(bone, q.multiply(wq));
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
  const state = { curl: {}, brace: { L: 0, R: 0 }, headHidden: false };
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
  function update({ camera, hands, talk = 0, dt = 1 / 72 }) {
    resetPose();
    const camPos = camera.getWorldPosition(V()), camQ = Q(); camera.getWorldQuaternion(camQ);
    const fwd = V().set(0, 0, -1).applyQuaternion(camQ); const yaw = Math.atan2(fwd.x, fwd.z);
    root.rotation.set(0, yaw, 0); root.position.copy(camPos).sub(EYE.clone().applyAxisAngle(Yax, yaw));
    root.updateMatrixWorld(true);
    // head follows the headset (relative to the body's facing)
    const camYaw = Q().setFromAxisAngle(Yax, Math.atan2(-fwd.x, -fwd.z));
    const delta = camQ.clone().multiply(camYaw.invert());
    const hq = Q(); B.head.getWorldQuaternion(hq); setWorldQuat(B.head, delta.multiply(hq));
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
  return { root, B, update, hideHead, fingers, resetPose, EYE };
}
