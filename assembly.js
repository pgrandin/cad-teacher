// Assemblies: components placed by joints, like Fusion. A joint snaps a hole rim on the moving part
// onto a hole rim on the part it attaches to: centers meet, the two faces touch (normals opposite),
// and a revolute joint turns around the hole axis by `angle` degrees.
import { Matrix4, Vector3 } from './vendor/three.module.js';

// Frame on a rim: origin at the center, z along the face normal (flipped for the moving side).
// x is "up" on side faces, so at angle 0 a part hung on a side hole stands straight up (robot home pose).
function frame({ c, n }, flip = false) {
  const z = new Vector3(...n);
  if (flip) z.negate();
  const x = Math.abs(z.z) > 0.9 ? new Vector3(1, 0, 0) : new Vector3(0, 0, 1).addScaledVector(z, -z.z).normalize();
  return new Matrix4().makeBasis(x, z.clone().cross(x), z).setPosition(...c);
}
const place = (parent, parentRim, childRim, deg) =>
  parent.clone().multiply(frame(parentRim)).multiply(new Matrix4().makeRotationZ(deg * Math.PI / 180)).multiply(frame(childRim, true).invert());

// Grounded components stay at `at`; each joint places whichever of its two components is still loose.
// Loose components without joints also sit at `at`. Returns world matrices and per-joint error keys.
export function poses(components, joints) {
  const T = new Map(), errors = {};
  for (const c of components) if (c.grounded) T.set(c.id, new Matrix4().makeTranslation(...(c.at || [0, 0, 0])));
  let todo = joints.filter(j => {
    if (!j.moving || !j.fixed) errors[j.id] = 'err.jointPick';
    else if (j.moving.comp === j.fixed.comp) errors[j.id] = 'err.jointSamePart';
    return !errors[j.id];
  });
  for (let placed = true; placed;) {
    placed = false;
    todo = todo.filter(j => {
      const { moving: m, fixed: f } = j, angle = j.angle || 0;
      if (T.has(f.comp) && T.has(m.comp)) return true; // decided after the loop
      if (T.has(f.comp)) T.set(m.comp, place(T.get(f.comp), f.rim, m.rim, angle));
      else if (T.has(m.comp)) T.set(f.comp, place(T.get(m.comp), m.rim, f.rim, -angle));
      else return true;
      placed = true;
      return false;
    });
  }
  for (const j of todo) errors[j.id] = T.has(j.moving.comp) && T.has(j.fixed.comp) ? 'err.jointPlaced' : 'err.jointLoose';
  for (const c of components) if (!T.has(c.id)) T.set(c.id, new Matrix4().makeTranslation(...(c.at || [0, 0, 0])));
  return { T, errors };
}
