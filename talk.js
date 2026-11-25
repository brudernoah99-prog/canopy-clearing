// Voice: listens to the microphone and turns how loud you are into a 0..1 "mouth open" amount.
// Also drives an ape's mouth, and puts your own ape body where you are (head on your head, hands on your hands).
import * as THREE from 'three';

export function createVoice() {
  let analyser = null, data = null, level = 0, fake = false;
  async function start() {
    if (analyser) return true;
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } });
      const ctx = new (window.AudioContext || window.webkitAudioContext)(); await ctx.resume();
      analyser = ctx.createAnalyser(); analyser.fftSize = 512; ctx.createMediaStreamSource(stream).connect(analyser); data = new Float32Array(analyser.fftSize);
      return true;
    } catch (e) { console.warn('microphone not available:', e.message); return false; }
  }
  function update(dt, t) {
    let raw = 0;
    if (analyser) { analyser.getFloatTimeDomainData(data); let s = 0; for (let i = 0; i < data.length; i++) s += data[i] * data[i]; raw = Math.sqrt(s / data.length); }
    let target = Math.min(1, Math.max(0, (raw - 0.012) * 10));               // ignore quiet room noise
    if (fake) target = Math.max(0, Math.sin(t * 9) * 0.5 + Math.sin(t * 3.1) * 0.5);   // pretend talking (for previews)
    level += (target - level) * Math.min(1, dt * (target > level ? 28 : 12));           // opens fast, closes a bit slower
    return level;
  }
  return { start, update, get level() { return level; }, get on() { return !!analyser; }, setFake(f) { fake = f; } };
}

// open = 0 closed .. 1 wide open
export function setMouth(avatar, open) {
  const u = avatar.userData;
  if (!u.mouthFound) { u.mouthFound = true; u.lipU = avatar.getObjectByName('LipU'); u.lipL = avatar.getObjectByName('LipL'); u.jaw = avatar.getObjectByName('Jaw'); u.oldMouth = avatar.getObjectByName('Mouth'); }
  if (u.lipU) { u.lipU.scale.y = 1 - 0.92 * open; u.lipL.scale.y = 1 - 0.92 * open; }   // version 1: the face opens
  if (u.jaw) u.jaw.rotation.x = 0.42 * open;                                            // version 2: the jaw drops
  if (u.oldMouth) u.oldMouth.scale.set(1, 0.1 + 0.9 * open, 1);
}

// rest pose numbers for the ape (game units, ape facing +z, standing at the origin)
const EYE = new THREE.Vector3(0, 1.25, 0.26);
const SHOULDER = { Arm_L: new THREE.Vector3(0.34, 0.86, -0.02), Arm_R: new THREE.Vector3(-0.34, 0.86, -0.02) };
const REST_DIR = { Arm_L: new THREE.Vector3(0.44, -0.8, 0.11).normalize(), Arm_R: new THREE.Vector3(-0.44, -0.8, 0.11).normalize() };
const ARM_LEN = 0.92;
const v = new THREE.Vector3(), fwd = new THREE.Vector3(), q = new THREE.Quaternion();

// put an avatar where the VR player is: eyes at the camera, arms reaching for the hands
export function poseSelf(avatar, camera, handL, handR) {
  camera.getWorldDirection(fwd); const yaw = Math.atan2(fwd.x, fwd.z); const pitch = Math.asin(THREE.MathUtils.clamp(fwd.y, -1, 1));
  const cam = camera.getWorldPosition(new THREE.Vector3());
  avatar.rotation.set(0, yaw, 0); avatar.position.copy(cam).sub(EYE.clone().applyAxisAngle(new THREE.Vector3(0, 1, 0), yaw));
  avatar.updateMatrixWorld(true);
  const P = avatar.userData.parts; P.Head.rotation.x = -pitch * 0.8;
  for (const [name, hand] of [['Arm_L', handL], ['Arm_R', handR]]) {
    if (!hand) continue; const arm = P[name];
    v.copy(hand); avatar.worldToLocal(v); v.sub(SHOULDER[name]); const len = v.length();
    q.setFromUnitVectors(REST_DIR[name], v.normalize()); arm.quaternion.copy(q); arm.scale.setScalar(THREE.MathUtils.clamp(len / ARM_LEN, 0.6, 1.6));
  }
}
