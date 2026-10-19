import { Vector3 } from './vendor/three.module.js';

// One target for each of the six faces, twelve edges and eight corners.
export const CUBE_VIEWS = [];
for (let x = -1; x <= 1; x++) for (let y = -1; y <= 1; y++) for (let z = -1; z <= 1; z++) {
  const direction = [x, y, z], axes = direction.flatMap((v, i) => v ? [i] : []);
  if (!axes.length) continue;
  const kind = ['face', 'edge', 'corner'][axes.length - 1];
  const free = [0, 1, 2].filter(i => !direction[i]);
  const points = (kind === 'face' ? [[-1, -1], [1, -1], [1, 1], [-1, 1]] : kind === 'edge' ? [[-1], [1]] : [[]])
    .map(values => direction.map((v, i) => v || values[free.indexOf(i)]));
  const names = axes.map(i => [['left', 'right'], ['front', 'back'], ['bottom', 'top']][i][direction[i] > 0 ? 1 : 0]);
  CUBE_VIEWS.push({ direction, kind, points, names });
}
CUBE_VIEWS.sort((a, b) => a.names.length - b.names.length);

export function createViewCube(svg, align, t) {
  const ns = 'http://www.w3.org/2000/svg';
  const node = (tag, attrs = {}) => {
    const el = document.createElementNS(ns, tag);
    for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v);
    return el;
  };
  const targets = CUBE_VIEWS.map(def => {
    const group = node('g', { role: 'button', 'data-direction': def.direction.join(','), class: `cube-${def.kind}` });
    const shape = node(def.kind === 'face' ? 'polygon' : def.kind === 'edge' ? 'line' : 'circle', { r: 6 });
    group.append(shape);
    const text = def.kind === 'face' ? node('text', { 'text-anchor': 'middle', dy: '.35em' }) : null;
    if (text) group.append(text);
    const title = node('title');
    group.append(title);
    const activate = () => { if (group.getAttribute('aria-disabled') !== 'true') align(def.direction); };
    group.addEventListener('click', activate);
    group.addEventListener('keydown', e => {
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); activate(); }
    });
    svg.append(group);
    return { def, group, shape, text, title };
  });
  const labels = ['X', 'Y', 'Z'].map((name, i) => {
    const el = node('text', { fill: ['#c62828', '#238331', '#1565c0'][i], 'text-anchor': 'middle', 'aria-hidden': 'true' });
    el.textContent = name;
    svg.append(el);
    return el;
  });
  return (camera, disabled = false) => {
    svg.setAttribute('aria-label', t('view.cube'));
    const inverse = camera.quaternion.clone().invert();
    const eye = new Vector3(0, 0, 1).applyQuaternion(camera.quaternion).toArray();
    const project = p => {
      const v = new Vector3(...p).applyQuaternion(inverse);
      return [80 + v.x * 29, 76 - v.y * 29];
    };
    for (const { def, group, shape, text, title } of targets) {
      const visible = def.direction.some((v, i) => v * eye[i] > 0.001);
      group.style.display = visible ? '' : 'none';
      group.setAttribute('tabindex', visible && !disabled ? '0' : '-1');
      group.setAttribute('aria-disabled', String(disabled));
      const name = def.names.map(n => t(`view.${n}`)).join(' / ');
      const label = disabled ? t('timeline.finishFirst') : t('view.align', { name });
      group.setAttribute('aria-label', label);
      title.textContent = label;
      const pts = def.points.map(project);
      if (def.kind === 'face') {
        shape.setAttribute('points', pts.map(p => p.join(',')).join(' '));
        const [x, y] = project(def.direction);
        text.setAttribute('x', x);
        text.setAttribute('y', y);
        text.textContent = name;
      } else if (def.kind === 'edge') {
        ['x1', 'y1', 'x2', 'y2'].forEach((k, i) => shape.setAttribute(k, pts.flat()[i]));
      } else {
        shape.setAttribute('cx', pts[0][0]);
        shape.setAttribute('cy', pts[0][1]);
      }
    }
    labels.forEach((el, i) => {
      const [x, y] = project([0, 0, 0].map((_, j) => i === j ? 2.15 : 0));
      el.setAttribute('x', x);
      el.setAttribute('y', y + 4);
    });
  };
}
