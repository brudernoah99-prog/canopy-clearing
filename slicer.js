// Mesh slicer: cuts any static object (a gorilla part, or a piece of one) in two along a plane, anywhere,
// and closes each side with a cut face (a cap). Pieces can be cut again and again.
import * as THREE from 'three';

const V = () => new THREE.Vector3();
const BIG = 300;   // meshes with more vertices than this get sliced; smaller decorations (wound caps, bones) go whole to one side

// chain cut segments [a0, b0, a1, b1, ...] into closed outlines (arrays of points); open chains are closed on themselves
function cutLoops(seg) {
  const key = (q) => `${Math.round(q.x * 1e4)},${Math.round(q.y * 1e4)},${Math.round(q.z * 1e4)}`;
  const n = seg.length / 2, used = new Uint8Array(n), at = new Map();
  for (let i = 0; i < n; i++) for (const e of [0, 1]) { const k = key(seg[i * 2 + e]); if (!at.has(k)) at.set(k, []); at.get(k).push(i * 2 + e); }
  const loops = [], open = [];
  for (let s0 = 0; s0 < n; s0++) {
    if (used[s0]) continue; used[s0] = 1;
    const loop = [seg[s0 * 2]]; const startK = key(seg[s0 * 2]); let cur = seg[s0 * 2 + 1];
    for (let guard = 0; guard < n; guard++) {
      const k = key(cur); if (k === startK) break;
      loop.push(cur);
      const nxt = (at.get(k) || []).find(e => !used[e >> 1]); if (nxt === undefined) break;
      used[nxt >> 1] = 1; cur = seg[nxt ^ 1];
    }
    if (key(cur) === startK) { if (loop.length >= 3) loops.push(loop); } else open.push(loop);
  }
  // open chains (a seam between two meshes whose points don't match exactly): glue each chain's end to the nearest
  // chain start/end within 3 cm, until it comes back round to its own start
  while (open.length) {
    const ch = open.pop();
    for (let guard = 0; guard < 64; guard++) {
      const end = ch[ch.length - 1]; let bi = -1, bd = 0.03, rev = false;
      for (let i = 0; i < open.length; i++) { const o = open[i]; const d0 = end.distanceTo(o[0]), d1 = end.distanceTo(o[o.length - 1]);
        if (d0 < bd) { bd = d0; bi = i; rev = false; } if (d1 < bd) { bd = d1; bi = i; rev = true; } }
      if (bi < 0 || end.distanceTo(ch[0]) <= bd) break;
      const o = open.splice(bi, 1)[0]; if (rev) o.reverse(); for (const q of o) ch.push(q);
    }
    if (ch.length >= 3) loops.push(ch);
  }
  return loops;
}

// returns { a, b } (new objects in the scene, same world rotation/scale as obj, origin at each half's centre) or null if the plane misses
export { cutLoops };
export function sliceObject(obj, planeW, capMat) {
  obj.updateMatrixWorld(true);
  const rootInv = obj.matrixWorld.clone().invert();
  const planeL = planeW.clone().applyMatrix4(rootInv);                 // plane in the object's own space
  const n = planeL.normal.clone();
  const sides = [{ meshes: [], decor: [], cut: [] }, { meshes: [], decor: [], cut: [] }];
  let anyCut = false;
  // top-level children: sliceable if they hold a big mesh, otherwise decorations
  const kids = obj.children.slice();
  const bigMeshes = [];
  // a child that holds part of the body's shell (a big mesh, or a mesh flagged userData.shell: earlier cut faces, seam stumps)
  // is sliced WHOLE: every mesh in it, small ones too. (Before, small meshes inside a big child - the seam stumps that close
  // the neck/shoulder holes - were silently dropped, so a cut head or torso had an open hole you could look straight into.)
  const shellMesh = (m) => m.isMesh && !m.isSkinnedMesh && (m.geometry.attributes.position.count > BIG || m.userData.shell || m.userData.stump);
  for (const k of kids) {
    let big = false; k.traverse(m => { if (shellMesh(m)) big = true; });
    if (big) k.traverse(m => { if (m.isMesh && !m.isSkinnedMesh) bigMeshes.push(m); });
    else { const c = k.getWorldPosition(V()).applyMatrix4(rootInv); sides[planeL.distanceToPoint(c) >= 0 ? 0 : 1].decor.push(k); }
  }
  if (!bigMeshes.length) return null;
  for (const m of bigMeshes) {
    if (!m.visible) continue;
    const toRoot = rootInv.clone().multiply(m.matrixWorld); const nm = new THREE.Matrix3().getNormalMatrix(toRoot);
    let g = m.geometry; if (g.index) g = g.toNonIndexed();
    const P = g.attributes.position, N = g.attributes.normal, U = g.attributes.uv;
    const mats = Array.isArray(m.material) ? m.material : [m.material];
    const matOf = new Int16Array(P.count / 3);
    if (g.groups.length) for (const gr of g.groups) for (let v = gr.start; v < gr.start + gr.count; v += 3) matOf[v / 3] = gr.materialIndex || 0;
    const out = [[], []].map(() => mats.map(() => ({ p: [], n: [], u: [] })));
    const p = [V(), V(), V()], nn = [V(), V(), V()], uu = [new THREE.Vector2(), new THREE.Vector2(), new THREE.Vector2()], d = [0, 0, 0];
    const push = (side, mi, P3, N3, U3) => { const o = out[side][mi]; for (let k = 0; k < 3; k++) { o.p.push(P3[k].x, P3[k].y, P3[k].z); o.n.push(N3[k].x, N3[k].y, N3[k].z); if (U) o.u.push(U3[k].x, U3[k].y); } };
    const lerpV = (a, b, t) => a.clone().lerp(b, t), lerpU = (a, b, t) => a.clone().lerp(b, t);
    for (let t = 0; t < P.count / 3; t++) {
      for (let k = 0; k < 3; k++) { const i = t * 3 + k; p[k].fromBufferAttribute(P, i).applyMatrix4(toRoot); if (N) nn[k].fromBufferAttribute(N, i).applyMatrix3(nm).normalize(); else nn[k].set(0, 1, 0); if (U) uu[k].fromBufferAttribute(U, i); d[k] = planeL.distanceToPoint(p[k]); }
      const mi = matOf[t] < mats.length ? matOf[t] : 0;
      const pos = d.map(x => x >= 0);
      if (pos[0] && pos[1] && pos[2]) { push(0, mi, p, nn, uu); continue; }
      if (!pos[0] && !pos[1] && !pos[2]) { push(1, mi, p, nn, uu); continue; }
      anyCut = true;
      // the odd vertex out is alone on its side; the triangle splits into 1 + 2 triangles
      const lone = pos[0] === pos[1] ? 2 : pos[0] === pos[2] ? 1 : 0; const a = lone, b = (lone + 1) % 3, c = (lone + 2) % 3;
      const tb = d[a] / (d[a] - d[b]), tc = d[a] / (d[a] - d[c]);
      const pb = lerpV(p[a], p[b], tb), pc = lerpV(p[a], p[c], tc), nb = lerpV(nn[a], nn[b], tb).normalize(), nc = lerpV(nn[a], nn[c], tc).normalize();
      const ub = lerpU(uu[a], uu[b], tb), uc = lerpU(uu[a], uu[c], tc);
      const loneSide = pos[a] ? 0 : 1, otherSide = 1 - loneSide;
      push(loneSide, mi, [p[a], pb, pc], [nn[a], nb, nc], [uu[a], ub, uc]);
      push(otherSide, mi, [pb, p[b], p[c]], [nb, nn[b], nn[c]], [ub, uu[b], uu[c]]);
      push(otherSide, mi, [pb, p[c], pc], [nb, nn[c], nc], [ub, uu[c], uc]);
      sides[0].cut.push(pb, pc); sides[1].cut.push(pb, pc);
    }
    for (let s = 0; s < 2; s++) {
      const geo = new THREE.BufferGeometry(); const P2 = [], N2 = [], U2 = []; let start = 0;
      const app = (dst, src) => { for (let i = 0; i < src.length; i++) dst.push(src[i]); };   // (no spread: these arrays are big)
      out[s].forEach((o, mi) => { if (!o.p.length) return; app(P2, o.p); app(N2, o.n); app(U2, o.u); geo.addGroup(start, o.p.length / 3, mi); start += o.p.length / 3; });
      if (!P2.length) continue;
      geo.setAttribute('position', new THREE.Float32BufferAttribute(P2, 3)); geo.setAttribute('normal', new THREE.Float32BufferAttribute(N2, 3)); if (U && U2.length) geo.setAttribute('uv', new THREE.Float32BufferAttribute(U2, 2));
      const mesh = new THREE.Mesh(geo, mats.length > 1 ? mats : mats[0]); mesh.castShadow = true; mesh.receiveShadow = true; mesh.userData.shell = true; if (m.userData.stump) mesh.userData.stump = true; sides[s].meshes.push(mesh);
    }
  }
  if (!anyCut) return null;
  // build the two new objects
  const wq = obj.getWorldQuaternion(new THREE.Quaternion()), ws = obj.getWorldScale(V());
  const res = [];
  for (let s = 0; s < 2; s++) {
    const S = sides[s]; if (!S.meshes.length) return null;
    const box = new THREE.Box3(); S.meshes.forEach(m => { m.geometry.computeBoundingBox(); box.union(m.geometry.boundingBox); });
    const center = box.getCenter(V());
    const root = new THREE.Group(); const par = obj.parent; par.updateMatrixWorld(true);
    const worldM = new THREE.Matrix4().compose(center.clone().applyMatrix4(obj.matrixWorld), wq, ws);
    new THREE.Matrix4().copy(par.matrixWorld).invert().multiply(worldM).decompose(root.position, root.quaternion, root.scale);   // same place in the world, under the same parent
    par.add(root); root.updateMatrixWorld(true);
    // (meshes are in obj space; shift them so the new root's origin is their centre)
    S.meshes.forEach(m => { m.geometry.translate(-center.x, -center.y, -center.z); m.geometry.computeBoundingSphere(); root.add(m); });
    // cap: the cut segments are chained into closed outlines (fur, hand, mouth, stump... each its own loop), outlines that sit
    // inside a bigger one are dropped (the big cap covers them), and each outline is triangulated on its own (earcut).
    // (Before, all cut points went into ONE fan sorted by angle: with several outlines - forearm fur + hand skin, head + mouth -
    // the fan zig-zagged between them and left thin open slivers you could see through.)
    const capN = s === 0 ? n.clone().negate() : n.clone();
    let capC = null;
    const loops = S.cut.length >= 6 ? cutLoops(S.cut) : [];
    if (loops.length) {
      const u = Math.abs(capN.x) < 0.9 ? V().set(1, 0, 0) : V().set(0, 1, 0); u.sub(capN.clone().multiplyScalar(u.dot(capN))).normalize(); const w = capN.clone().cross(u);
      const c = V(); let cnt = 0; loops.forEach(l => l.forEach(q => { c.add(q); cnt++; })); c.divideScalar(cnt);
      const L2 = loops.map(l => l.map(q => { const r = q.clone().sub(c); return new THREE.Vector2(r.dot(u), r.dot(w)); }));
      const area = L2.map(l => Math.abs(THREE.ShapeUtils.area(l)));
      let R = 0.01; L2.forEach(l => l.forEach(p2 => { R = Math.max(R, p2.length()); }));
      const inside = (pt, poly) => { let o = false; for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) { const a = poly[i], b = poly[j]; if ((a.y > pt.y) !== (b.y > pt.y) && pt.x < (b.x - a.x) * (pt.y - a.y) / (b.y - a.y) + a.x) o = !o; } return o; };
      const pos = [], nor = [], uv = []; let best = -1, bestA = 0; const _e1 = V(), _e2 = V();
      for (let li = 0; li < loops.length; li++) {
        if (area[li] < 1e-6) continue;
        if (L2.some((o, oi) => oi !== li && area[oi] > area[li] && inside(L2[li][0], o))) continue;   // nested: covered by the outer cap
        const tris = THREE.ShapeUtils.triangulateShape(L2[li], []);
        for (const t of tris) { const A = loops[li][t[0]], B = loops[li][t[1]], C = loops[li][t[2]];
          const flip = _e1.subVectors(B, A).cross(_e2.subVectors(C, A)).dot(capN) < 0; const ord = flip ? [t[0], t[2], t[1]] : t;
          for (const k of ord) { const q = loops[li][k].clone().sub(center).addScaledVector(capN, 0.0015), p2 = L2[li][k]; pos.push(q.x, q.y, q.z); nor.push(capN.x, capN.y, capN.z); uv.push(0.5 + p2.x / (2.1 * R), 0.5 + p2.y / (2.1 * R)); } }
        if (area[li] > bestA) { bestA = area[li]; best = li; }
      }
      if (pos.length) {
        const cg = new THREE.BufferGeometry(); cg.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); cg.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3)); cg.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
        const cm = new THREE.Mesh(cg, capMat); cm.userData.shell = true; root.add(cm);
        const bc = V(); loops[best].forEach(q => bc.add(q)); bc.divideScalar(loops[best].length); capC = bc.sub(center);
      }
    }
    S.decor.forEach(k => root.attach(k));
    const lb = box.clone().translate(center.clone().negate());
    root.userData = { lb: [lb.min.toArray(), lb.max.toArray()], capLocal: capC, capDir: capN.clone(), sliced: true, size: box.getSize(V()).length() };
    res.push(root);
  }
  obj.parent.remove(obj);
  return { a: res[0], b: res[1], normal: planeW.normal.clone() };
}
