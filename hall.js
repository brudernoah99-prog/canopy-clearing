// Lobby extras: fur dye vats (by the mirror) and a trophy shelf with your records (by the MODES wall).
//  - touch a vat's glowing liquid with either hand to dye your fur; 3 colours are free, 3 are earned in the modes
//  - the shelf shows BEST ESCAPE (fastest time) and MOST CAUGHT (Be the Monster); a new record makes its plinth glow
// Draw calls: vats 1 (instanced) + liquids 1 (instanced) + board 1 + plinths 1 (instanced) + cups 1 (instanced) + 2 caps + 2 plaques = 9.
import * as THREE from 'three';

// [id, name, swatch / fur colour, unlock hint (null = free)]; 'orange' leaves the baked texture untouched
export const DYES = [
  ['orange', 'ORANGE', '#e07a1f', null],
  ['moss', 'MOSS', '#4f7d2a', null],
  ['midnight', 'MIDNIGHT', '#1c2a66', null],
  ['bone', 'BONE', '#ece6d4', 'ESCAPE ONCE'],
  ['ember', 'EMBER', '#c42a18', 'CATCH THEM ALL'],
  ['jungle', 'JUNGLE', '#12a58c', 'ESCAPE < 2:00'],
];
let FAKE = null, hallRef = null;   // fakeProgress(): everything unlocked + sample records, in memory only (screenshots)
export function fakeProgress() { FAKE = { escapes: 1, bestEscape: 94, monsterAll: true, bestMonster: { caught: 6, total: 8, left: 12 } }; if (hallRef) hallRef.refresh(); }

const fmtTime = (s) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;
const canvasTex = (w, h) => { const c = document.createElement('canvas'); c.width = w; c.height = h; const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return { c, t, g: c.getContext('2d') }; };

// active(): false while a round runs in the big facility, so update() skips the whole lobby (vats, shelf) then
export function buildHall({ scene, gore, me, mirrorPos, modeWallPos, progress, rig = null, banner = null, collide = null, active = null }) {
  const P = (k, d) => (FAKE && k in FAKE ? FAKE[k] : progress.get(k, d));
  const unlocked = (id) => id === 'bone' ? P('escapes', 0) > 0 : id === 'ember' ? !!P('monsterAll', false) : id === 'jungle' ? P('bestEscape', 1e9) < 120 : true;
  const hexOf = (i) => (DYES[i][0] === 'orange' ? 'orange' : DYES[i][2]);
  const M4 = new THREE.Matrix4(), Q0 = new THREE.Quaternion(), S1 = new THREE.Vector3(1, 1, 1), T3 = new THREE.Vector3(), C = new THREE.Color(), WHITE = new THREE.Color('#ffffff');

  // ---------------- dye vats: a row along the back wall, just right of the mirror ----------------
  const SP = 0.46, VZ = mirrorPos.z + 3.25, X0 = mirrorPos.x + 0.35, VH = 0.8, LY = VH - 0.03;   // vat i at x = X0 + i*SP; LY = liquid puck centre
  const vatPos = DYES.map((_, i) => new THREE.Vector3(X0 + i * SP, VH, VZ));      // liquid surface centre (the touch point)
  const metal = new THREE.MeshStandardMaterial({ color: '#9aa2ab', metalness: 0.55, roughness: 0.35 });
  const vatGeo = new THREE.CylinderGeometry(0.17, 0.15, VH - 0.05, 18); vatGeo.translate(0, (VH - 0.05) / 2, 0);
  const vats = new THREE.InstancedMesh(vatGeo, metal, DYES.length);
  // the liquid: a glowing puck that sits in the rim and pokes out a little, so it reads from the side too
  const liquid = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.155, 0.155, 0.06, 20), new THREE.MeshBasicMaterial({ color: '#ffffff' }), DYES.length);
  vatPos.forEach((p, i) => { vats.setMatrixAt(i, M4.makeTranslation(p.x, 0, p.z)); liquid.setMatrixAt(i, M4.makeTranslation(p.x, LY, p.z)); liquid.setColorAt(i, C.set('#000')); });
  vats.castShadow = true; vats.receiveShadow = true; scene.add(vats, liquid);
  if (collide) collide(new THREE.Vector3(X0 - 0.17, 0, VZ - 0.17), new THREE.Vector3(X0 + (DYES.length - 1) * SP + 0.17, VH - 0.04, VZ + 0.17));
  // the board on the wall above: title, colour names, lock hints (redrawn only when an unlock or the choice changes)
  const BW = DYES.length * SP + 0.2, BH = 0.72; const bd = canvasTex(1024, Math.round(1024 * BH / BW));
  const board = new THREE.Mesh(new THREE.PlaneGeometry(BW, BH), new THREE.MeshStandardMaterial({ map: bd.t, roughness: 0.6, emissive: '#ffffff', emissiveMap: bd.t, emissiveIntensity: 0.3 }));
  board.position.set(X0 + (DYES.length - 1) * SP / 2, 1.4, VZ + 0.41); board.rotation.y = Math.PI; scene.add(board);   // faces -z, into the hall

  let sel = Math.max(0, DYES.findIndex(d => d[0] === progress.get('fur', 'orange'))); if (!unlocked(DYES[sel][0])) sel = 0;
  const flashT = new Float32Array(DYES.length); let colorsDirty = true;
  function drawBoard() {
    const { g, c } = bd, W = c.width, H = c.height, col = W / DYES.length;
    g.fillStyle = '#1d2126'; g.fillRect(0, 0, W, H); g.strokeStyle = '#f2c41c'; g.lineWidth = 8; g.strokeRect(6, 6, W - 12, H - 12);
    g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillStyle = '#f2c41c'; g.font = '900 46px Arial'; g.fillText('FUR DYE', W / 2, 40); g.fillStyle = '#ddd'; g.font = '700 22px Arial'; g.fillText('DIP A HAND IN THE COLOUR', W / 2, 76);
    DYES.forEach(([id, name, hex, hint], i) => {
      const x = W - (i + 0.5) * col, on = unlocked(id);   // the board faces -z, so vat 0 (smallest x) is on the canvas' right
      g.fillStyle = on ? hex : '#3a3f45'; g.beginPath(); g.arc(x, 122, 26, 0, 7); g.fill(); if (i === sel) { g.strokeStyle = '#fff'; g.lineWidth = 6; g.stroke(); }
      g.fillStyle = on ? '#f2f2f2' : '#888'; g.font = '900 34px Arial'; g.fillText(name, x, 178, col - 12);
      g.font = '800 23px Arial'; g.fillStyle = on ? (i === sel ? '#3dff7c' : '#aaa') : '#ff7a4a'; g.fillText(on ? (i === sel ? 'WEARING' : hint ? 'UNLOCKED' : 'FREE') : hint, x, 218, col - 10);
    });
    bd.t.needsUpdate = true;
  }
  function paintLiquids() {   // locked = dim, chosen = full, others slightly calmer; a touch flashes white
    DYES.forEach(([id, , hex], i) => { C.set(hex).multiplyScalar(unlocked(id) ? (i === sel ? 1 : 0.7) : 0.05); if (flashT[i] > 0) C.lerp(WHITE, flashT[i] * 0.6); liquid.setColorAt(i, C); });
    liquid.instanceColor.needsUpdate = true;
  }
  function choose(i, save = true) {
    liquid.setMatrixAt(sel, M4.makeTranslation(vatPos[sel].x, LY, vatPos[sel].z));   // the old choice stops rippling
    sel = i; me.setFurColor(hexOf(i)); drawBoard(); colorsDirty = true;
    if (save) { progress.set('fur', DYES[i][0]); progress.save(); }
  }

  // ---------------- trophy shelf: two plinths next to the MODES wall ----------------
  const TX = modeWallPos.x, TZ = [modeWallPos.z + 3.0, modeWallPos.z + 4.0];
  // pale stone columns with a rounded gold rim on top: they must not read as the dark, square mode buttons
  const plinths = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.22, 0.27, 1.0, 20), new THREE.MeshStandardMaterial({ color: '#d8d0bd', metalness: 0.0, roughness: 0.85 }), 2);
  const cupPts = [[0, 0], [0.07, 0], [0.07, 0.015], [0.02, 0.03], [0.018, 0.09], [0.06, 0.12], [0.085, 0.2], [0.08, 0.205], [0.05, 0.13], [0, 0.11]].map(([x, y]) => new THREE.Vector2(x, y));
  const cups = new THREE.InstancedMesh(new THREE.LatheGeometry(cupPts, 16), new THREE.MeshStandardMaterial({ color: '#e8b923', metalness: 0.8, roughness: 0.3, emissive: '#5a3a00', emissiveIntensity: 0.4 }), 2);
  // the cap: a round gold slab with a rolled (rounded) edge, as one lathe
  const capGeo = new THREE.LatheGeometry([[0, 0], [0.25, 0], [0.265, 0.012], [0.27, 0.03], [0.26, 0.05], [0.235, 0.062], [0, 0.062]].map(([x, y]) => new THREE.Vector2(x, y)), 24), plqGeo = new THREE.PlaneGeometry(0.3, 0.15);
  const shelf = TZ.map((z, i) => {
    plinths.setMatrixAt(i, M4.makeTranslation(TX, 0.5, z)); cups.setMatrixAt(i, M4.makeTranslation(TX, 1.062, z));
    const capMat = new THREE.MeshStandardMaterial({ color: '#c9a227', emissive: '#ffb81c', emissiveIntensity: 0.35, metalness: 0.4, roughness: 0.4 });
    const cap = new THREE.Mesh(capGeo, capMat); cap.position.set(TX, 1.0, z);
    const pc = canvasTex(256, 128); const plqMat = new THREE.MeshStandardMaterial({ map: pc.t, roughness: 0.6, emissive: '#ffffff', emissiveMap: pc.t, emissiveIntensity: 0.35 });
    const plaque = new THREE.Mesh(plqGeo, plqMat); plaque.position.set(TX + 0.237, 0.74, z); plaque.rotation.y = Math.PI / 2;   // on the column's +x side, toward the hall
    scene.add(cap, plaque); if (collide) collide(new THREE.Vector3(TX - 0.25, 0, z - 0.25), new THREE.Vector3(TX + 0.25, 1.05, z + 0.25));
    return { capMat, plqMat, pc, glow: 0, last: '' };
  });
  plinths.castShadow = cups.castShadow = true; plinths.receiveShadow = true; scene.add(plinths, cups);
  function drawPlaque(i, title, value) {
    const S = shelf[i], key = title + value; if (key === S.last) return; S.last = key; const { g } = S.pc;
    g.fillStyle = '#14171a'; g.fillRect(0, 0, 256, 128); g.strokeStyle = '#e8b923'; g.lineWidth = 6; g.strokeRect(4, 4, 248, 120);
    g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillStyle = '#e8b923'; g.font = '900 28px Arial'; g.fillText(title, 128, 34, 236);
    g.fillStyle = '#fff'; g.font = '900 54px Arial'; g.fillText(value, 128, 86, 236); S.pc.t.needsUpdate = true;
  }
  function drawShelf() {
    const be = P('bestEscape', null), bm = P('bestMonster', null);
    drawPlaque(0, 'BEST ESCAPE', be == null ? '—' : fmtTime(be));
    drawPlaque(1, 'MOST CAUGHT', bm ? `${bm.caught}/${bm.total}` : '—');
  }

  // ---------------- records (called by game.js when a round ends) ----------------
  let pending = null, pendingAt = 0, clock = 0;   // unlock message, shown after the end-of-round banners
  function celebrate(i) { shelf[i].glow = 4; gore.sfx('record', 1); }
  function afterRecord(before) {
    const fresh = DYES.filter(([id], k) => !before[k] && unlocked(id)).map(d => d[1]);
    progress.save(); drawShelf();
    if (fresh.length) { drawBoard(); colorsDirty = true; pending = [`NEW FUR DYE${fresh.length > 1 ? 'S' : ''}`, `${fresh.join(' + ')}: dip a hand in the vat by the mirror`]; pendingAt = clock + 9.5; }
  }
  function recordEscape(seconds) {
    const before = DYES.map(([id]) => unlocked(id));
    progress.set('escapes', progress.get('escapes', 0) + 1);
    const best = progress.get('bestEscape', null), isNew = best == null || seconds < best;
    if (isNew) { progress.set('bestEscape', Math.round(seconds * 10) / 10); celebrate(0); }
    afterRecord(before); return isNew;
  }
  function recordMonster(caught, total, secondsLeft = 0) {
    const before = DYES.map(([id]) => unlocked(id));
    if (total > 0 && caught >= total) progress.set('monsterAll', true);
    const b = progress.get('bestMonster', null);
    const isNew = caught > 0 && (!b || caught > b.caught || (caught === b.caught && secondsLeft > b.left));
    if (isNew) { progress.set('bestMonster', { caught, total, left: Math.round(secondsLeft) }); celebrate(1); }
    afterRecord(before); return isNew;
  }

  // ---------------- per frame ----------------
  const armed = new Uint8Array(DYES.length).fill(1);
  function update(dt, t, handPoints = [], pulse = null) {
    if (active && !active()) return;   // not in the lobby: nothing here to touch or see
    clock = t; const sc = rig ? rig.scale.x : 1;
    for (let i = 0; i < DYES.length; i++) {
      const p = vatPos[i]; let near = false, around = false;
      for (let k = 0; k < handPoints.length; k++) { const d = handPoints[k].distanceTo(p); if (d < 0.16 * sc) near = true; if (d < 0.32 * sc) around = true; }
      if (near && armed[i]) { armed[i] = 0; flashT[i] = 1; colorsDirty = true;
        if (unlocked(DYES[i][0])) { if (i !== sel) choose(i); gore.sfx('dye', 0.8); if (pulse) pulse(0.5, 90); }
        else { gore.sfx('thud', 0.25); if (pulse) pulse(0.15, 30); if (banner) banner(`${DYES[i][1]} IS LOCKED`, DYES[i][3], '#ff7a4a', 2); } }
      if (!around) armed[i] = 1;
      if (flashT[i] > 0) { flashT[i] = Math.max(0, flashT[i] - dt * 2.5); colorsDirty = true; }
    }
    // the chosen vat's liquid ripples up and down a little (one matrix per frame)
    T3.set(vatPos[sel].x, LY + 0.008 * Math.sin(t * 3), vatPos[sel].z); liquid.setMatrixAt(sel, M4.compose(T3, Q0, S1)); liquid.instanceMatrix.needsUpdate = true;
    if (colorsDirty) { colorsDirty = false; paintLiquids(); }
    for (const S of shelf) if (S.glow > 0 || S.lit) { S.glow = Math.max(0, S.glow - dt); const k = S.glow > 0 ? Math.min(1, S.glow) * (0.75 + 0.25 * Math.sin(t * 9)) : 0;
      S.capMat.emissiveIntensity = 0.35 + 3 * k; S.plqMat.emissiveIntensity = 0.35 + 0.6 * k; S.lit = S.glow > 0; }
    if (pending && t > pendingAt) { if (banner) banner(pending[0], pending[1], '#3dff7c', 4); pending = null; }
  }
  function refresh() { drawBoard(); drawShelf(); colorsDirty = true; }
  me.setFurColor(hexOf(sel)); refresh(); paintLiquids();
  // preview(i): show a colour on the player without saving (desktop test view)
  const api = { update, recordEscape, recordMonster, refresh, preview: (i) => choose(i % DYES.length, false), DYES, vatPos };
  hallRef = api; return api;
}
