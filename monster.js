// The player-monster: a hairy demon-gorilla with a pale skull face, long fangs and huge clawed hands
// (models/monster.glb, built from the user's reference sheet by monster_model/build_monster.py).
// You become it with the red button: no legs, eyes at your headset, the body follows your facing,
// two-bone IK arms reach your controllers, wrists turn with them, and 3-joint clawed fingers curl with
// trigger (index) / grip (the rest) / thumb on a button. The jaw drops when you talk and the eyes burn red.
// Interface used by game.js: { g, head (.visible hides it for first person), jaw, eyes, drips[], arms[{bl}], NECK,
//                              updatePlayer(head, inputs, dt, t, talk), handPos(s) }
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { twoBoneIK } from './gorilla.js';

const gltf = await new GLTFLoader().loadAsync('./models/monster.glb');
const FINGERS = ['index', 'middle', 'ring', 'pinky', 'thumb'];
const V = () => new THREE.Vector3(), Q = () => new THREE.Quaternion();
const X = new THREE.Vector3(1, 0, 0), Yax = new THREE.Vector3(0, 1, 0), Z = new THREE.Vector3(0, 0, 1);
const clamp = (x, a, b) => Math.max(a, Math.min(b, x));
function setWorldQuat(bone, qWorld) { const pq = Q(); bone.parent.getWorldQuaternion(pq); bone.quaternion.copy(pq.invert().multiply(qWorld)); bone.updateMatrixWorld(true); }

export function makeMonster(scene) {
  const g = new THREE.Group(); scene.add(g);
  const model = gltf.scene; g.add(model);
  const B = {}, eyes = [], skinned = [];
  model.traverse(o => {
    if (o.isBone) B[o.name] = o;
    if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; o.frustumCulled = false; }
    if (o.isSkinnedMesh) skinned.push(o);
    if (o.isMesh && o.material && o.material.name === 'MonsterHand') { o.material = o.material.clone(); o.material.color.set('#5e4f4b'); }
    if (o.isMesh && o.material && o.material.name === 'EyeGlow') { o.material = o.material.clone(); o.material.emissive.set('#ff1a0a'); eyes.push(o); }
  });
  const rest = {}; for (const [n, b] of Object.entries(B)) rest[n] = b.quaternion.clone();
  // size: its arms (upper + fore) match your reach in monster mode (rig 1.35x), like the old monster's 0.5 + 0.47 m
  model.updateMatrixWorld(true);
  const wp = (n) => B[n].getWorldPosition(V());
  const SC = 0.97 / (wp('upperarm_L').distanceTo(wp('forearm_L')) + wp('forearm_L').distanceTo(wp('hand_L')));
  model.scale.setScalar(SC); model.updateMatrixWorld(true);
  // its skull face juts far in front of its shoulders, so the point that sits at your headset is between the eyes and
  // the shoulders (at eye height): the shoulders then sit just behind/below your head and the arms reach your hands.
  // In first person the head is hidden; in the mirror its face is a bit ahead of you, which reads fine for a monster.
  const eyeMid = wp('eye_L').add(wp('eye_R')).multiplyScalar(0.5), shMid = wp('upperarm_L').add(wp('upperarm_R')).multiplyScalar(0.5);
  const EYE = eyeMid.clone().lerp(shMid, 0.62); EYE.y = eyeMid.y;
  const len = {}; for (const s of ['L', 'R']) len[s] = [wp(`upperarm_${s}`).distanceTo(wp(`forearm_${s}`)), wp(`forearm_${s}`).distanceTo(wp(`hand_${s}`))];
  // rest hand frame: fingers along the hand bone's Y, palm normal = the finger bones' Z (pointing inward)
  const handOffset = {};
  for (const s of ['L', 'R']) {
    const hq = Q(); B[`hand_${s}`].getWorldQuaternion(hq); const fq = Q(); B[`middle1_${s}`].getWorldQuaternion(fq);
    const fy = Yax.clone().applyQuaternion(hq), pz = Z.clone().applyQuaternion(fq);
    const basis = new THREE.Matrix4().makeBasis(fy.clone().cross(pz).normalize(), fy, pz.clone().sub(fy.clone().multiplyScalar(pz.dot(fy))).normalize());
    handOffset[s] = Q().setFromRotationMatrix(basis).invert().multiply(hq);
  }
  const curl = {}; for (const s of ['L', 'R']) for (const f of FINGERS) curl[f + s] = 0.3;

  function fingers(s, vals) {
    for (const f of FINGERS) for (let j = 1; j <= 3; j++) {
      const b = B[`${f}${j}_${s}`]; if (!b) continue;
      b.quaternion.copy(rest[b.name]).multiply(Q().setFromAxisAngle(X, vals[f] * [0.9, 1.15, 0.95][j - 1]));
    }
  }

  function updatePlayer(headObj, inputs, dt, t, talk = 0) {
    for (const [n, b] of Object.entries(B)) b.quaternion.copy(rest[n]);
    const camPos = headObj.getWorldPosition(V()), camQ = headObj.getWorldQuaternion(Q());
    const fwd = V().set(0, 0, -1).applyQuaternion(camQ); const yaw = Math.atan2(fwd.x, fwd.z);
    g.rotation.set(0, yaw, 0); g.position.copy(camPos).sub(EYE.clone().applyAxisAngle(Yax, yaw)); g.updateMatrixWorld(true);
    // head follows the headset's pitch/roll (relative to the body's facing)
    const camYaw = Q().setFromAxisAngle(Yax, Math.atan2(-fwd.x, -fwd.z));
    const delta = camQ.clone().multiply(camYaw.invert());
    const hq = Q(); B.head.getWorldQuaternion(hq); setWorldQuat(B.head, delta.multiply(hq));
    // jaw drops with your voice; eyes burn hotter
    B.jaw.quaternion.copy(rest.jaw).multiply(Q().setFromAxisAngle(X, 0.5 * talk));
    eyes.forEach(e => { e.material.emissiveIntensity = 3 + Math.sin(t * 9) * 0.8 + talk * 4; });
    const k = 1 - Math.exp(-dt * 18);
    for (const s of ['L', 'R']) {
      const inp = inputs[s]; if (!inp || !inp.pos) continue;
      const sx = s === 'L' ? 1 : -1;
      const fingerDir = V().set(0, 0, -1).applyQuaternion(inp.quat);
      const palm = V().set(sx, 0, 0).applyQuaternion(inp.quat);               // grip space: palm normal +X (left) / -X (right)
      const wrist = inp.pos.clone().addScaledVector(fingerDir, -0.165);       // palm centre on the controller (the hands are big)
      const pole = V().set(sx * 0.9, -0.5, -0.65).applyAxisAngle(Yax, yaw);     // elbows out, down and back
      twoBoneIK(B[`upperarm_${s}`], B[`forearm_${s}`], B[`hand_${s}`], wrist, pole, len[s][0], len[s][1]);
      const pz = palm.sub(fingerDir.clone().multiplyScalar(palm.dot(fingerDir))).normalize();
      const basis = new THREE.Matrix4().makeBasis(fingerDir.clone().cross(pz).normalize(), fingerDir, pz);
      setWorldQuat(B[`hand_${s}`], Q().setFromRotationMatrix(basis).multiply(handOffset[s]));
      const gp = inp.gamepad, btn = (i) => gp && gp.buttons && gp.buttons[i];
      const trig = btn(0) ? btn(0).value : 0, grip = btn(1) ? btn(1).value : 0;
      const thumb = gp ? [3, 4, 5].some(i => btn(i) && (btn(i).touched || btn(i).pressed)) : false;
      const target = { index: 0.15 + trig * 1.1, middle: 0.2 + grip * 1.05, ring: 0.25 + grip * 1.05, pinky: 0.3 + grip * 1.05, thumb: thumb ? 0.8 : 0.1 };
      const vals = {}; for (const f of FINGERS) { const key = f + s; curl[key] += (target[f] - curl[key]) * k; vals[f] = curl[key]; }
      fingers(s, vals);
    }
    g.updateMatrixWorld(true);
  }
  // palm centre: between the wrist and the middle knuckle
  const handPos = (s) => wp(`hand_${s}`).lerp(wp(`middle1_${s}`), 0.6);

  // first person: collapse the head (jaw and eyes follow) so it doesn't fill your view; the mirror shows it
  let headShown = true;
  const head = {
    get visible() { return headShown; },
    set visible(v) { if (v === headShown) return; headShown = v; B.head.scale.setScalar(v ? 1 : 0.001); eyes.forEach(e => { e.visible = v; }); B.head.updateMatrixWorld(true); skinned.forEach(m => m.skeleton.update()); },
  };
  const arms = [{ bl: { visible: false } }, { bl: { visible: false } }];
  return { g, head, jaw: B.jaw, eyes, drips: [], arms, NECK: 0, B, SC, updatePlayer, handPos };
}
