import * as THREE from 'three';
import { roundedRectShape } from './geometry';
import { BOARD_WIDTH, BOARD_DEPTH } from './layout';

// корпус собирается кольцами контура снизу вверх, тем же приёмом, что
// и колпачки: только так задаётся переменный силуэт - фаска снизу, прямой
// борт, фаска сверху и клин по глубине. у ExtrudeGeometry фаска одинаковая
// по всему периметру, а высота постоянная

export type CaseParams = {
  width: number;
  depth: number;
  /** высота переднего торца - того, что ближе к пользователю (+z) */
  frontHeight: number;
  /** высота заднего торца (−z): корпус идёт клином */
  backHeight: number;
  /** радиус скругления углов в плане */
  corner: number;
  /** толщина борта: расстояние от наружной стенки до края лотка */
  wall: number;
  /** высота дна лотка от низа корпуса */
  trayFloor: number;
  /** ширина верхней фаски: на ней сидит блик от контрового */
  topChamfer: number;
  bottomChamfer: number;
  /** высота шва между половинами корпуса: горизонтальный, не по клину */
  seamY: number;
  /** насколько шов утоплен в стенку */
  seamDepth: number;
  /** высота канавки шва */
  seamHeight: number;
  /** фаска на входе и выходе канавки: срезает прямой угол в наклонную грань */
  seamLip: number;
  /** ширина выреза под USB-C в задней стенке */
  usbWidth: number;
  /** низ и верх выреза, от низа корпуса */
  usbBottom: number;
  usbTop: number;
  /** сегментов на скругление угла: глаже, но дороже меш */
  segments: number;
};

// зазор между краем раскладки и стенкой лотка: 0.6 мм, вместе с половиной
// междуклавишного даёт около миллиметра от колпачка до борта, как
// на настоящей клавиатуре. на 0.1 щель выходила 2.5 мм, и колпачки
// выглядели мелкими для своего корпуса
const TRAY_MARGIN = 0.03;
// борт 5 мм: восьми у фрезерованных корпусов не бывает, они и так тяжёлые
const WALL = 0.26;

// габарит считаем от раскладки, а не подбираем: при 16.6 в ширину лоток
// выходил уже 16 юнитов самой раскладки, и клавиши не влезали
export const CASE_OUTER_WIDTH = BOARD_WIDTH + TRAY_MARGIN * 2 + WALL * 2;
export const CASE_OUTER_DEPTH = BOARD_DEPTH + TRAY_MARGIN * 2 + WALL * 2;

// габарит лотка - единственный источник правды для всего, что в него
// ложится. считать отдельно нельзя: корпус уже раз разъехался с раскладкой
// именно потому, что размеры подбирались независимо
export const TRAY_WIDTH = BOARD_WIDTH + TRAY_MARGIN * 2;
export const TRAY_DEPTH = BOARD_DEPTH + TRAY_MARGIN * 2;
export const TRAY_FLOOR_Y = 0.3;

// скругление лотка задаём отдельно, а не как "наружное минус борт": при
// борте 0.42 и наружном радиусе 0.34 выходил отрицательный, то есть острый
// угол. у фрезерованного кармана острых углов не бывает, там радиус фрезы
export const TRAY_CORNER = 0.16;

// габарит обоймы USB-C и зазор вокруг неё. живёт здесь, а не в слое платы:
// вырез в корпусе и сам разъём обязаны считаться от одного числа -
// разъехавшись, они дают либо щель в нутро корпуса, либо обойму,
// упирающуюся в стенку
export const USB = {
  shellW: 0.472, // 9.0 мм
  shellH: 0.168, // 3.2 мм
  /** зазор между обоймой и краем выреза: на живой клавиатуре его почти нет */
  fit: 0.012,
};

// высоты в юнитах, 1 юнит = шаг клавиши 19.05 мм. на 0.62/0.86 корпус
// выходил 12-16 мм, вдвое ниже настоящего, и клавиатура читалась поддоном:
// у живого high-profile это 20 мм у переднего торца и 30 у заднего
export const CASE_DEFAULTS: CaseParams = {
  width: CASE_OUTER_WIDTH,
  depth: CASE_OUTER_DEPTH,
  // верхняя кромка почти вровень: с задним торцом выше колпачков клавиатура
  // читалась корытом, клавиши тонули в бортах. клин остался, но ушёл
  // в нижний профиль
  frontHeight: 0.95,
  backHeight: 1.12,
  corner: 0.34,
  wall: WALL,
  trayFloor: TRAY_FLOOR_Y,
  topChamfer: 0.14,
  bottomChamfer: 0.08,
  // шов в нижней трети: на 0.44 он проходил ровно через вырез под USB,
  // и канавку пришлось бы вести в обход разъёма
  seamY: 0.24,
  seamDepth: 0.022,
  seamHeight: 0.05,
  seamLip: 0.026,
  // с запасом вокруг обоймы разъёма
  usbWidth: 0.54,
  usbBottom: 0.33,
  usbTop: 0.56,
  segments: 12,
};

type Pt = { x: number; y: number };

// контур в плане с полным контролем над расстановкой точек. у Shape.getPoints
// на прямых участках их выходило с десяток на шестнадцать юнитов, и вырезать
// дырку в полсантиметра было не из чего. здесь прямые задаются двумя точками,
// скругления дугами, а на задней грани добавляется пара точек по краям выреза
// под разъём. точек поровну при любом отступе, поэтому кольца стыкуются
// индекс в индекс
function outline(w: number, d: number, r: number, seg: number, usbHalf: number) {
  const hw = w / 2;
  const hd = d / 2;
  const rr = Math.max(0.02, Math.min(r, hw - 0.01, hd - 0.01));
  const pts: Pt[] = [];

  const arc = (cx: number, cy: number, from: number, to: number) => {
    // первую точку дуги пропускаем: она совпадает с концом прямого участка
    for (let i = 1; i <= seg; i++) {
      const a = from + ((to - from) * i) / seg;
      pts.push({ x: cx + Math.cos(a) * rr, y: cy + Math.sin(a) * rr });
    }
  };

  const HALF_PI = Math.PI / 2;

  // передняя грань слева направо: в мировых это +z, ближе к нам
  pts.push({ x: -hw + rr, y: -hd });
  pts.push({ x: hw - rr, y: -hd });
  arc(hw - rr, -hd + rr, -HALF_PI, 0);

  // правая грань
  pts.push({ x: hw, y: hd - rr });
  arc(hw - rr, hd - rr, 0, HALF_PI);

  // задняя грань справа налево, с разрывом под разъём
  pts.push({ x: hw - rr, y: hd });
  const beforeHole = pts.length - 1;
  pts.push({ x: usbHalf, y: hd });
  pts.push({ x: -usbHalf, y: hd });
  pts.push({ x: -hw + rr, y: hd });
  arc(-hw + rr, hd - rr, HALF_PI, Math.PI);

  // левая грань
  pts.push({ x: -hw, y: -hd + rr });
  arc(-hw + rr, -hd + rr, Math.PI, Math.PI * 1.5);
  pts.pop(); // последняя точка дуги совпадает со стартовой

  // сегмент выреза - между двумя вставленными точками
  return { pts, holeSeg: beforeHole + 1 };
}

export function buildCase(p: CaseParams = CASE_DEFAULTS) {
  const positions: number[] = [];
  const indices: number[] = [];
  const usbHalf = p.usbWidth / 2;

  // высота верхней грани зависит от глубины: зад выше переда, корпус клином.
  // z приходит в мировых, где −depth/2 это зад
  const topAt = (z: number) =>
    p.backHeight + (p.frontHeight - p.backHeight) * ((z + p.depth / 2) / p.depth);

  // уровень стенки: отступ внутрь плюс способ задать высоту. 'bottom' -
  // абсолютная от низа, 'top' - вычитается из верхней грани
  type Level = { inset: number; from: 'bottom' | 'top'; y: number };

  const ref = outline(p.width, p.depth, p.corner, p.segments, usbHalf);
  const ringSize = ref.pts.length;
  const holeSeg = ref.holeSeg;

  const addRing = (level: Level, w: number, d: number, r: number) => {
    const start = positions.length / 3;
    for (const pt of outline(w, d, r, p.segments, usbHalf).pts) {
      const x = pt.x;
      const z = -pt.y; // контур лежит в XY, разворачиваем его в плоскость XZ
      const y = level.from === 'bottom' ? level.y : topAt(z) - level.y;
      positions.push(x, y, z);
    }
    return start;
  };

  const ringAt = (level: Level, cornerOverride?: number) =>
    addRing(
      level,
      p.width - level.inset * 2,
      p.depth - level.inset * 2,
      cornerOverride ?? p.corner - level.inset,
    );

  /** мост между кольцами; skipHole выбрасывает сегмент, попавший в вырез */
  const bridge = (a: number, b: number, skipHole = false) => {
    for (let i = 0; i < ringSize; i++) {
      if (skipHole && i === holeSeg) continue;
      const j = (i + 1) % ringSize;
      indices.push(a + i, a + j, b + j, a + i, b + j, b + i);
    }
  };

  // наружная стенка снизу вверх. нижняя фаска не даёт корпусу приклеиться
  // к столу острым углом, на верхней сидит блик, а посередине канавка шва:
  // корпус фрезеруют двумя половинами, и стык - самый узнаваемый признак
  // ЧПУ. канавка с фасками на входе и выходе, а не прямым углом: прямой
  // означал две грани нулевой высоты, тоньше пикселя при любом сглаживании,
  // и полоса рассыпалась в пунктир
  const half = p.seamHeight / 2;
  const outer = [
    ringAt({ inset: p.bottomChamfer, from: 'bottom', y: 0 }),
    ringAt({ inset: 0, from: 'bottom', y: p.bottomChamfer }),
    ringAt({ inset: 0, from: 'bottom', y: p.seamY - half - p.seamLip }),
    ringAt({ inset: p.seamDepth, from: 'bottom', y: p.seamY - half }),
    ringAt({ inset: p.seamDepth, from: 'bottom', y: p.seamY + half }),
    ringAt({ inset: 0, from: 'bottom', y: p.seamY + half + p.seamLip }),
    ringAt({ inset: 0, from: 'bottom', y: p.usbBottom }),
    ringAt({ inset: 0, from: 'bottom', y: p.usbTop }),
    ringAt({ inset: 0, from: 'top', y: p.topChamfer }),
    ringAt({ inset: p.topChamfer, from: 'top', y: 0 }),
  ];
  // вырез живёт ровно в одном пролёте стенки - между кольцами на высоте
  // низа и верха разъёма
  const USB_LO = 6;
  for (let i = 0; i < outer.length - 1; i++) {
    bridge(outer[i], outer[i + 1], i === USB_LO);
  }

  // верхняя площадка борта: кольцо от наружной фаски до края лотка
  const trayInset = p.wall;
  const rimInner = ringAt({ inset: trayInset, from: 'top', y: 0 }, TRAY_CORNER);
  bridge(outer[outer.length - 1], rimInner);

  // внутренняя стенка лотка вниз до дна. навивку НЕ разворачиваем: мост тут
  // идёт сверху вниз, а не снизу вверх, как у наружной стенки, и одно это
  // уже переворачивает обход - нормали смотрят внутрь лотка. лишний разворот
  // делал их задними, и сквозь стенки просвечивала сцена
  const innerTop = ringAt({ inset: trayInset, from: 'bottom', y: p.usbTop }, TRAY_CORNER);
  const innerLo = ringAt({ inset: trayInset, from: 'bottom', y: p.usbBottom }, TRAY_CORNER);
  const trayBottom = ringAt({ inset: trayInset, from: 'bottom', y: p.trayFloor }, TRAY_CORNER);
  bridge(rimInner, innerTop);
  bridge(innerTop, innerLo, true);
  bridge(innerLo, trayBottom);

  // окантовка выреза. прямоугольная дырка под разъём формы "стадион"
  // оставляла по углам четыре тёмных треугольника, а сквозь них было видно
  // нутро корпуса - поэтому выброшенный прямоугольник закрывается пластиной
  // с проёмом ровно по обойме, снаружи и изнутри, а между ними канал
  const portW = USB.shellW + USB.fit * 2;
  const portH = USB.shellH + USB.fit * 2;
  const zOuter = -p.depth / 2;
  const zInner = -p.depth / 2 + p.wall;
  const midY = (p.usbBottom + p.usbTop) / 2;

  const plateShape = new THREE.Shape();
  plateShape.moveTo(-usbHalf, p.usbBottom - midY);
  plateShape.lineTo(usbHalf, p.usbBottom - midY);
  plateShape.lineTo(usbHalf, p.usbTop - midY);
  plateShape.lineTo(-usbHalf, p.usbTop - midY);
  plateShape.closePath();
  plateShape.holes.push(roundedRectShape(portW, portH, portH / 2));

  const outerPlate = new THREE.ShapeGeometry(plateShape, 16);
  outerPlate.rotateY(Math.PI); // ShapeGeometry смотрит в +Z, наружу нужен −Z
  outerPlate.translate(0, midY, zOuter);

  const innerPlate = new THREE.ShapeGeometry(plateShape, 16);
  innerPlate.translate(0, midY, zInner);

  // канал между пластинами: та же форма на толщину борта
  const tunnel = buildPortTunnel(portW, portH, midY, zOuter, zInner);

  // дно лотка. ShapeGeometry смотрит нормалью в +Z, и поворот на −90° по X
  // переводит её в +Y: с +90° нормаль уходит вниз, грань отсекается как
  // задняя, и сквозь дыру видно сетку стенда
  const floorShape = roundedRectShape(
    p.width - trayInset * 2,
    p.depth - trayInset * 2,
    TRAY_CORNER,
  );
  const floor = new THREE.ShapeGeometry(floorShape, p.segments);
  floor.rotateX(-Math.PI / 2);
  floor.translate(0, p.trayFloor, 0);

  // дно корпуса
  const baseShape = roundedRectShape(
    p.width - p.bottomChamfer * 2,
    p.depth - p.bottomChamfer * 2,
    Math.max(0.02, p.corner - p.bottomChamfer),
  );
  const base = new THREE.ShapeGeometry(baseShape, p.segments);
  base.rotateX(Math.PI / 2); // дно смотрит вниз, в стол

  const shell = new THREE.BufferGeometry();
  shell.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  shell.setIndex(indices);

  return { shell, floor, base, outerPlate, innerPlate, tunnel };
}

// стенки канала под разъём: контур "стадиона" от наружной пластины
// к внутренней. без них дырка выглядит нарисованной на плоской стенке
function buildPortTunnel(w: number, h: number, midY: number, z0: number, z1: number) {
  const seg = 24;
  const r = h / 2;
  const flat = Math.max(0, w / 2 - r);
  const pts: { x: number; y: number }[] = [];
  for (let i = 0; i < seg; i++) {
    const a = (i / seg) * Math.PI * 2;
    // "стадион": полуокружности по торцам, сдвинутые на прямой участок
    const c = Math.cos(a);
    pts.push({ x: Math.sign(c) * flat + c * r, y: Math.sin(a) * r });
  }

  const positions: number[] = [];
  const indices: number[] = [];
  for (const z of [z0, z1]) {
    for (const pt of pts) positions.push(pt.x, midY + pt.y, z);
  }
  for (let i = 0; i < seg; i++) {
    const j = (i + 1) % seg;
    const a = i;
    const b = i + seg;
    const aj = j;
    const bj = j + seg;
    indices.push(a, b, bj, a, bj, aj);
  }

  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  g.setIndex(indices);
  g.computeVertexNormals();
  return g;
}
