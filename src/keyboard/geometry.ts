import * as THREE from 'three';
import { KEYS, stabHalfSpan } from './layout';

export function roundedRectShape(w: number, d: number, r: number): THREE.Shape {
  const shape = new THREE.Shape();
  const x = -w / 2;
  const y = -d / 2;
  shape.moveTo(x + r, y);
  shape.lineTo(x + w - r, y);
  shape.quadraticCurveTo(x + w, y, x + w, y + r);
  shape.lineTo(x + w, y + d - r);
  shape.quadraticCurveTo(x + w, y + d, x + w - r, y + d);
  shape.lineTo(x + r, y + d);
  shape.quadraticCurveTo(x, y + d, x, y + d - r);
  shape.lineTo(x, y + r);
  shape.quadraticCurveTo(x, y, x + r, y);
  return shape;
}

// прямоугольное отверстие: обход по часовой, навивка противоположна контуру
export function holePath(cx: number, cy: number, w: number, h: number, r = 0): THREE.Path {
  const p = new THREE.Path();
  if (r <= 0) {
    p.moveTo(cx - w / 2, cy - h / 2);
    p.lineTo(cx - w / 2, cy + h / 2);
    p.lineTo(cx + w / 2, cy + h / 2);
    p.lineTo(cx + w / 2, cy - h / 2);
    p.closePath();
    return p;
  }
  // скруглённый вырез для мягких материалов: силикон режут ножом или
  // штампом, и угол всегда сходит на радиус - по острым прокладка читалась
  // пластиком
  const x0 = cx - w / 2;
  const x1 = cx + w / 2;
  const y0 = cy - h / 2;
  const y1 = cy + h / 2;
  const rr = Math.min(r, w / 2, h / 2);
  p.moveTo(x0, y0 + rr);
  p.lineTo(x0, y1 - rr);
  p.quadraticCurveTo(x0, y1, x0 + rr, y1);
  p.lineTo(x1 - rr, y1);
  p.quadraticCurveTo(x1, y1, x1, y1 - rr);
  p.lineTo(x1, y0 + rr);
  p.quadraticCurveTo(x1, y0, x1 - rr, y0);
  p.lineTo(x0 + rr, y0);
  p.quadraticCurveTo(x0, y0, x0, y0 + rr);
  p.closePath();
  return p;
}

// лист с вырезами под свитчи, общий для пластины и пены. форма лежит в XY,
// а экструзия после поворота уходит в +Y - поэтому z клавиш попадает
// в форму со знаком минус
export function makeCutoutSheet(
  w: number,
  d: number,
  corner: number,
  thickness: number,
  holeSize: number,
  withStabHoles: boolean,
  /** радиус скругления вырезов: нужен мягким материалам, у стали он нулевой */
  holeRadius = 0,
): THREE.ExtrudeGeometry {
  const shape = roundedRectShape(w, d, corner);
  for (const key of KEYS) {
    shape.holes.push(holePath(key.x, -key.z, holeSize, holeSize, holeRadius));
    if (withStabHoles && key.stab) {
      // проём под врезной стабилизатор Cherry: 7 мм поперёк и 15.5 вдоль.
      // на 5.7 x 6.5 ножка не пролезала, и в разборке было видно, что она
      // проходит сквозь металл
      const half = stabHalfSpan(key.w);
      const sw = 7 / 19.05;
      const sd = 15.5 / 19.05;
      shape.holes.push(holePath(key.x - half, -key.z, sw, sd));
      shape.holes.push(holePath(key.x + half, -key.z, sw, sd));
    }
  }
  const geo = new THREE.ExtrudeGeometry(shape, {
    depth: thickness,
    bevelEnabled: false,
    curveSegments: 6,
  });
  geo.rotateX(-Math.PI / 2);
  geo.translate(0, -thickness / 2, 0);
  return geo;
}

// сужающийся к верху корпус, тот же приём, что у колпачков
export function makeTaperedBox(w: number, h: number, d: number, taper: number): THREE.BufferGeometry {
  const geo = new THREE.BoxGeometry(w, h, d);
  const pos = geo.attributes.position;
  for (let i = 0; i < pos.count; i++) {
    if (pos.getY(i) > 0) {
      pos.setX(i, pos.getX(i) * taper);
      pos.setZ(i, pos.getZ(i) * taper);
    }
  }
  geo.computeVertexNormals();
  return geo;
}
