// Mesh slicer: cuts any static object (a gorilla part, or a piece of one) in two along a plane, anywhere,
// and closes each side with a cut face (a cap). Pieces can be cut again and again.
import * as THREE from 'three';

const V = () => new THREE.Vector3();
const BIG = 300;   // meshes with more vertices than this get sliced; smaller decorations (wound caps, bones) go whole to one side

// returns { a, b } (new objects in the scene, same world rotation/scale as obj, origin at each half's centre) or null if the plane misses
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
  for (const k of kids) {
    let big = false; k.traverse(m => { if (m.isMesh && !m.isSkinnedMesh && m.geometry.attributes.position.count > BIG) { big = true; bigMeshes.push(m); } });
    if (!big) { const c = k.getWorldPosition(V()).applyMatrix4(rootInv); sides[planeL.distanceToPoint(c) >= 0 ? 0 : 1].decor.push(k); }
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
      const mesh = new THREE.Mesh(geo, mats.length > 1 ? mats : mats[0]); mesh.castShadow = true; mesh.receiveShadow = true; sides[s].meshes.push(mesh);
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
    // cap: fan around the centre of the cut points, flat on the plane
    const capN = s === 0 ? n.clone().negate() : n.clone();
    let capC = null;
    if (S.cut.length >= 6) {
      const c = V(); S.cut.forEach(q => c.add(q)); c.divideScalar(S.cut.length);
      const u = Math.abs(capN.x) < 0.9 ? V().set(1, 0, 0) : V().set(0, 1, 0); u.sub(capN.clone().multiplyScalar(u.dot(capN))).normalize(); const w = capN.clone().cross(u);
      const pts = S.cut.map(q => { const r = q.clone().sub(c); return { q, a: Math.atan2(r.dot(w), r.dot(u)), x: r.dot(u), y: r.dot(w) }; }).sort((A, B) => A.a - B.a);
      let R = 0.01; pts.forEach(o => { R = Math.max(R, Math.hypot(o.x, o.y)); });
      const pos = [], nor = [], uv = [];
      for (let i = 0; i < pts.length; i++) { const A = pts[i], B = pts[(i + 1) % pts.length];
        for (const [P3, X, Y] of [[c, 0, 0], [A.q, A.x, A.y], [B.q, B.x, B.y]]) { const q = P3.clone().sub(center).addScaledVector(capN, 0.0015); pos.push(q.x, q.y, q.z); nor.push(capN.x, capN.y, capN.z); uv.push(0.5 + X / (2.1 * R), 0.5 + Y / (2.1 * R)); } }
      const cg = new THREE.BufferGeometry(); cg.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); cg.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3)); cg.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
      const cm = new THREE.Mesh(cg, capMat); root.add(cm); capC = c.clone().sub(center);
    }
    S.decor.forEach(k => root.attach(k));
    const lb = box.clone().translate(center.clone().negate());
    root.userData = { lb: [lb.min.toArray(), lb.max.toArray()], capLocal: capC, capDir: capN.clone(), sliced: true, size: box.getSize(V()).length() };
    res.push(root);
  }
  obj.parent.remove(obj);
  return { a: res[0], b: res[1], normal: planeW.normal.clone() };
}
