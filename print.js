// 3D printing: which surfaces need support when the part lies on the bed in a given orientation.
// Rule of thumb every slicer uses: a surface leaning more than 45° from upright prints in thin air.
import { Matrix4, Quaternion, Vector3 } from './vendor/three.module.js';

// Rotation that lays the face with outward normal n flat on the bed (n pointing straight down).
export const placeOn = n => new Matrix4().makeRotationFromQuaternion(
  new Quaternion().setFromUnitVectors(new Vector3(...n).normalize(), new Vector3(0, 0, -1)));

// A face overhangs when its normal is within 45° of straight down; 1° of slack lets an exact 45° slope pass.
const LIMIT = -Math.cos(44 * Math.PI / 180);

// Overhanging triangles of a mesh (cad.meshOf(body).faces) after rotation `rot`: their vertex indices
// (flat, 3 per triangle) and total area in mm². Triangles lying on the bed are fine.
export function overhangs({ vertices, normals, triangles }, rot = new Matrix4()) {
  const v = new Vector3(), z = [];
  let bed = Infinity;
  for (let i = 0; i < vertices.length; i += 3) {
    z.push(v.set(vertices[i], vertices[i + 1], vertices[i + 2]).applyMatrix4(rot).z);
    bed = Math.min(bed, z.at(-1));
  }
  const nrm = i => new Vector3(normals[3 * i], normals[3 * i + 1], normals[3 * i + 2]);
  const pos = i => new Vector3(vertices[3 * i], vertices[3 * i + 1], vertices[3 * i + 2]);
  const tris = [];
  let area = 0;
  for (let t = 0; t < triangles.length; t += 3) {
    const [a, b, c] = [triangles[t], triangles[t + 1], triangles[t + 2]];
    const n = nrm(a).add(nrm(b)).add(nrm(c)).normalize().transformDirection(rot);
    if (n.z >= LIMIT || Math.max(z[a], z[b], z[c]) < bed + 0.01) continue;
    tris.push(a, b, c);
    area += pos(b).sub(pos(a)).cross(pos(c).sub(pos(a))).length() / 2;
  }
  return { tris, area, bed };
}

// Full print placement: lay the face with normal n (or keep as designed) on the bed, centered on the
// origin, resting on z = 0. Used for both the print check view and the overhang count.
export function printMatrix({ vertices }, n) {
  const rot = n ? placeOn(n) : new Matrix4(), v = new Vector3();
  const min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < vertices.length; i += 3) {
    v.set(vertices[i], vertices[i + 1], vertices[i + 2]).applyMatrix4(rot);
    v.toArray().forEach((x, k) => { min[k] = Math.min(min[k], x); max[k] = Math.max(max[k], x); });
  }
  return new Matrix4().makeTranslation(-(min[0] + max[0]) / 2, -(min[1] + max[1]) / 2, -min[2]).multiply(rot);
}
