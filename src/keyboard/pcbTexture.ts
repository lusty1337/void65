import * as THREE from 'three';
import { KEYS } from './layout';
import { TRAY_WIDTH, TRAY_DEPTH } from './caseGeometry';

// процедурные карты платы: чёрная паяльная маска, дорожки матрицы
// от настоящих позиций клавиш, золотые hot-swap площадки, шелкография.
// ни одного внешнего файла

// плата вкладывается в лоток, а не вбивается
export const PCB_CLEARANCE = 0.04;
export const PCB_W = TRAY_WIDTH - PCB_CLEARANCE * 2;
export const PCB_D = TRAY_DEPTH - PCB_CLEARANCE * 2;

// рисуем в базовой сетке, а холст берём вдвое крупнее и масштабируем
// контекст: размеры пятачков, контуров и шрифта остаются теми же в долях
// платы, но кладутся вдвое плотнее. просто увеличить W нельзя - координаты
// в paint заданы пикселями, и вся мелочь стала бы вдвое мельче
const BASE_W = 1024;
const BASE_H = Math.round(BASE_W * (PCB_D / PCB_W));
const SCALE = 2;
const W = BASE_W * SCALE;
const H = BASE_H * SCALE;
const px = (x: number) => ((x / PCB_W) + 0.5) * BASE_W;
const py = (z: number) => ((z / PCB_D) + 0.5) * BASE_H;

// третья карта ORM: в зелёном канале шероховатость, в синем металличность.
// три читает roughnessMap.g и metalnessMap.b, поэтому одна текстура закрывает
// оба. без неё вся плата - один материал, и золотые пятачки остаются просто
// жёлтым рисунком на пластике
type Mode = 'color' | 'height' | 'orm';

/** цвет для текущей карты: свой на каждую из трёх */
const pick = (mode: Mode, color: string, height: string, orm: string) =>
  mode === 'color' ? color : mode === 'height' ? height : orm;

// шероховатость и металличность упакованы как rgb(_, rough, metal)
const ORM_MASK = 'rgb(0,158,0)'; // паяльная маска: матовый диэлектрик
// золочение ENIG полуматовое, зеркала там нет: на 64 и даже на 112 пятачки
// ловили софтбокс, выбивались за порог блума и обрастали ореолом
const ORM_METAL = 'rgb(0,148,255)';
const ORM_SILK = 'rgb(0,220,0)'; // шелкография: самая матовая краска на плате
const ORM_HOLE = 'rgb(0,200,0)';

function paint(ctx: CanvasRenderingContext2D, mode: Mode) {
  const c = mode === 'color';
  // дальше всё в базовой сетке, холст крупнее ровно во SCALE раз
  ctx.scale(SCALE, SCALE);

  ctx.fillStyle = pick(mode, '#1a1c21', '#808080', ORM_MASK);
  ctx.fillRect(0, 0, BASE_W, BASE_H);

  // горизонтальная шина на ряд плюс отвод к каждой клавише: структурная
  // разводка выглядит правдоподобнее случайных линий
  ctx.lineCap = 'round';
  ctx.strokeStyle = pick(mode, '#2a2e35', '#8e8e8e', ORM_MASK);
  ctx.lineWidth = 2;
  const rows = new Map<number, number[]>();
  for (const key of KEYS) {
    const list = rows.get(key.z) ?? [];
    list.push(key.x);
    rows.set(key.z, list);
  }
  for (const [z, xs] of rows) {
    const y = py(z) + 14;
    ctx.beginPath();
    ctx.moveTo(px(Math.min(...xs)) - 10, y);
    ctx.lineTo(px(Math.max(...xs)) + 10, y);
    ctx.stroke();
    for (const x of xs) {
      ctx.beginPath();
      ctx.moveTo(px(x), py(z));
      ctx.lineTo(px(x), y);
      ctx.stroke();
    }
  }
  // вертикальные шины колонок к контроллеру
  ctx.strokeStyle = pick(mode, '#1d2024', '#8a8a8a', ORM_MASK);
  ctx.lineWidth = 1.4;
  for (let i = 0; i < 16; i++) {
    const x = ((i + 0.5) / 16) * BASE_W;
    ctx.beginPath();
    ctx.moveTo(x, 20);
    ctx.lineTo(x, BASE_H - 20);
    ctx.stroke();
  }

  // посадочное место клавиши: контур шелкографией и hot-swap площадки
  for (const key of KEYS) {
    const x = px(key.x);
    const y = py(key.z);

    if (mode !== 'height') {
      // контур переключателя. на 0.75 и толстой линии контуры давали почти
      // половину площади платы в мип-уровнях, и издали вся она усреднялась
      // в светлый металл вместо чёрного текстолита
      ctx.strokeStyle = c ? 'rgba(206,212,220,0.32)' : ORM_SILK;
      ctx.lineWidth = 0.9;
      ctx.strokeRect(x - 17, y - 15, 34, 30);
    }

    // золотые пятачки: центральное отверстие и два контакта hot-swap
    const pads: [number, number, number][] = [
      [x, y, 5.2],
      [x - 9, y - 8, 3.4],
      [x + 7, y - 9, 3.4],
    ];
    for (const [cx, cy, r] of pads) {
      ctx.fillStyle = pick(mode, '#c9a24a', '#e8e8e8', ORM_METAL);
      ctx.beginPath();
      ctx.arc(cx, cy, r, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = pick(mode, '#0d0e10', '#3a3a3a', ORM_HOLE);
      ctx.beginPath();
      ctx.arc(cx, cy, r * 0.45, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  // контроллер и обвязка по центру нижней кромки
  const mcuX = BASE_W / 2 - 30;
  const mcuY = BASE_H - 66;
  ctx.fillStyle = pick(mode, '#0a0b0d', '#d0d0d0', ORM_SILK);
  ctx.fillRect(mcuX, mcuY, 60, 44);
  if (c) {
    ctx.strokeStyle = 'rgba(206,212,220,0.42)';
    ctx.lineWidth = 1;
    ctx.strokeRect(mcuX - 4, mcuY - 4, 68, 52);
    // ножки корпуса
    ctx.fillStyle = '#c9a24a';
    for (let i = 0; i < 10; i++) {
      ctx.fillRect(mcuX + 4 + i * 5.5, mcuY - 3, 2.4, 3);
      ctx.fillRect(mcuX + 4 + i * 5.5, mcuY + 44, 2.4, 3);
    }
  }

  // маркировка, как на настоящих платах
  if (c) {
    ctx.fillStyle = 'rgba(206,212,220,0.5)';
    ctx.font = '600 13px "IBM Plex Mono", monospace';
    ctx.textAlign = 'left';
    ctx.fillText('VOID65 · REV 1.2 · HOTSWAP', 26, BASE_H - 24);
    ctx.textAlign = 'right';
    ctx.fillText('QMK / VIA', BASE_W - 26, BASE_H - 24);
  }

  // крепёжные отверстия по углам
  for (const [hx, hy] of [[20, 20], [BASE_W - 20, 20], [20, BASE_H - 20], [BASE_W - 20, BASE_H - 20]] as const) {
    ctx.fillStyle = pick(mode, '#c9a24a', '#f0f0f0', ORM_METAL);
    ctx.beginPath();
    ctx.arc(hx, hy, 7, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = pick(mode, '#000', '#202020', ORM_HOLE);
    ctx.beginPath();
    ctx.arc(hx, hy, 4, 0, Math.PI * 2);
    ctx.fill();
  }
}

// собель по карте высот в normal map касательного пространства, один проход
function heightToNormal(heightCanvas: HTMLCanvasElement, strength: number): HTMLCanvasElement {
  const src = heightCanvas.getContext('2d')!.getImageData(0, 0, W, H);
  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext('2d')!;
  const dst = ctx.createImageData(W, H);

  const h = (x: number, y: number) =>
    src.data[(((y + H) % H) * W + ((x + W) % W)) * 4] / 255;

  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const dx = (h(x - 1, y) - h(x + 1, y)) * strength;
      const dy = (h(x, y - 1) - h(x, y + 1)) * strength;
      const invLen = 1 / Math.sqrt(dx * dx + dy * dy + 1);
      const i = (y * W + x) * 4;
      dst.data[i] = (dx * invLen * 0.5 + 0.5) * 255;
      dst.data[i + 1] = (dy * invLen * 0.5 + 0.5) * 255;
      dst.data[i + 2] = (invLen * 0.5 + 0.5) * 255;
      dst.data[i + 3] = 255;
    }
  }
  ctx.putImageData(dst, 0, 0);
  return canvas;
}

export type PcbMaps = {
  map: THREE.CanvasTexture;
  normalMap: THREE.CanvasTexture;
  ormMap: THREE.CanvasTexture;
};

export function makePcbMaps(): PcbMaps {
  const colorCanvas = document.createElement('canvas');
  colorCanvas.width = W;
  colorCanvas.height = H;
  paint(colorCanvas.getContext('2d')!, 'color');

  const heightCanvas = document.createElement('canvas');
  heightCanvas.width = W;
  heightCanvas.height = H;
  paint(heightCanvas.getContext('2d')!, 'height');

  const map = new THREE.CanvasTexture(colorCanvas);
  map.colorSpace = THREE.SRGBColorSpace;
  map.anisotropy = 16;
  map.wrapS = map.wrapT = THREE.ClampToEdgeWrapping;

  // normal map обязана остаться линейной: sRGB сломает рельеф
  const normalMap = new THREE.CanvasTexture(heightToNormal(heightCanvas, 2.2));
  normalMap.anisotropy = 16;
  normalMap.wrapS = normalMap.wrapT = THREE.ClampToEdgeWrapping;

  const ormCanvas = document.createElement('canvas');
  ormCanvas.width = W;
  ormCanvas.height = H;
  paint(ormCanvas.getContext('2d')!, 'orm');
  // ORM тоже линейная: sRGB исказил бы шероховатость и металличность
  const ormMap = new THREE.CanvasTexture(ormCanvas);
  ormMap.anisotropy = 16;
  ormMap.wrapS = ormMap.wrapT = THREE.ClampToEdgeWrapping;

  return { map, normalMap, ormMap };
}
