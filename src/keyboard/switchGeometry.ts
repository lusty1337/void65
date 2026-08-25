import * as THREE from 'three';
import { toCreasedNormals } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

// геометрия механического переключателя MX-стандарта. размеры заданы
// в миллиметрах и переводятся в юниты один раз, чтобы их можно было сверять
// с даташитом, не пересчитывая в уме: 1 юнит = шаг клавиши 19.05 мм.
//
// у стопки боксов не читалось ровно то, по чему переключатель узнают:
// крестовой шток, юбка на пластине и сужающийся кверху прозрачный колпак
// с пружиной внутри

const MM = 1 / 19.05;

export const SW = {
  /** корпус, входящий в отверстие пластины: стандартные 14 мм */
  body: 13.98,
  /** юбка, которой свитч ложится на пластину. на 15.6 вылет выходил 0.8 мм,
      и при матовом нейлоне юбка читалась отдельной панелью рядом со свитчем:
      сбоку она не получает света вообще */
  flange: 15.1,
  flangeH: 1.0,
  /** высота конуса от корпуса к юбке: на жёстком уступе у юбки оставалась
      неосвещённая изнанка */
  flangeTaper: 1.4,
  /** от платы до юбки */
  bottomH: 5.0,
  /** верхний корпус сужается кверху: это его главный силуэт */
  topBase: 13.9,
  topTip: 10.5,
  topH: 6.6,
  /** толщина стенки колпака: сквозь неё видно пружину */
  wall: 1.1,
  /** фаска по верхней кромке колпака: на ней сидит блик, и по ней видно,
      где наклонная грань сменяется плоской верхушкой */
  topChamfer: 0.42,
  /** толщина стенки нижнего корпуса и высота его внутреннего дна */
  bottomWall: 1.2,
  /** центральный штырь: на него надета пружина */
  poleD: 3.6,
  poleH: 4.6,
  /** проём в верхней грани, через который ходит шток */
  opening: 7.0,
  /** крест штока: габарит 4.1 мм, планка 1.35 */
  cross: 4.1,
  crossArm: 1.35,
  /** насколько шток торчит над колпаком */
  stemUp: 3.6,
  /** тело штока внутри корпуса */
  stemBody: 6.6,
  corner: 0.45,
  /** штырь снизу: им свитч ловит отверстие платы */
  postD: 3.9,
  postH: 3.2,
  /** пластиковые ножки-фиксаторы по бокам от штыря */
  legD: 1.7,
  legH: 3.0,
  legOffset: 5.0,
  /** металлические контакты: плоские, уходят в плату */
  pinW: 0.9,
  pinT: 0.32,
  pinH: 3.4,
};

/** полная высота от платы до макушки штока, в юнитах */
export const SWITCH_HEIGHT = (SW.bottomH + SW.topH) * MM;
export const SWITCH_STEM_TOP = (SW.bottomH + SW.topH + SW.stemUp) * MM;

type Pt = { x: number; z: number };

// контур скруглённого квадрата с детерминированным числом точек: прямые
// грани двумя точками, углы дугами. счёт одинаков при любом размере,
// поэтому кольца стыкуются индекс в индекс
function contour(size: number, r: number, seg: number): Pt[] {
  const h = size / 2;
  const rr = Math.max(0.01, Math.min(r, h - 0.01));
  const pts: Pt[] = [];
  const arc = (cx: number, cz: number, from: number, to: number) => {
    for (let i = 1; i <= seg; i++) {
      const a = from + ((to - from) * i) / seg;
      pts.push({ x: cx + Math.cos(a) * rr, z: cz + Math.sin(a) * rr });
    }
  };
  const Q = Math.PI / 2;
  pts.push({ x: -h + rr, z: -h });
  pts.push({ x: h - rr, z: -h });
  arc(h - rr, -h + rr, -Q, 0);
  pts.push({ x: h, z: h - rr });
  arc(h - rr, h - rr, 0, Q);
  pts.push({ x: -h + rr, z: h });
  arc(-h + rr, h - rr, Q, Math.PI);
  pts.push({ x: -h, z: -h + rr });
  arc(-h + rr, -h + rr, Math.PI, Math.PI * 1.5);
  pts.pop(); // последняя точка дуги совпадает со стартовой
  return pts;
}

type Ring = { size: number; y: number; r?: number };

/** протягивает оболочку по кольцам; одинаковое число точек в них
 *  обеспечивает contour */
function sweep(rings: Ring[], seg: number, corner: number) {
  const positions: number[] = [];
  const indices: number[] = [];
  let count = 0;

  const starts = rings.map((ring) => {
    const start = positions.length / 3;
    const pts = contour(ring.size, ring.r ?? corner, seg);
    count = pts.length;
    // contour работает в XZ и про высоту ничего не знает, Y берём у кольца
    for (const p of pts) positions.push(p.x * MM, ring.y * MM, p.z * MM);
    return start;
  });

  for (let k = 0; k < starts.length - 1; k++) {
    const a = starts[k];
    const b = starts[k + 1];
    for (let i = 0; i < count; i++) {
      const j = (i + 1) % count;
      indices.push(a + i, a + j, b + j, a + i, b + j, b + i);
    }
  }
  return { positions, indices, count, starts };
}

// нормали с порогом излома, а не обычным усреднением: обычное размазывает
// нормаль плоской грани у краёв, и на прозрачном колпаке четыре наклонные
// плоскости сливаются в однородный купол
const CREASE = (Math.PI / 180) * 26;

function finish(positions: number[], indices: number[]) {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  g.setIndex(indices);
  g.computeVertexNormals();
  return toCreasedNormals(g, CREASE);
}

// нижний корпус: нейлоновая коробка с юбкой. юбка шире отверстия пластины,
// на неё свитч и садится - на собранной клавиатуре её видно тонким пояском
// между пластиной и колпаком
export function buildSwitchBottom(seg = 4) {
  // проём равен внутренней полости колпака, а не размеру штока. по штоку
  // верхняя площадка шла от юбки в 15.1 мм до 8.2 - плоский поясок в три
  // с половиной миллиметра по периметру. снаружи он прикрыт колпаком, но
  // колпак прозрачный: преломление растягивало поясок, и он читался
  // четырьмя панелями, торчащими шире самой юбки
  const mouth = SW.topBase - SW.wall * 2;
  const { positions, indices, count } = sweep(
    [
      // наружная стенка снизу вверх, с юбкой
      { size: SW.body, y: 0 },
      { size: SW.body, y: SW.bottomH - SW.flangeH - SW.flangeTaper },
      // конус, а не уступ: юбка вырастает из корпуса, а не приклеена
      { size: SW.flange, y: SW.bottomH - SW.flangeH },
      { size: SW.flange, y: SW.bottomH },
      // от юбки сразу к проёму, без промежуточной площадки
      { size: mouth, y: SW.bottomH, r: 0.3 },
      // внутренняя стенка вниз, до внутреннего дна
      { size: mouth, y: SW.bottomWall, r: 0.3 },
    ],
    seg,
    SW.corner,
  );

  // дно дублирует кольцо, а не берёт вершины стенки: общие вершины дают
  // усреднение нормали дна с нормалью боковины, и по плоскому дну расходится
  // веер граней от центра
  const cap = (size: number, y: number, up: boolean, r = SW.corner) => {
    const rim = positions.length / 3;
    for (const pt of contour(size, r, seg)) {
      positions.push(pt.x * MM, y * MM, pt.z * MM);
    }
    const centre = positions.length / 3;
    positions.push(0, y * MM, 0);
    for (let i = 0; i < count; i++) {
      const j = (i + 1) % count;
      if (up) indices.push(centre, rim + j, rim + i);
      else indices.push(centre, rim + i, rim + j);
    }
  };

  cap(SW.body, 0, false); // наружное дно смотрит вниз, в плату
  // внутреннее смотрит вверх: без него сквозь колпак видна изнанка, а она
  // из задних граней и отсекается
  cap(mouth, SW.bottomWall, true, 0.3);

  return finish(positions, indices);
}

/** штырь внутри корпуса, на него надета пружина */
export function buildSwitchPole() {
  const g = new THREE.CylinderGeometry(
    (SW.poleD / 2) * MM,
    (SW.poleD / 2) * MM,
    SW.poleH * MM,
    14,
  );
  g.translate(0, (SW.bottomWall + SW.poleH / 2) * MM, 0);
  return g;
}

// прозрачный колпак оболочкой, а не сплошным телом: сквозь монолит
// с transmission свет идёт как через кусок стекла, и внутренности
// не читаются
export function buildSwitchTop(seg = 4) {
  const inner = SW.wall * 2;
  const ch = SW.topChamfer;
  const { positions, indices } = sweep(
    [
      // наклонная грань снизу вверх, не до самого верха, а до фаски
      { size: SW.topBase, y: 0 },
      { size: SW.topTip + ch * 2, y: SW.topH - ch },
      // без фаски наклонная грань упирается в плоскую верхушку под прямым
      // углом, и стык не ловит свет вовсе
      { size: SW.topTip, y: SW.topH },
      // верхняя грань до проёма под шток
      { size: SW.opening, y: SW.topH, r: 0.3 },
      // внутренняя стенка вниз
      { size: SW.opening, y: SW.topH - SW.wall, r: 0.3 },
      { size: SW.topBase - inner, y: 0 },
    ],
    seg,
    SW.corner,
  );
  return finish(positions, indices);
}

// шток с крестом. крест строим профилем, а не двумя пересекающимися
// коробками: у коробок на стыке остаётся видимый шов
export function buildSwitchStem() {
  const a = SW.cross / 2;
  const t = SW.crossArm / 2;
  const plus = new THREE.Shape();
  const p: [number, number][] = [
    [t, t], [t, a], [-t, a], [-t, t],
    [-a, t], [-a, -t], [-t, -t], [-t, -a],
    [t, -a], [t, -t], [a, -t], [a, t],
  ];
  plus.moveTo(p[0][0] * MM, p[0][1] * MM);
  for (let i = 1; i < p.length; i++) plus.lineTo(p[i][0] * MM, p[i][1] * MM);
  plus.closePath();

  const cross = new THREE.ExtrudeGeometry(plus, {
    depth: (SW.stemUp + SW.wall * 1.5) * MM,
    bevelEnabled: true,
    bevelThickness: 0.12 * MM,
    bevelSize: 0.1 * MM,
    bevelSegments: 1,
  });
  cross.rotateX(-Math.PI / 2);
  // крест растёт вниз от макушки: так его удобно сажать по верху колпака
  cross.translate(0, -(SW.stemUp + SW.wall * 1.5) * MM, 0);

  // тело штока внутри корпуса: его видно сквозь стенки колпака
  const body = new THREE.BoxGeometry(SW.stemBody * MM, SW.topH * 0.62 * MM, SW.stemBody * MM);
  body.translate(0, -(SW.stemUp + SW.topH * 0.36) * MM, 0);

  const merged = mergeGeometries([cross, body]);
  merged.computeVertexNormals();
  return merged;
}

// низ свитча: штырь, две пластиковые ножки и два контакта. в собранном виде
// их не видно вовсе, но разборка - половина сюжета, и свитч без ножек
// читается там обрубком
export function buildSwitchPins() {
  const post = new THREE.CylinderGeometry(
    (SW.postD / 2) * MM,
    (SW.postD / 2) * MM,
    SW.postH * MM,
    16,
  );
  post.translate(0, (-SW.postH / 2) * MM, 0);

  const legs = [-1, 1].map((sign) => {
    const g = new THREE.CylinderGeometry(
      (SW.legD / 2) * MM,
      (SW.legD / 2) * MM,
      SW.legH * MM,
      10,
    );
    g.translate(sign * SW.legOffset * MM, (-SW.legH / 2) * MM, 0);
    return g;
  });

  return { plastic: mergeGeometries([post, ...legs]) };
}

/** контакты отдельно: у них металлический материал */
export function buildSwitchContacts() {
  const pins = [
    [-2.9, -4.1],
    [1.7, -2.5],
  ].map(([x, z]) => {
    const g = new THREE.BoxGeometry(SW.pinW * MM, SW.pinH * MM, SW.pinT * MM);
    g.translate(x * MM, (-SW.pinH / 2) * MM, z * MM);
    return g;
  });
  return mergeGeometries(pins);
}

/** пружина: спираль вокруг центрального штыря, видна сквозь колпак */
export function buildSwitchSpring() {
  const turns = 5.5;
  const radius = 2.4 * MM;
  const height = SW.topH * 0.78 * MM;
  const pts: THREE.Vector3[] = [];
  const steps = 64;
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const a = t * Math.PI * 2 * turns;
    pts.push(new THREE.Vector3(Math.cos(a) * radius, t * height, Math.sin(a) * radius));
  }
  const curve = new THREE.CatmullRomCurve3(pts);
  return new THREE.TubeGeometry(curve, steps, 0.32 * MM, 5, false);
}

/** склейка геометрий в одну: нужна штоку, это крест плюс тело */
function mergeGeometries(list: THREE.BufferGeometry[]) {
  const positions: number[] = [];
  const indices: number[] = [];
  for (const g of list) {
    const offset = positions.length / 3;
    const pos = g.attributes.position;
    for (let i = 0; i < pos.count; i++) positions.push(pos.getX(i), pos.getY(i), pos.getZ(i));
    const idx = g.index;
    if (idx) {
      for (let i = 0; i < idx.count; i++) indices.push(idx.getX(i) + offset);
    } else {
      for (let i = 0; i < pos.count; i++) indices.push(i + offset);
    }
    g.dispose();
  }
  return finish(positions, indices);
}
