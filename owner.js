// OWNER MENU: only for the person who made the game. Unlocked once per headset at the STAFF keypad next to the MODES wall.
// The typed code is checked as SHA-256(OWNER_SALT + code) against OWNER_HASH, so the code itself is never in this file.
// Set the code with:  node tools/set_owner_code.mjs      (it asks for 6-12 digits; OWNER_HASH = '' means nobody can unlock)
// Menu: turn your LEFT palm toward your face and hold ~0.5 s, poke the buttons with your right index finger.
//  FLY    no gravity; left stick flies where you look (smooth, ~0.3 s ramp), left trigger = x2.5; hands still push off and collide
//  SIZE   SMALL / NORMAL / BIG and -/+ : 0.35x..3x (game.js updateScale asks owner.scale(); the head stays put like the monster)
//  NOCLIP (only while flying) hands don't stick and the head passes through walls
// Entering ESCAPE / BE THE MONSTER switches everything back to normal (turn it back on in the menu if you want).
export const OWNER_SALT = '';
export const OWNER_HASH = '';
const KEY = 'canopy-owner';
const MIN_S = 0.35, MAX_S = 3, FLY_SPEED = 4, BOOST = 2.5, FLY_TAU = 0.1, DRIFT_DAMP = 2, TRIES = 5, LOCK_MS = 60000;
const KEYPAD_AT = [-9.2, 3.2];   // x, z: on a stand just in front of the MODES wall (the wall buttons are at x -9.2, z 4.8..8)

const hex = (buf) => Array.from(new Uint8Array(buf), b => b.toString(16).padStart(2, '0')).join('');
export async function hashCode(salt, code) { return hex(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(salt + code))); }
export async function checkCode(code, salt = OWNER_SALT, hash = OWNER_HASH) {
  if (!hash || !/^\d{6,12}$/.test(code)) return false;
  return (await hashCode(salt, code)) === hash;
}
const load = () => { try { return JSON.parse(localStorage.getItem(KEY) || '{}') || {}; } catch (e) { return {}; } };
const save = (o) => { try { localStorage.setItem(KEY, JSON.stringify(o)); } catch (e) {} };

// one frame of smooth flying (pure, also used by the test view): the stick part of the velocity (flyVel) eases toward
// look-direction * speed with time constant FLY_TAU; whatever else you have (a hand push, a fall) glides and fades out
export function flyStep(vel, flyVel, dt, sx, sy, trig, dir, scale, _t) {
  if (Math.hypot(sx, sy) < 0.15) sx = sy = 0;                                        // dead zone
  const sp = FLY_SPEED * scale * (1 + (BOOST - 1) * trig);
  _t.r.set(0, 1, 0).crossVectors(dir, _t.r).normalize();                             // your right
  _t.want.copy(dir).multiplyScalar(-sy * sp).addScaledVector(_t.r, sx * sp);
  _t.old.copy(flyVel); flyVel.lerp(_t.want, 1 - Math.exp(-dt / FLY_TAU));
  vel.sub(_t.old).multiplyScalar(Math.exp(-dt * DRIFT_DAMP)).add(flyVel);
}

export function buildOwner({ THREE, scene, rig, camera, pulse = () => {}, showBanner = () => {}, gameMode = () => 'sandbox' }) {
  const V = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z);
  const saved = load();
  const st = { unlocked: !!(OWNER_HASH && saved.owner === true && saved.h === OWNER_HASH.slice(0, 16)), fly: false, noclip: false, size: null, open: false,
    fails: saved.fails | 0, lockUntil: +saved.lockUntil || 0, code: '', msg: '', msgCol: '#ffd23a', msgT: 0, red: 0, busy: false, noSave: false,
    hold: 0, latch: false, lastMode: 'sandbox', shownScale: null };
  const persist = () => { if (!st.noSave) save({ owner: st.unlocked, h: st.unlocked ? OWNER_HASH.slice(0, 16) : '', fails: st.fails, lockUntil: st.lockUntil }); };
  const flyVel = V(), _ft = { r: V(), want: V(), old: V() };
  const _l = V(), _p = V(), _q = new THREE.Quaternion(), _h = V(), _d = V(), _palm = V(), _toH = V(), _off = V(), pts = [null, null], _pp = [V(), V()];

  // ---- a touch panel: one canvas-textured plane, buttons in its local metres (centre origin, y up), poke = cross the face from the front
  function makePanel(w, h, buttons) {
    const c = document.createElement('canvas'); c.width = 512; c.height = Math.round(512 * h / w);
    const tex = new THREE.CanvasTexture(c); tex.colorSpace = THREE.SRGBColorSpace;
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshBasicMaterial({ map: tex, transparent: true }));
    return { mesh, c, g: c.getContext('2d'), tex, w, h, buttons, prevZ: [1, 1], cd: 0, lit: null, litT: 0, key: '' };
  }
  const px = (P, x, y) => [(x / P.w + 0.5) * P.c.width, (0.5 - y / P.h) * P.c.height];
  function drawButton(P, b, label, col, on = false) {
    const g = P.g, [cx, cy] = px(P, b.x, b.y), bw = b.w / P.w * P.c.width - 8, bh = b.h / P.h * P.c.height - 8, lit = P.lit === b.id;
    g.fillStyle = lit ? col : on ? 'rgba(61,255,124,0.25)' : '#2a2e33'; g.beginPath(); g.roundRect(cx - bw / 2, cy - bh / 2, bw, bh, 12); g.fill();
    g.strokeStyle = col; g.lineWidth = 5; g.stroke();
    g.fillStyle = lit ? '#111' : col; g.textAlign = 'center'; g.textBaseline = 'middle'; g.font = `900 ${Math.round(Math.min(bh * 0.5, bw * 1.6 / Math.max(2, label.length)))}px Arial`; g.fillText(label, cx, cy + 2, bw - 10);
  }
  function poke(P, dt, onPress) {   // pts[i] = fingertip of hand i (0 L, 1 R) or null
    P.cd = Math.max(0, P.cd - dt); if (P.litT > 0 && (P.litT -= dt) <= 0) P.lit = null;
    P.mesh.updateMatrixWorld();
    for (let i = 0; i < 2; i++) {
      const p = pts[i]; if (!p) { P.prevZ[i] = 1; continue; }
      P.mesh.worldToLocal(_l.copy(p)); const z = _l.z, was = P.prevZ[i]; P.prevZ[i] = z;
      if (!(was >= 0.01 && z < 0.01 && z > -0.08) || P.cd > 0) continue;
      const b = P.buttons.find(b => Math.abs(_l.x - b.x) < b.w / 2 && Math.abs(_l.y - b.y) < b.h / 2);
      if (b) { P.cd = 0.25; P.lit = b.id; P.litT = 0.18; onPress(b, i); }
    }
  }
  // fingertip: a little in front of the controller grip (grip -Z = where the fist points), scaled with you
  const tipOf = (inp, out) => out.set(0, -0.01, -0.06).applyQuaternion(inp.quat).multiplyScalar(rig.scale.x).add(inp.pos);

  // ---- the keypad (on a stand by the MODES wall, tilted back like a cash machine)
  const KB = [];
  ['1', '2', '3', '4', '5', '6', '7', '8', '9', 'CLR', '0', 'OK'].forEach((id, i) => KB.push({ id, x: ((i % 3) - 1) * 0.115, y: 0.105 - Math.floor(i / 3) * 0.115, w: 0.1, h: 0.1 }));
  const pad = makePanel(0.36, 0.58, KB);
  const stand = new THREE.Group(); stand.position.set(KEYPAD_AT[0], 0, KEYPAD_AT[1]); scene.add(stand);
  const dark = new THREE.MeshStandardMaterial({ color: '#2a2e33', metalness: 0.5, roughness: 0.6 });
  const post = new THREE.Mesh(new THREE.BoxGeometry(0.12, 1.1, 0.12), dark); post.position.y = 0.55; post.castShadow = true; stand.add(post);
  const head = new THREE.Group(); head.position.set(0.04, 1.22, 0); head.rotation.set(0, Math.PI / 2, 0); head.rotateX(-0.5); stand.add(head);
  const back = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.62, 0.03), dark); back.position.z = -0.018; head.add(back); head.add(pad.mesh);
  function drawPad() {
    const now = Date.now(), locked = now < st.lockUntil, secs = locked ? Math.ceil((st.lockUntil - now) / 1000) : 0;
    const showMsg = st.msgT > 0 ? st.msg : '';
    const key = [st.code.length, showMsg, st.red > 0, pad.lit, secs, st.unlocked, st.busy].join('|'); if (key === pad.key) return; pad.key = key;
    const g = pad.g, W = pad.c.width, H = pad.c.height;
    g.fillStyle = '#16191d'; g.fillRect(0, 0, W, H); g.strokeStyle = st.unlocked ? '#3dff7c' : '#f2c41c'; g.lineWidth = 8; g.strokeRect(4, 4, W - 8, H - 8);
    const [dx, dy] = px(pad, 0, 0.215); g.fillStyle = st.red > 0 ? '#7a0008' : '#0b0d0f'; g.fillRect(28, dy - 44, W - 56, 88);
    g.textAlign = 'center'; g.textBaseline = 'middle'; g.font = '900 52px Arial';
    let txt = 'STAFF ONLY', col = '#f2c41c';
    if (st.unlocked) { txt = 'OWNER'; col = '#3dff7c'; }
    if (locked) { txt = `LOCKED ${secs}s`; col = '#ff3a3a'; }
    else if (showMsg) { txt = showMsg; col = st.msgCol; }
    else if (st.busy) txt = 'CHECKING';
    else if (st.code.length) { txt = '*'.repeat(st.code.length); col = '#eee'; }
    g.fillStyle = col; g.fillText(txt, dx, dy + 3, W - 70);
    for (const b of KB) drawButton(pad, b, b.id, locked ? '#555' : b.id === 'OK' ? '#3dff7c' : b.id === 'CLR' ? '#ff9a3a' : '#f2c41c');
    pad.tex.needsUpdate = true;
  }
  const say = (m, col, secs = 1.6) => { st.msg = m; st.msgCol = col; st.msgT = secs; };
  const buzz = (inp, k, ms) => { for (const s of ['L', 'R']) if (inp?.[s]?.h) pulse(inp[s].h, k, ms); };
  function unlockNow(inp) {
    st.unlocked = true; st.fails = 0; st.lockUntil = 0; st.code = ''; persist(); say('UNLOCKED', '#3dff7c', 2);
    showBanner('OWNER MODE UNLOCKED', 'Turn your left palm to your face', '#3dff7c', 4); buzz(inp, 1, 400);
  }
  async function submit(inp) {
    const code = st.code; st.code = '';
    if (!OWNER_HASH) return say('NOT SET UP', '#ff9a3a');
    if (code.length < 6) return say('6-12 DIGITS', '#ff9a3a');
    if (!globalThis.crypto?.subtle) return say('NEEDS HTTPS', '#ff9a3a');
    st.busy = true; let ok = false; try { ok = await checkCode(code); } catch (e) {} st.busy = false;
    if (ok) return unlockNow(inp);
    st.fails++; st.red = 0.6; buzz(inp, 1, 250);
    if (st.fails >= TRIES) { st.fails = 0; st.lockUntil = Date.now() + LOCK_MS; } else say('WRONG CODE', '#ff3a3a');
    persist();
  }
  function keyPress(b, i, inp) {
    if (st.unlocked || st.busy || Date.now() < st.lockUntil) return;
    const h = inp?.[i ? 'R' : 'L']?.h; if (h) pulse(h, 0.4, 30);
    st.msgT = 0;
    if (b.id === 'CLR') st.code = ''; else if (b.id === 'OK') submit(inp); else if (st.code.length < 12) st.code += b.id;
  }

  // ---- the owner menu (floats above your left wrist while open)
  const MB = [{ id: 'fly', x: -0.0925, y: 0.045, w: 0.175, h: 0.07 }, { id: 'noclip', x: 0.0925, y: 0.045, w: 0.175, h: 0.07 },
    { id: 'small', x: -0.125, y: -0.04, w: 0.11, h: 0.07 }, { id: 'normal', x: 0, y: -0.04, w: 0.11, h: 0.07 }, { id: 'big', x: 0.125, y: -0.04, w: 0.11, h: 0.07 },
    { id: 'minus', x: -0.125, y: -0.125, w: 0.11, h: 0.07 }, { id: 'close', x: 0, y: -0.125, w: 0.11, h: 0.07 }, { id: 'plus', x: 0.125, y: -0.125, w: 0.11, h: 0.07 }];
  const menu = makePanel(0.38, 0.32, MB); menu.mesh.visible = false; menu.mesh.renderOrder = 6; scene.add(menu.mesh);
  const curScale = () => st.shownScale ?? rig.scale.x;
  function drawMenu() {
    const s = curScale().toFixed(1), key = [st.fly, st.noclip, s, menu.lit].join('|'); if (key === menu.key) return; menu.key = key;
    const g = menu.g, W = menu.c.width, H = menu.c.height;
    g.clearRect(0, 0, W, H); g.fillStyle = 'rgba(12,14,16,0.9)'; g.beginPath(); g.roundRect(4, 4, W - 8, H - 8, 26); g.fill(); g.strokeStyle = '#3dff7c'; g.lineWidth = 6; g.stroke();
    g.textAlign = 'center'; g.textBaseline = 'middle'; g.font = '900 36px Arial'; g.fillStyle = '#eee';
    const [sx, sy] = px(menu, 0, 0.118); g.fillText(`FLY: ${st.fly ? 'ON' : 'OFF'}   SIZE: ${s}x`, sx, sy, W - 40);
    drawButton(menu, MB[0], st.fly ? 'FLY ON' : 'FLY OFF', '#29c8ff', st.fly); drawButton(menu, MB[1], st.noclip ? 'NOCLIP ON' : 'NOCLIP OFF', '#ff9a3a', st.noclip);
    drawButton(menu, MB[2], 'SMALL', '#f2c41c'); drawButton(menu, MB[3], 'NORMAL', '#f2c41c', st.size === null); drawButton(menu, MB[4], 'BIG', '#f2c41c');
    drawButton(menu, MB[5], '-', '#f2c41c'); drawButton(menu, MB[6], 'CLOSE', '#ff3a3a'); drawButton(menu, MB[7], '+', '#f2c41c');
    menu.tex.needsUpdate = true;
  }
  const setOpen = (o) => { st.open = o; menu.mesh.visible = o; menu.prevZ[0] = menu.prevZ[1] = 1; };
  const sizeNow = () => st.size ?? +curScale().toFixed(2);
  function menuPress(b, i, inp) {
    const h = inp?.R?.h; if (h) pulse(h, 0.5, 40);
    if (b.id === 'fly') { st.fly = !st.fly; flyVel.set(0, 0, 0); }
    else if (b.id === 'noclip') st.noclip = !st.noclip;
    else if (b.id === 'small') st.size = 0.5; else if (b.id === 'big') st.size = 2; else if (b.id === 'normal') st.size = null;
    else if (b.id === 'plus') st.size = Math.min(MAX_S, sizeNow() * 1.25); else if (b.id === 'minus') st.size = Math.max(MIN_S, sizeNow() / 1.25);
    else if (b.id === 'close') setOpen(false);
  }
  function resetAll() { st.fly = false; st.noclip = false; st.size = null; flyVel.set(0, 0, 0); setOpen(false); }

  // ---- every frame. inp = { L: { pos, quat, h }, R: {...} } (the game's inputs object); head = the camera
  function update(dt, t, inp, headObj = camera) {
    const gm = gameMode();
    if (gm !== st.lastMode) { if (gm !== 'sandbox') resetAll(); st.lastMode = gm; }   // rounds start fair: owner settings off
    st.msgT = Math.max(0, st.msgT - dt); st.red = Math.max(0, st.red - dt);
    for (let i = 0; i < 2; i++) { const s = i ? 'R' : 'L'; pts[i] = inp?.[s]?.pos && inp[s].quat ? tipOf(inp[s], _pp[i]) : null; }
    if (gm === 'sandbox') { poke(pad, dt, (b, i) => keyPress(b, i, inp)); drawPad(); }
    if (!st.unlocked) { if (st.open) resetAll(); return; }
    const L = inp?.L; headObj.getWorldPosition(_h);
    if (L?.pos && L.quat) {   // LEFT palm toward your face for 0.5 s opens / closes the menu
      _palm.set(1, 0, 0).applyQuaternion(L.quat); _toH.copy(_h).sub(L.pos); const dist = _toH.length(); _toH.divideScalar(Math.max(dist, 1e-4));
      if (_palm.dot(_toH) > 0.6 && dist < 0.75 * rig.scale.x) { st.hold += dt; if (st.hold > 0.5 && !st.latch) { st.latch = true; setOpen(!st.open); buzz(inp, 0.5, 60); } }
      else { st.hold = 0; st.latch = false; }
      if (st.open) { const s = rig.scale.x; menu.mesh.scale.setScalar(s); menu.mesh.position.copy(L.pos).addScaledVector(_toH, 0.04 * s); menu.mesh.position.y += 0.2 * s; menu.mesh.lookAt(_h); }
    }
    if (st.open) { pts[0] = null; poke(menu, dt, (b, i) => menuPress(b, i, inp)); drawMenu(); }   // right finger only
  }

  const api = {
    update,
    get unlocked() { return st.unlocked; },
    get flying() { return st.unlocked && st.fly; },
    get noclip() { return st.unlocked && st.fly && st.noclip; },
    gravity: (g) => (st.unlocked && st.fly ? 0 : g),
    scale: (def) => (st.unlocked && st.size !== null ? st.size : def),
    // called from step() in the air: left stick flies you where you look (no-op unless flying)
    fly(vel, dt, padL, dir = camera.getWorldDirection(_d), scale = rig.scale.x) {
      if (!(st.unlocked && st.fly)) return;
      const ax = padL?.axes || [], trig = padL?.buttons?.[0]?.value ?? 0;
      flyStep(vel, flyVel, dt, ax[2] ?? 0, ax[3] ?? 0, trig, dir, scale, _ft);
    },
    // test-only: unlock without the code, ONLY on localhost and ONLY in ?view=owner (never saved)
    devUnlock() {
      if (location.hostname !== 'localhost' || new URLSearchParams(location.search).get('view') !== 'owner') return false;
      st.noSave = true; unlockNow(null); return true;
    },
    _st: st, _pad: pad, _menu: menu, _press: { key: keyPress, menu: menuPress },
  };
  return api;
}

// ---- ?view=owner (desktop, no headset): a fake right finger types 123456 + OK on the keypad (the real poke + check code),
// then the localhost-only bypass unlocks, the fake left palm turns to the camera and opens the menu (the real gesture code),
// the finger turns FLY on and cycles BIG / SMALL / + / NORMAL. A stand-in pillar shows the size and flies a loop with the real fly math.
export function ownerDesktopView(owner, realT, dt, { THREE, scene, camera }) {
  const st = owner._st, V = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z);
  const D = ownerDesktopView.D || (ownerDesktopView.D = (() => {
    st.noSave = true;   // the test view never writes localStorage
    const fig = new THREE.Group(); const m = new THREE.MeshStandardMaterial({ color: '#d9822b', roughness: 0.7 });
    const body = new THREE.Mesh(new THREE.CylinderGeometry(0.18, 0.2, 1.1, 16), m); body.position.y = 0.55; fig.add(body);
    const hd = new THREE.Mesh(new THREE.SphereGeometry(0.16, 16, 12), m); hd.position.y = 1.3; fig.add(hd); fig.position.set(-11.2, 0, 1.4); scene.add(fig);
    const mk = () => ({ pos: V(), quat: new THREE.Quaternion(), h: null });
    return { t: 0, fig, s: 1, vel: V(), L: mk(), R: mk(), padL: { axes: [0, 0, 0, 0], buttons: [{ value: 0 }] }, unlocked: false, logged: {}, o: new THREE.Object3D(), mtx: new THREE.Matrix4() };
  })());
  const t = (D.t += dt);   // the view's own clock (sum of frame dt), so a slow / background tab still hits every step
  camera.position.set(-7.75, 1.45, 3.05); camera.lookAt(-9.15, 1.2, 2.75); camera.updateMatrixWorld(true);
  const cam = camera.getWorldPosition(V()), fwd = camera.getWorldDirection(V()), up = V(0, 1, 0), right = fwd.clone().cross(up).normalize();
  // the right hand: idle low by your side, or pressing a panel button (the fingertip goes 5 cm in front of it -> 3 cm through -> back)
  const R = D.R; R.pos.copy(cam).addScaledVector(fwd, 0.3).addScaledVector(right, 0.3).add(V(0, -0.6, 0)); R.quat.identity();
  const press = (P, id, t0) => {
    if (t < t0 || t > t0 + 0.6) return false;
    const b = P.buttons.find(b => b.id === id); P.mesh.updateMatrixWorld(); const B = P.mesh.localToWorld(V(b.x, b.y, 0));
    const n = V(0, 0, 1).transformDirection(P.mesh.matrixWorld); const F = B.addScaledVector(n, 0.05 - 0.08 * Math.sin(Math.PI * (t - t0) / 0.6));
    D.o.position.copy(F); D.o.lookAt(F.clone().add(n)); R.quat.copy(D.o.quaternion);   // grip -Z points into the panel
    R.pos.copy(F).sub(V(0, -0.01, -0.06).applyQuaternion(R.quat).multiplyScalar(camera.parent.scale.x)); return true;
  };
  '123456'.split('').concat('OK').forEach((id, i) => press(owner._pad, id, 1 + i * 0.6));
  if (t > 6 && !D.unlocked) { D.unlocked = true; console.log('[owner] devUnlock', owner.devUnlock(), 'unlocked=' + owner.unlocked); }
  // the left hand: low and palm down until 6.5 s, then up in front of you with the palm toward your face
  const L = D.L, palmUp = t > 6.5;
  L.pos.copy(cam).addScaledVector(fwd, palmUp ? 0.5 : 0.3).addScaledVector(right, palmUp ? -0.17 : -0.3).add(V(0, palmUp ? -0.3 : -0.6, 0));
  const x = palmUp ? cam.clone().sub(L.pos).normalize() : V(0, -1, 0), z = up.clone().negate().addScaledVector(x, x.y).normalize();   // fingers (-Z) up
  if (!palmUp) z.copy(fwd).setY(0).normalize().negate();
  const y = z.clone().cross(x).normalize(); D.mtx.makeBasis(x, y, z); L.quat.setFromRotationMatrix(D.mtx);
  if (st.open) { if (!D.logged.open) { D.logged.open = true; console.log('[owner] menu opened at t=' + t.toFixed(2)); }
    press(owner._menu, 'fly', 8); const c = (t - 10) % 8; if (t > 10) [['big', 0], ['small', 2], ['plus', 4], ['normal', 6]].forEach(([id, k]) => press(owner._menu, id, t - c + k)); }
  // the stand-in "rig": size eases like updateScale; while flying it holds the stick at 35 % and looks around a circle
  const target = owner.scale(1); D.s += (target - D.s) * Math.min(1, dt * 3); D.fig.scale.setScalar(D.s); st.shownScale = D.s;
  if (owner.flying) { const a = t * 0.9; D.padL.axes[3] = -0.35; owner.fly(D.vel, dt, D.padL, V(-Math.sin(a), 0.15 * Math.sin(t * 1.7), -Math.cos(a)), D.s); }
  else D.vel.y -= owner.gravity(9.8) * dt;
  D.fig.position.addScaledVector(D.vel, dt); if (D.fig.position.y < 0) { D.fig.position.y = 0; D.vel.y = 0; }
  if (Math.hypot(D.fig.position.x + 11.2, D.fig.position.z - 1.4) > 2.2) { D.fig.position.set(-11.2, D.fig.position.y, 1.4); }   // keep it in shot
  if (owner.flying && !D.logged.ramp) { D.logged.ramp = true;   // the real fly math on its own: full stick from rest, then release (72 fps)
    const v = V(), fv = V(), tmp = { r: V(), want: V(), old: V() }, out = [];
    for (let i = 1; i <= 72; i++) { const on = i <= 36; flyStep(v, fv, 1 / 72, 0, on ? -1 : 0, 0, V(0, 0, -1), 1, tmp); if (i % 7 === 0 || i === 36) out.push(`${(i / 72).toFixed(2)}s:${v.length().toFixed(2)}`); }
    const vb = V(), fb = V(); for (let i = 0; i < 72; i++) flyStep(vb, fb, 1 / 72, 0, -1, 1, V(0, 0, -1), 1, tmp);
    console.log('[owner] fly ramp (stick held 0-0.5 s, released after) m/s ' + out.join(' '), '| trigger boost after 1 s: ' + vb.length().toFixed(2) + ' m/s');
  }
  const sNow = owner.scale(1).toFixed(2); if (D.logged.s !== sNow) { D.logged.s = sNow; console.log('[owner] t=' + t.toFixed(1) + ' fly=' + owner.flying + ' size target=' + sNow); }
  owner.update(dt, t, { L, R }, camera);
}
