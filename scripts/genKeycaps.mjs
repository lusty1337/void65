// генератор геометрии колпачков: по мешу на каждую пару "ряд × ширина".
// отдельные меши нужны, чтобы фаски не растягивались вместе с клавишей -
// у пробела в 6.25u при простом масштабировании скругления вшестеро шире
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ROWS, ROW_TILT, uniqueCombos, comboKey } from '../src/keyboard/layoutData.mjs';
import {
  CAP_HEIGHT,
  SOCKET_DEPTH,
  SOCKET_A,
  SOCKET_B,
  SOCKET_BAR,
} from '../src/keyboard/keycapSpec.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));

export { CAP_HEIGHT };
const N = 48; // точек по периметру кольца
// показатель суперэллипса: выше - прямоугольнее. на 6.2 шляпка скруглялась
// почти в подушку, а у литого PBT кромки заметно резче
const SE = 8.6;
const CORNER = 0.5; // полуразмер по Z, он же радиус скругления углов по короткой стороне

// профиль ряда: во сколько раз выше базовой высоты и насколько глубже
// блюдце. записей ровно столько, сколько рядов в раскладке. на прогибе
// в 0.016 (это 0.3 мм) блюдце не читалось вовсе и шляпка выглядела плоской -
// у настоящего профиля Cherry прогиб около миллиметра
const ROW_PROFILE = [
  { h: 1.07, dish: 0.058 }, // цифровой
  { h: 1.02, dish: 0.052 }, // QWERTY
  { h: 1.00, dish: 0.048 }, // домашний - самый низкий
  { h: 1.03, dish: 0.052 }, // ZXCV
  { h: 1.06, dish: 0.058 }, // модификаторы и пробел
];

// стенка снизу вверх: доля высоты и утяжка к центру в мировых единицах
const SIDE = [
  [0.0, 0.0],
  [0.5, 0.035],
  [0.86, 0.07],
  [0.95, 0.09],
  [0.995, 0.105],
];

// точка суперэллипса с полуразмерами a и b: прямоугольник со скруглениями
function sePoint(t, a, b) {
  const ct = Math.cos(t);
  const st = Math.sin(t);
  return [
    a * Math.sign(ct) * Math.abs(ct) ** (2 / SE),
    b * Math.sign(st) * Math.abs(st) ** (2 / SE),
  ];
}

// CAP_HEIGHT - потолок для самого высокого ряда, а не база для домашнего.
// от прямого умножения на prof.h ряды выше единицы вылезали за потолок
// и тест на вписанность падал: нормируем на максимум профиля, и тогда самый
// высокий ряд ровно упирается в него, а домашний остаётся ниже
const ROW_H_MAX = Math.max(...ROW_PROFILE.map((p) => p.h));

export function buildCap(row, w) {
  const prof = ROW_PROFILE[row];
  const H = (CAP_HEIGHT / ROW_H_MAX) * prof.h;
  const halfW = w / 2;
  const positions = [];
  const indices = [];

  // утяжка в мировых единицах и вычитается одинаково с обеих осей: поэтому
  // угол широкой клавиши выглядит так же, как у узкой
  const addRing = (y, inset) => {
    const start = positions.length / 3;
    const a = Math.max(0.04, halfW - inset);
    const b = Math.max(0.04, CORNER - inset);
    for (let i = 0; i < N; i++) {
      const [x, z] = sePoint((i / N) * Math.PI * 2, a, b);
      positions.push(x, y, z);
    }
    return start;
  };
  const bridge = (r0, r1) => {
    for (let i = 0; i < N; i++) {
      const j = (i + 1) % N;
      indices.push(r0 + i, r0 + j, r1 + j, r0 + i, r1 + j, r1 + i);
    }
  };

  const rings = SIDE.map(([yf, inset]) => addRing(-H / 2 + yf * H, inset));
  for (let i = 0; i < rings.length - 1; i++) bridge(rings[i], rings[i + 1]);

  // шляпка: концентрические кольца внутрь, прогиб по r в квадрате.
  // у пробела блюдце цилиндрическое, прогиб только поперёк клавиши
  const topY = -H / 2 + 0.995 * H;
  const topInset = SIDE[SIDE.length - 1][1];
  const cylindrical = w >= 3;
  const capA = Math.max(0.04, halfW - topInset);
  const capB = Math.max(0.04, CORNER - topInset);

  // высота шляпки в точке; отдельно, потому что по ней строится ещё
  // и изнанка. прогиб считаем по настоящему расстоянию от центра, а не
  // по номеру кольца: кольца тут суперэллипсы, и постоянная глубина на кольце
  // делала блюдце квадратным - по диагоналям оно проседало сильнее, чем
  // по осям, и на каждом колпачке проступал тёмный крест
  const dishAt = (x, z) => {
    const nx = x / capA;
    const nz = z / capB;
    const radial = Math.min(1, Math.hypot(nx, nz));
    // ноль там, где прогиб максимален: у обычных клавиш это центр шляпки,
    // у цилиндрического пробела - средняя линия
    const t = cylindrical ? Math.abs(z) / capB : radial;
    return topY - prof.dish * (1 - t * t);
  };

  // на четырёх кольцах изгиб блюдца ложился длинными узкими треугольниками,
  // и по шляпке от углов к центру шли отчётливые полосы - не тень и не блик,
  // а сама грань
  const CAP_RINGS = 12;
  let prev = rings[rings.length - 1];
  for (let k = 1; k <= CAP_RINGS; k++) {
    const rr = 1 - k / CAP_RINGS;
    if (k === CAP_RINGS) {
      const center = positions.length / 3;
      positions.push(0, dishAt(0, 0), 0);
      for (let i = 0; i < N; i++) indices.push(prev + i, prev + ((i + 1) % N), center);
    } else {
      const start = positions.length / 3;
      const a = capA * (cylindrical ? 1 - (1 - rr) * 0.15 : rr);
      const b = capB * rr;
      for (let i = 0; i < N; i++) {
        const [x, z] = sePoint((i / N) * Math.PI * 2, a, b);
        positions.push(x, dishAt(x, z), z);
      }
      bridge(prev, start);
      prev = start;
    }
  }

  // изнанка. колпачок - оболочка, и снизу у неё видно то же, что
  // у настоящего: тонкая юбка по периметру, изнанка шляпки над пустотой
  // и бобышка с крестовым гнездом. мелкой чаши с прямоугольной дыркой
  // хватало на общем плане, но в свободном падении колпачок занимает
  // половину экрана, и изнанка читалась недоделанной
  const botY = -H / 2;
  /** толщина юбки и шляпки: около миллиметра, как у литого PBT */
  const WALL = 0.05;
  const TOP_THICK = 0.05;
  /** бобышка вокруг гнезда */
  const BOSS_A = SOCKET_A + 0.09;
  const BOSS_B = SOCKET_B + 0.09;
  const shaftTopY = botY + SOCKET_DEPTH;

  /** кольцо с заданными полуразмерами; высота может считаться по точке */
  const ringAt = (a, b, yFn) => {
    const start = positions.length / 3;
    for (let i = 0; i < N; i++) {
      const [x, z] = sePoint((i / N) * Math.PI * 2, a, b);
      positions.push(x, yFn(x, z), z);
    }
    return start;
  };
  const bridgeDown = (r0, r1) => {
    for (let i = 0; i < N; i++) {
      const j = (i + 1) % N;
      indices.push(r0 + j, r0 + i, r1 + i, r0 + j, r1 + i, r1 + j);
    }
  };

  // контур крестового гнезда на те же N точек, что и обычное кольцо, -
  // иначе его не сшить с оболочкой. идём по периметру плюса равными шагами
  const crossCorners = () => [
      [SOCKET_A, SOCKET_BAR],
      [SOCKET_BAR, SOCKET_BAR],
      [SOCKET_BAR, SOCKET_B],
      [-SOCKET_BAR, SOCKET_B],
      [-SOCKET_BAR, SOCKET_BAR],
      [-SOCKET_A, SOCKET_BAR],
      [-SOCKET_A, -SOCKET_BAR],
      [-SOCKET_BAR, -SOCKET_BAR],
      [-SOCKET_BAR, -SOCKET_B],
      [SOCKET_BAR, -SOCKET_B],
      [SOCKET_BAR, -SOCKET_BAR],
      [SOCKET_A, -SOCKET_BAR],
  ];

  const crossRing = (y) => {
    const c = crossCorners();
    const len = c.map((p, i) => {
      const q = c[(i + 1) % c.length];
      return Math.hypot(q[0] - p[0], q[1] - p[1]);
    });
    const total = len.reduce((s, v) => s + v, 0);
    const start = positions.length / 3;
    for (let i = 0; i < N; i++) {
      let d = (i / N) * total;
      let k = 0;
      while (d > len[k] && k < len.length - 1) {
        d -= len[k];
        k++;
      }
      const p = c[k];
      const q = c[(k + 1) % c.length];
      const f = len[k] ? d / len[k] : 0;
      positions.push(p[0] + (q[0] - p[0]) * f, y, p[1] + (q[1] - p[1]) * f);
    }
    return start;
  };

  // юбка изнутри: тот же профиль, что снаружи, уведённый внутрь на толщину.
  // верхнее кольцо наружной стенки не дублируем, там уже потолок
  const innerSide = SIDE.slice(0, SIDE.length - 1).map(([yf, inset]) =>
    addRing(botY + yf * H, inset + WALL),
  );
  // торец по нижней кромке: снизу видно, что колпачок не бесконечно тонкий
  bridgeDown(rings[0], innerSide[0]);
  for (let i = 0; i < innerSide.length - 1; i++) bridgeDown(innerSide[i], innerSide[i + 1]);

  // потолок - изнанка шляпки: повторяет блюдце, отступив на толщину,
  // и внутри колпачок такой же вогнутый, как снаружи
  const ceilInset = SIDE[SIDE.length - 2][1] + WALL;
  const ceilA = Math.max(0.04, halfW - ceilInset);
  const ceilB = Math.max(0.04, CORNER - ceilInset);
  const ceilY = (x, z) => dishAt(x, z) - TOP_THICK;
  const CEIL_RINGS = 4;
  let prevIn = ringAt(ceilA, ceilB, ceilY);
  bridgeDown(innerSide[innerSide.length - 1], prevIn);
  for (let k = 1; k <= CEIL_RINGS; k++) {
    const f = k / CEIL_RINGS;
    const r = ringAt(ceilA + (BOSS_A - ceilA) * f, ceilB + (BOSS_B - ceilB) * f, ceilY);
    bridgeDown(prevIn, r);
    prevIn = r;
  }

  // бобышка: тумба вокруг гнезда, от потолка до самой подошвы
  const bossBot = ringAt(BOSS_A, BOSS_B, () => botY);
  bridgeDown(prevIn, bossBot);

  // гнездо: открыто снизу и уходит на глубину посадки, выше плоский потолок
  // шахты. плоский, а не сведённый в точку - у вершины конуса радиус упал бы
  // ниже полуширины штока, и его угол проткнул бы крышку насквозь
  const mouth = crossRing(botY);
  bridgeDown(bossBot, mouth);
  // стенка гнезда - двенадцать отдельных граней со своими вершинами, а не
  // общее кольцо: нормали считаются усреднением, и на общем кольце углы
  // креста сглаживались в подушку, проём выглядел так, будто колпачок сядет
  // с люфтом
  {
    const c = crossCorners();
    for (let i = 0; i < c.length; i++) {
      const p = c[i];
      const q = c[(i + 1) % c.length];
      const base = positions.length / 3;
      positions.push(p[0], botY, p[1], q[0], botY, q[1]);
      positions.push(q[0], shaftTopY, q[1], p[0], shaftTopY, p[1]);
      indices.push(base + 1, base, base + 3, base + 1, base + 3, base + 2);
    }
  }
  // потолок шахты своим кольцом, чтобы верхнее ребро тоже осталось резким
  const shaftTop = crossRing(shaftTopY);
  {
    const center = positions.length / 3;
    positions.push(0, shaftTopY, 0);
    for (let i = 0; i < N; i++) indices.push(shaftTop + ((i + 1) % N), shaftTop + i, center);
  }

  // наклон ряда запекаем сдвигом, а не поворотом всей клавиши: от поворота
  // задиралась и подошва, и сбоку появлялась клиновидная щель, сквозь которую
  // был виден крест штока. на настоящей клавиатуре подошвы лежат в одной
  // плоскости, а наклон даёт сама шляпка - одна стенка выше другой
  const tilt = ROW_TILT[row] ?? 0;
  if (tilt) {
    for (let i = 0; i < positions.length; i += 3) {
      const y = positions[i + 1];
      const z = positions[i + 2];
      const yFrac = (y + H / 2) / H;
      positions[i + 1] = y - tilt * z * Math.max(0, yFrac);
    }
  }

  // разворот обхода. кольца выше собраны так, что знаковый объём оболочки
  // выходит отрицательным: она вывернута наизнанку и все нормали смотрят
  // внутрь. на картинке этого не видно - материал двусторонний, и три сам
  // переворачивает нормаль задних граней, - а вот любая проверка по нормали
  // молча не срабатывала: "печатать легенду только по обращённым вверх
  // граням" давало ноль на всей шляпке.
  //
  // разворачиваем один раз здесь, а не переписываем полтора десятка мест
  // сшивки: обход у них согласован между собой, ошибочен только общий знак
  for (let f = 0; f < indices.length; f += 3) {
    const t = indices[f + 1];
    indices[f + 1] = indices[f + 2];
    indices[f + 2] = t;
  }

  const pos = new Float32Array(positions);
  const idx = new Uint32Array(indices);
  const vertCount = pos.length / 3;

  // нормали усреднением по граням
  const normals = new Float32Array(pos.length);
  for (let f = 0; f < idx.length; f += 3) {
    const ia = idx[f] * 3, ib = idx[f + 1] * 3, ic = idx[f + 2] * 3;
    const e1 = [pos[ib] - pos[ia], pos[ib + 1] - pos[ia + 1], pos[ib + 2] - pos[ia + 2]];
    const e2 = [pos[ic] - pos[ia], pos[ic + 1] - pos[ia + 1], pos[ic + 2] - pos[ia + 2]];
    const n = [
      e1[1] * e2[2] - e1[2] * e2[1],
      e1[2] * e2[0] - e1[0] * e2[2],
      e1[0] * e2[1] - e1[1] * e2[0],
    ];
    for (const o of [ia, ib, ic]) {
      normals[o] += n[0]; normals[o + 1] += n[1]; normals[o + 2] += n[2];
    }
  }
  for (let i = 0; i < vertCount; i++) {
    const o = i * 3;
    const l = Math.hypot(normals[o], normals[o + 1], normals[o + 2]) || 1;
    normals[o] /= l; normals[o + 1] /= l; normals[o + 2] /= l;
  }

  // планарные UV сверху
  const uvs = new Float32Array(vertCount * 2);
  for (let i = 0; i < vertCount; i++) {
    uvs[i * 2] = pos[i * 3] / w + 0.5;
    uvs[i * 2 + 1] = pos[i * 3 + 2] + 0.5;
  }

  return { positions: pos, normals, uvs, indices: idx };
}

const pad4 = (n) => (4 - (n % 4)) % 4;

function writeGlb(meshes, outPath) {
  const enc = new TextEncoder();
  const bufferViews = [];
  const accessors = [];
  const gltfMeshes = [];
  const nodes = [];
  const chunks = [];
  let offset = 0;

  const pushView = (arr, target) => {
    const byteOffset = offset;
    chunks.push(new Uint8Array(arr.buffer, arr.byteOffset, arr.byteLength));
    offset += arr.byteLength;
    const padding = pad4(arr.byteLength);
    if (padding) { chunks.push(new Uint8Array(padding)); offset += padding; }
    bufferViews.push({ buffer: 0, byteOffset, byteLength: arr.byteLength, target });
    return bufferViews.length - 1;
  };

  for (const { name, geo } of meshes) {
    const vertCount = geo.positions.length / 3;
    let min = [Infinity, Infinity, Infinity];
    let max = [-Infinity, -Infinity, -Infinity];
    for (let i = 0; i < vertCount; i++) {
      for (let c = 0; c < 3; c++) {
        const v = geo.positions[i * 3 + c];
        if (v < min[c]) min[c] = v;
        if (v > max[c]) max[c] = v;
      }
    }
    const pv = pushView(geo.positions, 34962);
    const nv = pushView(geo.normals, 34962);
    const uv = pushView(geo.uvs, 34962);
    // индексы в два байта: в самом крупном меше меньше двух тысяч вершин,
    // до предела uint16 там тридцатикратный запас, а индексов у оболочки
    // втрое больше, чем вершин, и на четырёх байтах они занимали в файле
    // больше места, чем позиции с нормалями вместе взятые
    const short = vertCount <= 65535;
    const iv = pushView(short ? Uint16Array.from(geo.indices) : geo.indices, 34963);
    const base = accessors.length;
    accessors.push(
      { bufferView: pv, componentType: 5126, count: vertCount, type: 'VEC3', min, max },
      { bufferView: nv, componentType: 5126, count: vertCount, type: 'VEC3' },
      { bufferView: uv, componentType: 5126, count: vertCount, type: 'VEC2' },
      {
        bufferView: iv,
        componentType: short ? 5123 : 5125,
        count: geo.indices.length,
        type: 'SCALAR',
      },
    );
    gltfMeshes.push({
      name,
      primitives: [
        { attributes: { POSITION: base, NORMAL: base + 1, TEXCOORD_0: base + 2 }, indices: base + 3, mode: 4 },
      ],
    });
    nodes.push({ name, mesh: gltfMeshes.length - 1 });
  }

  const bin = new Uint8Array(offset);
  let p = 0;
  for (const c of chunks) { bin.set(c, p); p += c.length; }

  const gltf = {
    asset: { version: '2.0', generator: 'void65-keycaps' },
    scene: 0,
    scenes: [{ nodes: nodes.map((_, i) => i) }],
    nodes,
    meshes: gltfMeshes,
    buffers: [{ byteLength: bin.length }],
    bufferViews,
    accessors,
  };

  const json = enc.encode(JSON.stringify(gltf));
  const jsonPad = pad4(json.length);
  const binPad = pad4(bin.length);
  const total = 12 + 8 + json.length + jsonPad + 8 + bin.length + binPad;
  const out = new Uint8Array(total);
  const dv = new DataView(out.buffer);
  let q = 0;
  dv.setUint32(q, 0x46546c67, true); q += 4;
  dv.setUint32(q, 2, true); q += 4;
  dv.setUint32(q, total, true); q += 4;
  dv.setUint32(q, json.length + jsonPad, true); q += 4;
  dv.setUint32(q, 0x4e4f534a, true); q += 4;
  out.set(json, q); q += json.length;
  for (let i = 0; i < jsonPad; i++) out[q++] = 0x20;
  dv.setUint32(q, bin.length + binPad, true); q += 4;
  dv.setUint32(q, 0x004e4942, true); q += 4;
  out.set(bin, q); q += bin.length;

  mkdirSync(dirname(outPath), { recursive: true });
  writeFileSync(outPath, out);
  return out.length;
}

// запуск только при прямом вызове: при импорте из теста ничего не пишем
if (process.argv[1] && process.argv[1].endsWith('genKeycaps.mjs')) {
  const meshes = uniqueCombos().map(({ key, row, w }) => ({
    name: `cap_${key}`,
    geo: buildCap(row, w),
  }));
  const outPath = join(__dirname, '..', 'public', 'keycaps.glb');
  const size = writeGlb(meshes, outPath);
  const tris = meshes.reduce((s, m) => s + m.geo.indices.length / 3, 0);
  console.log(`keycaps.glb: ${meshes.length} мешей, ${tris} трис, ${size} байт`);
  console.log('ряды/наклоны:', ROW_TILT.length === ROWS.length ? 'ок' : 'РАСХОЖДЕНИЕ');
  console.log('имена:', meshes.map((m) => m.name).join(', '));
}
