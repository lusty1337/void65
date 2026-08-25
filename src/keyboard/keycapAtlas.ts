import * as THREE from 'three';
import { KEYS } from './layout';

// у каждой клавиши своя ячейка в общей текстуре, а какую взять, инстанс
// говорит per-instance атрибутом. один холст на всю раскладку и ни одного
// лишнего меша: надпись подмешивается в материал самого колпачка

export const ATLAS_COLS = 10;
// девять рядов, а не семь: на семи ячеек выходило семьдесят, и легенды
// клавиш с индексом выше уходили за край холста
export const ATLAS_ROWS = 9;
// на ячейке в 128 буква занимала 46 пикселей и размывалась в пятно
const CELL = 192;

// узкий индустриальный гротеск того же рода, что Gorton у Cherry и GMK:
// он стоит на клавишах почти всех заводских наборов. моноширинный запасной
// ближе к нему, чем системный
const FACE = "'Barlow Semi Condensed', 'IBM Plex Mono', 'Segoe UI', Arial, sans-serif";

export type LegendAtlas = {
  texture: THREE.CanvasTexture;
  redraw: () => void; // перерисовать после загрузки шрифтов
  cellOf: (index: number) => [number, number]; // uv-смещение ячейки
};

function draw(canvas: HTMLCanvasElement) {
  const ctx = canvas.getContext('2d')!;
  ctx.clearRect(0, 0, canvas.width, canvas.height);

  KEYS.forEach((key, i) => {
    if (!key.legend) return;
    const cx = (i % ATLAS_COLS) * CELL;
    // рисуем сверху вниз: flipY у CanvasTexture сам переворачивает v,
    // а cellOf ниже отдаёт смещение уже с учётом этого
    const cy = Math.floor(i / ATLAS_COLS) * CELL;

    // светло-серые, а не белые: чистый белый на графите - признак дешёвого
    // принта, у наборов этого класса подпись мягче фона на пару ступеней
    const ink = key.accent ? '#28301f' : key.tone === 'mod' ? '#c2c7ce' : '#d2d7de';
    // слой Fn тусклее: это подсказка, а не равноправная надпись
    const inkFn = key.accent ? '#4a5340' : '#7c828b';
    ctx.textBaseline = 'alphabetic';

    // кегль подбираем замером, а не константой: с общим кеглем "backspace"
    // на двух юнитах и "esc" на одном дают одну надпись во всю шляпку,
    // а другую в четверть
    const fit = (text: string, maxW: number, maxH: number) => {
      const REF = 100;
      ctx.font = `500 ${REF}px ${FACE}`;
      const w = ctx.measureText(text).width || 1;
      return Math.min(maxH, (maxW / w) * REF);
    };
    const put = (text: string, size: number, x: number, y: number, align: CanvasTextAlign) => {
      ctx.font = `500 ${size}px ${FACE}`;
      ctx.textAlign = align;
      ctx.fillText(text, x, y);
    };

    // на широких клавишах площадка растянута: сжимаем текст на тот же
    // множитель, иначе буквы поедут вширь вместе с колпачком
    const k = legendStretch(key.w);
    ctx.save();
    ctx.translate(cx, cy);
    ctx.scale(1 / k, 1);
    ctx.translate(-cx, -cy);
    const box = CELL * 0.74 * k; // рабочая ширина ячейки с учётом растяжения
    const left = cx + CELL * 0.13 * k;

    if (key.sub) {
      // цифровой ряд: сверху цифра со знаком Shift, снизу F-клавиша слоя Fn.
      // ряда F на 65% нет вовсе, и без подписи о нём не догадаться
      const head = `${key.legend} ${key.sub}`;
      ctx.fillStyle = ink;
      put(head, fit(head, box * 0.62, CELL * 0.29), left, cy + CELL * 0.4, 'left');
      if (key.fn) {
        ctx.fillStyle = inkFn;
        put(key.fn, fit(key.fn, box * 0.34, CELL * 0.2), left, cy + CELL * 0.72, 'left');
      }
      ctx.restore();
      return;
    }

    ctx.fillStyle = ink;

    if (key.legend.length > 1) {
      // слова из двух частей разносим по строкам: "caps lock" в одну строку
      // помещается только вдвое мельче соседних подписей
      const parts = key.legend.split(' ');
      if (parts.length > 1) {
        const tail = parts.slice(1).join(' ');
        const size = Math.min(
          fit(parts[0], box * 0.72, CELL * 0.24),
          fit(tail, box * 0.72, CELL * 0.24),
        );
        put(parts[0], size, left, cy + CELL * 0.36, 'left');
        put(tail, size, left, cy + CELL * 0.6, 'left');
        ctx.restore();
        return;
      }
      put(key.legend, fit(key.legend, box * 0.78, CELL * 0.3), left, cy + CELL * 0.42, 'left');
      ctx.restore();
      return;
    }

    // буквы и одиночные знаки - по центру шляпки
    put(key.legend, fit(key.legend, box * 0.4, CELL * 0.34), cx + CELL * 0.5 * k, cy + CELL * 0.6, 'center');
    ctx.restore();
  });
}

// во сколько раз площадка легенды шире квадратной. на квадратной площадке
// "backspace" ужимался вдвое мельче соседней буквы, поэтому она расширяется,
// а текст в атласе сжимается на тот же множитель - пропорции букв целы
export const legendStretch = (w: number) => Math.min(w, 2.3);

export function makeLegendAtlas(): LegendAtlas {
  const canvas = document.createElement('canvas');
  canvas.width = ATLAS_COLS * CELL;
  canvas.height = ATLAS_ROWS * CELL;
  draw(canvas);

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 16;
  texture.wrapS = texture.wrapT = THREE.ClampToEdgeWrapping;

  return {
    texture,
    redraw: () => {
      draw(canvas);
      texture.needsUpdate = true;
    },
    cellOf: (index: number) => [
      (index % ATLAS_COLS) / ATLAS_COLS,
      (ATLAS_ROWS - 1 - Math.floor(index / ATLAS_COLS)) / ATLAS_ROWS,
    ],
  };
}
