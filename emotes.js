// Emotes: hold B (right controller) to do one; while holding B, push the right stick up/down to switch.
// An emote takes over your avatar's arms, fingers and body bounce (you still move with your real hands).
// Each emote is a function of time (in beats) giving, per hand, a target in BODY space
// (x = your right, y = up, z = forward, origin = your eyes), where the fingers point, where the palm faces,
// and how curled the fingers are; plus body bob / twist / sway.
import * as THREE from 'three';

const V = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z);
const TAU = Math.PI * 2;
const sst = (x) => { x = Math.max(0, Math.min(1, x)); return x * x * (3 - 2 * x); };
const mixV = (a, b, t) => a.clone().lerp(b, t);

// --- the emotes (t in beats) ---
// Brazilian dance (from the reference video): bouncy steps; one hand rolls circles in front of the chest while
// the other arm swings out low; they swap every 2 beats; every 4th beat a hand flicks up by the face.
function brazil(t) {
  const beat = t % 1, bar = t % 4;
  const bob = -0.035 * Math.abs(Math.sin(t * Math.PI));          // a dip on every beat
  const side = Math.floor(t / 2) % 2 === 0 ? 1 : -1;               // +1: right hand rolls, left swings
  const roll = (s) => {                                            // circle in front of the chest
    const a = t * TAU * (s > 0 ? 1 : -1);
    return { pos: V(0.06 * s + 0.09 * Math.cos(a), -0.42 + 0.07 * Math.sin(a), 0.3), dir: V(-s * 0.7, 0.2, 0.7), palm: V(0, 0, -1), curl: 0.55 };
  };
  const swing = (s) => {                                           // arm swings out and back, low by the hip
    const k = Math.sin(t * Math.PI);
    return { pos: V(0.42 * s, -0.78 + 0.06 * k, 0.12 + 0.18 * k), dir: V(0.25 * s, -0.9, 0.35), palm: V(-s, 0, 0), curl: 0.25 };
  };
  const flick = (s) => ({ pos: V(0.12 * s, -0.08, 0.28), dir: V(-0.2 * s, 0.9, 0.3), palm: V(0, 0, -1), curl: -0.2 });   // hand up by the face
  const R = side > 0 ? roll(1) : swing(1), L = side < 0 ? roll(-1) : swing(-1);
  // beats 3.5-4: the rolling hand flicks up past the face
  const f = bar > 3.4 ? sst((bar - 3.4) / 0.25) * (1 - sst((bar - 3.85) / 0.15)) : 0;
  const hands = { R, L };
  const who = side > 0 ? 'R' : 'L', s = side > 0 ? 1 : -1;
  if (f > 0) { const F = flick(s); const H = hands[who]; hands[who] = { pos: mixV(H.pos, F.pos, f), dir: mixV(H.dir, F.dir, f), palm: mixV(H.palm, F.palm, f), curl: H.curl + (F.curl - H.curl) * f }; }
  return { hands, body: { bob, twist: 0.18 * Math.sin(t * Math.PI), sway: 0.06 * Math.sin(t * Math.PI + beat) } };
}

// big friendly wave with the right hand, left hand relaxed
function wave(t) {
  const k = Math.sin(t * Math.PI * 1.5);
  return {
    hands: {
      R: { pos: V(0.38 + 0.08 * k, 0.05, 0.12), dir: V(0.35 * k, 1, 0.1), palm: V(0, 0, 1), curl: -0.25 },
      L: { pos: V(-0.36, -0.82, 0.12), dir: V(0, -1, 0.2), palm: V(1, 0, 0), curl: 0.3 },
    },
    body: { bob: -0.01 * Math.abs(k), twist: 0.08 * k, sway: -0.04 },
  };
}

// gorilla chest beat: fists pound the chest, left-right-left-right
function chestBeat(t) {
  const hit = (ph) => { const x = ((t * 2 + ph) % 1); return x < 0.35 ? sst(x / 0.35) : 1 - sst((x - 0.35) / 0.65); };   // 0 = on the chest, 1 = pulled back
  const pose = (s, ph) => {
    const a = hit(ph);
    return { pos: V(0.13 * s + 0.08 * s * a, -0.5 + 0.03 * a, 0.2 + 0.2 * a), dir: V(-s * 0.8, 0.1, 0.4), palm: V(0, 0, -1), curl: 1.2 };
  };
  return { hands: { R: pose(1, 0), L: pose(-1, 0.5) }, body: { bob: -0.02 * Math.abs(Math.sin(t * TAU)), twist: 0.05 * Math.sin(t * TAU), sway: 0 } };
}

export const EMOTES = [
  { name: 'BRAZIL DANCE', bpm: 120, fn: brazil },
  { name: 'WAVE', bpm: 100, fn: wave },
  { name: 'CHEST BEAT', bpm: 130, fn: chestBeat },
];

export function makeEmotes() {
  const pads = { L: makePad(), R: makePad() };
  const st = { idx: 0, on: false, w: 0, t: 0, stickLatch: false, hold: 0, changed: null };
  function makePad() { return { buttons: Array.from({ length: 6 }, () => ({ value: 0, pressed: false, touched: false })), axes: [0, 0, 0, 0], hapticActuators: [] }; }

  // read the controller: returns true while the emote should play. `rightPad` is the right controller's gamepad.
  function input(rightPad, dt) {
    const b = !!rightPad?.buttons?.[5]?.pressed;
    st.hold = b ? st.hold + dt : 0; st.changed = null;
    const was = st.on; st.on = st.hold > 0.12;
    if (st.on && !was) { st.t = 0; st.changed = EMOTES[st.idx].name; }
    if (st.on) {
      const ay = rightPad?.axes?.[3] ?? 0;
      if (Math.abs(ay) < 0.3) st.stickLatch = false;
      else if (!st.stickLatch && Math.abs(ay) > 0.7) {
        st.stickLatch = true; st.idx = (st.idx + (ay < 0 ? -1 : 1) + EMOTES.length) % EMOTES.length; st.t = 0; st.changed = EMOTES[st.idx].name;
      }
    }
    return st.on;
  }
  // force an emote on/off without a controller (desktop test view)
  function force(on, idx = st.idx) { if (on && (!st.on || idx !== st.idx)) { st.t = 0; st.changed = EMOTES[idx].name; } st.on = on; st.idx = idx; }

  // blend the real inputs toward the emote pose. head = the camera (Object3D); inputs = { L, R } as gorilla.update wants
  const q = new THREE.Quaternion(), m = new THREE.Matrix4();
  function apply(head, inputs, dt) {
    st.w += ((st.on ? 1 : 0) - st.w) * (1 - Math.exp(-dt * 10));
    if (st.w < 0.01) { st.w = 0; return { inputs, body: null }; }
    const E = EMOTES[st.idx]; st.t += dt * E.bpm / 60;
    const P = E.fn(st.t);
    const eye = head.getWorldPosition(V()); const hq = head.getWorldQuaternion(new THREE.Quaternion());
    const f = V(0, 0, -1).applyQuaternion(hq); f.y = 0; if (f.lengthSq() < 1e-6) f.set(0, 0, -1); f.normalize();
    const up = V(0, 1, 0), right = V().crossVectors(f, up).normalize();
    const toWorld = (v) => V().addScaledVector(right, v.x).addScaledVector(up, v.y).addScaledVector(f, v.z);
    const out = {};
    for (const s of ['L', 'R']) {
      const H = P.hands[s], real = inputs[s] || {}, sx = s === 'L' ? 1 : -1;
      // fingers point along dir; the hand target is the controller spot, 9 cm along the fingers from the wrist
      const dir = toWorld(H.dir).normalize(); const palm = toWorld(H.palm); palm.addScaledVector(dir, -palm.dot(dir)).normalize();
      const pos = eye.clone().add(toWorld(H.pos)).addScaledVector(dir, 0.09);
      // controller frame: -Z = fingers, +X = palm (left) / -X (right)
      const zA = dir.clone().negate(), xA = palm.clone().multiplyScalar(sx), yA = V().crossVectors(zA, xA).normalize();
      m.makeBasis(xA, yA, zA); q.setFromRotationMatrix(m);
      const p = real.pos ? real.pos.clone().lerp(pos, st.w) : pos;
      const qq = real.quat ? real.quat.clone().slerp(q, st.w) : q.clone();
      const pad = pads[s]; const c = Math.max(0, H.curl) / 1.25; const realPad = real.gamepad;
      const rv = (i) => realPad?.buttons?.[i]?.value ?? 0;
      pad.buttons[0].value = rv(0) + (c - rv(0)) * st.w; pad.buttons[1].value = rv(1) + (c - rv(1)) * st.w;
      pad.buttons[3].touched = H.curl > 0.6 && st.w > 0.5;
      out[s] = { ...real, pos: p, quat: qq, gamepad: pad, stuck: st.w > 0.5 ? false : real.stuck };
    }
    const w = st.w, b = P.body;
    return { inputs: out, body: { bob: b.bob * w, twist: b.twist * w, sway: b.sway * w } };
  }
  return { input, apply, force, state: st, EMOTES };
}
