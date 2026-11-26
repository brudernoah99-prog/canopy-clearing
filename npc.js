// NPCs for the game modes (no real players yet):
//  - makeMonsterNPC(scene, kind): three different monsters that hunt the player
//      'ripper'  - the classic clawed demon, sickly red, red eyes, the fastest
//      'crusher' - a big pale bone-white brute with the bone-hammer arm, slower but lunges hard
//      'sawjaw'  - dark rusty one with the forearm chainsaw (pops it out when it chases, revs it), yellow eyes
//  - makeGorillaNPC(scene, opts): gorilla survivors that wander and run away from a hunting player
// Both move like gorillas: no legs, the body glides while the two fists plant on the floor ahead in turn.
// They are driven through the same rigs as the player (makeMonster().updatePlayer / makeGorilla().update)
// with a fake head and fake hand "controllers".
import * as THREE from 'three';
import { makeMonster } from './monster.js';
import { makeGorilla } from './gorilla.js';

const V = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z);
const Yax = new THREE.Vector3(0, 1, 0);
const clamp = (x, a, b) => Math.max(a, Math.min(b, x));
const sst = (a, b, x) => { const u = clamp((x - a) / (b - a), 0, 1); return u * u * (3 - 2 * u); };
const angDiff = (a, b) => { let d = b - a; while (d > Math.PI) d -= 2 * Math.PI; while (d < -Math.PI) d += 2 * Math.PI; return d; };
const fakePad = () => ({ buttons: Array.from({ length: 6 }, () => ({ value: 0, pressed: false, touched: false })) });

// a controller orientation whose -Z (finger direction) is `fingerDir` and whose palm faces `palmN`
// (grip space: palm normal is +X for the left hand, -X for the right)
const _m = new THREE.Matrix4();
function handQuat(out, side, fingerDir, palmN) {
  const z = fingerDir.clone().negate().normalize();
  const x = palmN.clone().multiplyScalar(side === 'L' ? 1 : -1); x.sub(z.clone().multiplyScalar(x.dot(z))).normalize();
  const y = z.clone().cross(x);
  return out.setFromRotationMatrix(_m.makeBasis(x, y, z));
}

// ---------- the knuckle-walk: a fist stays planted until it falls behind, then swings forward to the next spot ----------
function makeGait(opts) {
  const G = { stride: opts.stride, width: opts.width, reach: opts.reach, swingTime: opts.swingTime, lift: opts.lift, hands: {} };
  for (const s of ['L', 'R']) G.hands[s] = { planted: V(), from: V(), to: V(), t: 1, swinging: false, pos: V(), init: false };
  // where a fist would like to be right now (ahead of the body, to the side, on the floor)
  G.ideal = (s, base, yaw, speed, floorY) => { const sx = s === 'L' ? 1 : -1; const f = V(Math.sin(yaw), 0, Math.cos(yaw)), side = V(Math.cos(yaw), 0, -Math.sin(yaw));
    return base.clone().addScaledVector(f, G.reach + Math.min(speed, 4) * 0.12).addScaledVector(side, sx * G.width).setY(floorY + 0.02); };
  G.update = (dt, base, yaw, speed, floorY, liftUp = 0) => {
    const lead = G.stride * (0.45 + Math.min(speed, 4) * 0.06);
    for (const s of ['L', 'R']) {
      const H = G.hands[s], o = G.hands[s === 'L' ? 'R' : 'L']; const ideal = G.ideal(s, base, yaw, speed, floorY);
      if (!H.init) { H.planted.copy(ideal).addScaledVector(V(Math.sin(yaw), 0, Math.cos(yaw)), s === 'L' ? 0 : -G.stride * 0.5); H.pos.copy(H.planted); H.init = true; }
      if (H.swinging) {
        H.t = Math.min(1, H.t + dt / Math.max(0.12, G.swingTime / (1 + speed * 0.25)));
        H.to.copy(ideal).addScaledVector(V(Math.sin(yaw), 0, Math.cos(yaw)), lead * 0.5);   // aim a little past the ideal
        const e = sst(0, 1, H.t); H.pos.copy(H.from).lerp(H.to, e); H.pos.y += Math.sin(Math.PI * H.t) * (G.lift + speed * 0.03) + liftUp * Math.sin(Math.PI * H.t);
        if (H.t >= 1) { H.swinging = false; H.planted.copy(H.to); H.justPlanted = true; }
      } else {
        H.pos.copy(H.planted);
        const behind = H.planted.distanceTo(ideal);
        if (behind > lead && !o.swinging) { H.swinging = true; H.t = 0; H.from.copy(H.planted); }
        if (speed < 0.05 && behind > 0.05 && !o.swinging && H.planted.distanceTo(ideal) > G.stride * 0.25) { H.swinging = true; H.t = 0; H.from.copy(H.planted); }
      }
    }
  };
  return G;
}

// ---------- shared AI helpers ----------
function followPath(npc, dt, ctx, targetPt, speed) {
  // re-path to targetPt every ~0.5 s; walk toward the next waypoint (or straight at targetPt when nearby and visible)
  npc.repath -= dt;
  if (ctx.nav && (npc.repath <= 0 || !npc.path.length)) { npc.repath = 0.5; npc.path = ctx.nav.path(npc.pos, targetPt) || []; npc.pi = 0; }
  let goal = targetPt;
  if (npc.path.length && npc.pi < npc.path.length) {
    goal = npc.path[npc.pi];
    if (V(goal.x - npc.pos.x, 0, goal.z - npc.pos.z).length() < 0.6) { npc.pi++; goal = npc.pi < npc.path.length ? npc.path[npc.pi] : targetPt; }
  }
  return steer(npc, dt, ctx, goal, speed);
}
function steer(npc, dt, ctx, goal, speed) {
  const to = V(goal.x - npc.pos.x, 0, goal.z - npc.pos.z); const d = to.length();
  const wantYaw = d > 1e-3 ? Math.atan2(to.x, to.z) : npc.yaw;
  npc.yaw += clamp(angDiff(npc.yaw, wantYaw), -dt * npc.turn, dt * npc.turn);
  const facing = Math.cos(angDiff(npc.yaw, wantYaw));                    // slow down while turning hard
  const v = Math.min(speed * clamp(facing, 0.25, 1), d / Math.max(dt, 1e-3));
  npc.vel += (v - npc.vel) * Math.min(1, dt * 4);
  npc.pos.x += Math.sin(npc.yaw) * npc.vel * dt; npc.pos.z += Math.cos(npc.yaw) * npc.vel * dt;
  if (goal.y !== undefined) npc.pos.y += (goal.y - npc.pos.y) * Math.min(1, dt * 3);
  // don't walk into walls / crates / each other's space
  if (ctx.contact) { const c = V(npc.pos.x, npc.pos.y + npc.bodyH, npc.pos.z); const hit = ctx.contact(c, npc.radius);
    if (hit && hit.dist < npc.radius && Math.abs(hit.normal.y) < 0.6) { npc.pos.x += hit.rest.x - c.x; npc.pos.z += hit.rest.z - c.z; } }
  return d;
}
const canSee = (ctx, from, to, range) => from.distanceTo(to) < range && (!ctx.nav || !ctx.nav.lineOfSight || ctx.nav.lineOfSight(from, to));

// =====================================================================================================
const KINDS = {
  ripper:  { variant: 'classic',  scale: 0.95, tint: '#ff7d72', emissive: '#3a0303', emI: 0.6, eye: '#ff1a0a', chase: 3.3, patrol: 1.3, turn: 6.0, lungeSpeed: 5, rough: 0.8, metal: 0.0 },
  crusher: { variant: 'hammer',   scale: 1.15, tint: '#ffffff', emissive: '#6a5f55', emI: 0.75, eye: '#bff6ff', chase: 2.2, patrol: 1.0, turn: 3.5, lungeSpeed: 8, rough: 0.9, metal: 0.0 },
  sawjaw:  { variant: 'chainsaw', scale: 1.0,  tint: '#8f6a4c', emissive: '#120802', emI: 0.4, eye: '#ffc400', chase: 2.7, patrol: 1.1, turn: 4.5, lungeSpeed: 6, rough: 0.55, metal: 0.45 },
};
export function makeMonsterNPC(scene, kind = 'ripper') {
  const K = KINDS[kind] || KINDS.ripper;
  const M = makeMonster(scene); M.setVariant(K.variant);
  const root = M.g; root.scale.setScalar(K.scale);
  // its own look: tinted skin/fur, its own eye colour
  root.traverse(o => { if (!o.isMesh || !o.material) return; const mats = Array.isArray(o.material) ? o.material : [o.material];
    const nm = mats.map(m => { if (!m.isMeshStandardMaterial || m.name === 'EyeGlow') return m; const c = m.clone(); c.color.multiply(new THREE.Color(K.tint)); c.emissive = new THREE.Color(K.emissive); c.emissiveIntensity = K.emI; c.roughness = K.rough; c.metalness = Math.max(c.metalness || 0, K.metal); return c; });
    o.material = Array.isArray(o.material) ? nm : nm[0]; });
  M.eyes.forEach(e => e.material.emissive.set(K.eye));
  const head = new THREE.Object3D(); scene.add(head);
  const pads = { L: fakePad(), R: fakePad() };
  const inputs = { L: { pos: V(), quat: new THREE.Quaternion(), gamepad: pads.L, vel: V() }, R: { pos: V(), quat: new THREE.Quaternion(), gamepad: pads.R, vel: V() } };
  const EYE = M.EYE.clone();
  const gait = makeGait({ stride: 0.75 * K.scale, width: 0.42 * K.scale, reach: 0.35 * K.scale, swingTime: 0.42, lift: 0.18 });
  const npc = { kind, object: root, pos: V(), yaw: 0, state: 'patrol', speed: 0, vel: 0, turn: K.turn, radius: 0.45 * K.scale, bodyH: 0.9,
    path: [], pi: 0, repath: 0, goal: null, lastSeen: null, searchT: 0, lungeT: -1, lungeAt: V(), cool: 0, active: true, saw: false, sawTog: false, t: 0 };
  const _q = new THREE.Quaternion(), _e = new THREE.Euler(0, 0, 0, 'YXZ');
  let lookPitch = 0;

  function chooseState(dt, ctx) {
    const eyes = V(npc.pos.x, npc.pos.y + EYE.y * K.scale, npc.pos.z);
    const T = ctx.target;
    const sees = T && (ctx.targetVisible !== undefined ? (ctx.targetVisible && eyes.distanceTo(T) < 16) : canSee(ctx, eyes, T, 16));
    const hears = T && (ctx.noise || 0) > 0.55 && eyes.distanceTo(T) < 10;
    if (sees || hears) { npc.lastSeen = (npc.lastSeen || V()).copy(T); npc.searchT = 6; if (npc.state !== 'attack') npc.state = 'chase'; }
    else if (npc.state === 'chase') npc.state = 'search';
    if (npc.state === 'search') { npc.searchT -= dt; if (npc.searchT <= 0) { npc.state = 'patrol'; npc.goal = null; } }
    return sees;
  }

  npc.update = (dt, t, ctx = {}) => {
    npc.t = t;
    if (!npc.active) { root.visible = false; return; }
    root.visible = true;
    const floorY = npc.pos.y;
    let speed = 0, look = null;
    if (npc.state === 'frozen') { speed = 0; }
    else if (npc.lungeT >= 0) {   // attack lunge: rear up, arms wide, then slam forward at the target
      npc.lungeT += dt; const k = npc.lungeT;
      const to = V(npc.lungeAt.x - npc.pos.x, 0, npc.lungeAt.z - npc.pos.z); const d = to.length();
      if (k > 0.25 && k < 0.55 && d > 0.6) { const step = Math.min(d - 0.6, K.lungeSpeed * dt); npc.pos.addScaledVector(to.normalize(), step); }
      npc.yaw += clamp(angDiff(npc.yaw, Math.atan2(npc.lungeAt.x - npc.pos.x, npc.lungeAt.z - npc.pos.z)), -dt * 8, dt * 8);
      look = npc.lungeAt;
      if (k > 0.9) { npc.lungeT = -1; npc.cool = kind === 'crusher' ? 1.6 : 1.0; npc.state = 'chase'; }
    } else {
      const sees = chooseState(dt, ctx); npc.cool = Math.max(0, npc.cool - dt);
      if (npc.state === 'chase' && npc.lastSeen) {
        const flat = V(npc.lastSeen.x, npc.pos.y, npc.lastSeen.z);
        // straight at you only if nothing low is in the way (it can't climb over crates); otherwise around, along the nav path
        const lowClear = !ctx.nav || !ctx.nav.lineOfSight || ctx.nav.lineOfSight(V(npc.pos.x, npc.pos.y + 0.5, npc.pos.z), V(flat.x, npc.pos.y + 0.5, flat.z));
        if (sees && lowClear && npc.pos.distanceTo(flat) < 5) steer(npc, dt, ctx, flat, K.chase); else followPath(npc, dt, ctx, flat, K.chase);
        const d = V(flat.x - npc.pos.x, 0, flat.z - npc.pos.z).length();   // to the target itself, not the next waypoint
        speed = K.chase; look = npc.lastSeen;
        const reachable = npc.lastSeen.y - npc.pos.y < 2.5 * K.scale;
        if (sees && reachable && d < (kind === 'crusher' ? 2.6 : 1.7) && npc.cool <= 0) npc.lunge(npc.lastSeen);
      } else if (npc.state === 'search' && npc.lastSeen) {
        const d = followPath(npc, dt, ctx, V(npc.lastSeen.x, npc.pos.y, npc.lastSeen.z), K.patrol * 1.4); speed = K.patrol * 1.4;
        if (d < 0.8) { npc.yaw += dt * 1.6; speed = 0.2; }   // look around where it lost you
      } else {
        if (!npc.goal || V(npc.goal.x - npc.pos.x, 0, npc.goal.z - npc.pos.z).length() < 0.9) { npc.goal = ctx.nav ? ctx.nav.randomNode().clone() : V((Math.random() - 0.5) * 10, 0, (Math.random() - 0.5) * 10); npc.path = []; }
        followPath(npc, dt, ctx, npc.goal, K.patrol); speed = K.patrol;
      }
    }
    npc.speed = Math.abs(npc.vel);
    // chainsaw: out while it hunts, back in while it wanders; revs when close
    if (K.variant === 'chainsaw') { const want = npc.state === 'chase' || npc.state === 'attack' || npc.lungeT >= 0; if (want !== npc.saw) { npc.saw = want; npc.sawTog = true; } }
    // ----- drive the rig -----
    const fwd = V(Math.sin(npc.yaw), 0, Math.cos(npc.yaw));
    const bob = Math.sin(t * (4 + npc.speed * 2.5)) * 0.03 * Math.min(1, npc.speed);
    const lungeLift = npc.lungeT >= 0 ? Math.sin(Math.PI * clamp(npc.lungeT / 0.9, 0, 1)) * 0.35 : 0;
    const base = V(npc.pos.x, floorY, npc.pos.z);
    // head: at its eye height over the body, pitched toward what it looks at
    head.position.copy(base).addScaledVector(Yax, EYE.y + bob + lungeLift).addScaledVector(fwd, EYE.z);   // (makeMonster puts its body EYE behind this point)
    let wantPitch = -0.15; if (look) { const dy = look.y - head.position.y, dh = V(look.x - head.position.x, 0, look.z - head.position.z).length(); wantPitch = clamp(Math.atan2(dy, Math.max(dh, 0.1)), -0.6, 0.7); }
    lookPitch += (wantPitch - lookPitch) * Math.min(1, dt * 5);
    _e.set(lookPitch, npc.yaw + Math.PI, 0, 'YXZ'); head.quaternion.setFromEuler(_e); head.updateMatrixWorld(true);
    // hands: knuckle-walk, or the lunge (arms flung wide, then both slam at the target)
    gait.update(dt, base, npc.yaw, npc.speed, floorY);
    const side = V(Math.cos(npc.yaw), 0, -Math.sin(npc.yaw));
    for (const s of ['L', 'R']) {
      const sx = s === 'L' ? 1 : -1; const inp = inputs[s]; const H = gait.hands[s];
      let p = H.pos.clone(), fdir = V(0, -1, 0).addScaledVector(fwd, 0.35).normalize(), palm = fwd.clone().negate();   // fist down, knuckles forward
      if (npc.lungeT >= 0) {
        const k = npc.lungeT; const up = base.clone().addScaledVector(Yax, 1.7 * K.scale).addScaledVector(side, sx * 0.9 * K.scale).addScaledVector(fwd, 0.2);
        const hit = npc.lungeAt.clone().addScaledVector(side, sx * 0.25);
        p = k < 0.3 ? H.pos.clone().lerp(up, sst(0, 0.3, k)) : up.clone().lerp(hit, sst(0.3, 0.5, k)); if (k > 0.65) p.lerp(H.pos, sst(0.65, 0.9, k));
        fdir = (k < 0.3 ? V(0, 1, 0).addScaledVector(side, sx) : hit.clone().sub(up)).normalize(); palm = side.clone().multiplyScalar(-sx);
      }
      if (s === 'R' && K.variant === 'hammer' && npc.state === 'chase') { // the hammer arm swings, dragging a little higher
        p.y += 0.08; }
      inp.vel.copy(p).sub(inp.pos).divideScalar(Math.max(dt, 1e-3)); inp.pos.copy(p); handQuat(inp.quat, s, fdir, palm);
      const pad = pads[s]; const fist = npc.lungeT >= 0 ? (npc.lungeT > 0.35 ? 1 : 0.1) : 1;
      pad.buttons[0].value = fist; pad.buttons[1].value = fist; pad.buttons[3].touched = fist > 0.5;
    }
    // chainsaw buttons: B toggles (an edge), the trigger revs when close
    if (K.variant === 'chainsaw') { const b = pads.R.buttons; b[5].pressed = npc.sawTog; npc.sawTog = false;
      b[0].value = npc.saw && (npc.state === 'chase' || npc.lungeT >= 0) && npc.lastSeen && npc.pos.distanceTo(V(npc.lastSeen.x, npc.pos.y, npc.lastSeen.z)) < 5 ? 1 : 0; }
    const snap = npc.lungeT >= 0 ? 1 : npc.state === 'chase' ? 0.35 + 0.35 * Math.abs(Math.sin(t * 7)) : 0.08 + 0.08 * Math.sin(t * 1.7);
    M.updatePlayer(head, inputs, dt, t, snap);
  };
  npc.lunge = (p) => { if (npc.lungeT >= 0) return; npc.lungeT = 0; npc.lungeAt.copy(p); npc.state = 'attack'; };
  npc.canGrab = (p) => {
    if (npc.lungeT < 0.3 || npc.lungeT > 0.7) return false;
    for (const s of ['L', 'R']) if (M.handPos(s).distanceTo(p) < 0.9) return true;
    for (const w of M.weapons) if (w.headPoint && w.headPoint.getWorldPosition(V()).distanceTo(p) < 0.9) return true;
    return false;
  };
  npc.setActive = (on) => { npc.active = on; root.visible = on; if (!on) { pads.R.buttons[0].value = 0; } };
  npc.setAudio = (fn) => M.setAudio(fn);
  npc.dispose = () => { M.setVariant('classic'); root.removeFromParent(); head.removeFromParent(); };
  npc.rig = M;
  return npc;
}

// =====================================================================================================
const FUR = ['#ffffff', '#d9c9bd', '#c7cfdc', '#e3d2b3'];
let gCount = 0;
export function makeGorillaNPC(scene, opts = {}) {
  const Gr = makeGorilla(scene); const root = Gr.root;
  const tint = opts.tint || FUR[gCount++ % FUR.length];
  if (tint !== '#ffffff') root.traverse(o => { if (o.isSkinnedMesh && o.material && !Array.isArray(o.material) && o.material.map) { o.material = o.material.clone(); o.material.color.multiply(new THREE.Color(tint)); } });
  const head = new THREE.Object3D(); scene.add(head);
  const pads = { L: fakePad(), R: fakePad() };
  const hands = { L: { pos: V(), quat: new THREE.Quaternion(), gamepad: pads.L, stuck: false }, R: { pos: V(), quat: new THREE.Quaternion(), gamepad: pads.R, stuck: false } };
  const EYE = Gr.EYE.clone();
  const gait = makeGait({ stride: 0.5, width: 0.36, reach: 0.25, swingTime: 0.34, lift: 0.12 });
  const npc = { object: root, pos: V(), yaw: 0, state: 'wander', speed: 0, vel: 0, turn: 7, radius: 0.32, bodyH: 0.6, path: [], pi: 0, repath: 0, goal: null, calm: 0, lookT: 0, lookYaw: 0, fear: 0 };
  const _e = new THREE.Euler(0, 0, 0, 'YXZ'); let lookPitch = 0;
  npc.headPos = () => V(npc.pos.x, npc.pos.y + EYE.y * 0.97, npc.pos.z).addScaledVector(V(Math.sin(npc.yaw), 0, Math.cos(npc.yaw)), EYE.z);
  npc.update = (dt, t, ctx = {}) => {
    if (npc.state === 'caught') { root.visible = false; return; }
    const T = ctx.threat; const hp = npc.headPos();
    const sees = T && canSee(ctx, hp, T, 12);
    if (sees) { npc.calm = 4; npc.fear = Math.min(1, npc.fear + dt * 3); if (npc.state !== 'flee') { npc.state = 'flee'; npc.goal = null; } }
    else { npc.calm -= dt; npc.fear = Math.max(0, npc.fear - dt * 0.4); if (npc.state === 'flee' && npc.calm <= 0) { npc.state = Math.random() < 0.5 ? 'hide' : 'wander'; npc.goal = null; } }
    let speed = 0;
    if (npc.state === 'flee') {
      if (!npc.goal || V(npc.goal.x - npc.pos.x, 0, npc.goal.z - npc.pos.z).length() < 1.0 || npc.repath <= -2) {
        npc.goal = ctx.nav ? (ctx.nav.farthestFrom ? ctx.nav.farthestFrom(T || hp).clone() : ctx.nav.randomNode().clone()) : npc.pos.clone().add(V(Math.sin(npc.yaw) * 6, 0, Math.cos(npc.yaw) * 6));
        if (ctx.nav && ctx.hidingSpots && ctx.hidingSpots.length && Math.random() < 0.3) npc.goal = ctx.hidingSpots[(Math.random() * ctx.hidingSpots.length) | 0].clone();
        npc.path = [];
      }
      // if the threat is between it and its goal, pick another goal
      if (T) { const toG = V(npc.goal.x - npc.pos.x, 0, npc.goal.z - npc.pos.z), toT = V(T.x - npc.pos.x, 0, T.z - npc.pos.z); if (toG.dot(toT) > 0 && toT.length() < 4 && Math.random() < dt * 2) npc.goal = null; }
      if (npc.goal) followPath(npc, dt, ctx, npc.goal, 3.0); speed = 3.0;
    } else if (npc.state === 'hide') {
      if (!npc.goal) npc.goal = (ctx.hidingSpots && ctx.hidingSpots.length ? ctx.hidingSpots[(Math.random() * ctx.hidingSpots.length) | 0] : (ctx.nav ? ctx.nav.randomNode() : npc.pos)).clone();
      const d = followPath(npc, dt, ctx, npc.goal, 1.6); speed = d > 0.8 ? 1.6 : 0;
      if (d < 0.8) { npc.vel *= 0.9; if (Math.random() < dt * 0.08) { npc.state = 'wander'; npc.goal = null; } }
    } else {
      if (!npc.goal || V(npc.goal.x - npc.pos.x, 0, npc.goal.z - npc.pos.z).length() < 0.8) { npc.goal = ctx.nav ? ctx.nav.randomNode().clone() : V((Math.random() - 0.5) * 10, 0, (Math.random() - 0.5) * 10); npc.path = []; npc.pause = Math.random() * 2; }
      if (npc.pause > 0) { npc.pause -= dt; npc.vel *= 0.85; } else { followPath(npc, dt, ctx, npc.goal, 0.9); speed = 0.9; }
    }
    npc.speed = Math.abs(npc.vel);
    // look around now and then; look at the threat when scared
    npc.lookT -= dt; if (npc.lookT <= 0) { npc.lookT = 1 + Math.random() * 2.5; npc.lookYaw = npc.state === 'wander' ? (Math.random() - 0.5) * 1.6 : 0; }
    let yawH = npc.yaw + npc.lookYaw * (npc.state === 'wander' ? 1 : 0);
    if (T && npc.state === 'flee' && npc.speed < 0.6) yawH = Math.atan2(T.x - npc.pos.x, T.z - npc.pos.z);
    const fwd = V(Math.sin(npc.yaw), 0, Math.cos(npc.yaw));
    const bob = Math.sin(t * (5 + npc.speed * 3)) * 0.025 * Math.min(1, npc.speed + 0.2);
    const base = V(npc.pos.x, npc.pos.y, npc.pos.z);
    head.position.copy(base).addScaledVector(Yax, EYE.y * 0.97 + bob).addScaledVector(fwd, EYE.z);
    const wantPitch = npc.state === 'flee' ? 0.05 : -0.1 + Math.sin(t * 0.7) * 0.08; lookPitch += (wantPitch - lookPitch) * Math.min(1, dt * 4);
    _e.set(lookPitch, yawH + Math.PI, 0, 'YXZ'); head.quaternion.setFromEuler(_e); head.updateMatrixWorld(true);
    // the body faces where it walks (makeGorilla turns the body to the head; keep the head turn small)
    gait.update(dt, base, npc.yaw, npc.speed, npc.pos.y);
    for (const s of ['L', 'R']) { const inp = hands[s]; inp.pos.copy(gait.hands[s].pos); handQuat(inp.quat, s, V(0, -1, 0).addScaledVector(fwd, 0.3).normalize(), fwd.clone().negate());
      pads[s].buttons[0].value = 1; pads[s].buttons[1].value = 1; pads[s].buttons[3].touched = true; inp.stuck = false; }
    const chatter = npc.fear > 0.3 ? 0.25 + 0.3 * Math.abs(Math.sin(t * 18)) : 0;
    Gr.update({ camera: head, hands, talk: chatter, dt });
  };
  npc.pose = () => ({ position: npc.pos.clone(), yaw: npc.yaw });
  npc.dispose = () => { root.removeFromParent(); head.removeFromParent(); };
  npc.rig = Gr;
  return npc;
}
