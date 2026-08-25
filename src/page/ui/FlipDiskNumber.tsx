import { memo, useEffect, useMemo, useRef, useState } from 'react';
import './flip-disk.css';

// флип-дисковое табло для цены. матрица собирается ровно под переданную
// строку, оформление на токенах страницы, и вместо вечного цикла один заход
// по появлению в кадре. электромеханика тут не украшение: это тот же род
// механики, что и сама клавиатура

const GLYPH_W = 5;
const GLYPH_H = 7;

// пятибитные строки на глиф: нужны только цифры и знак валюты
const GLYPHS: Record<string, number[]> = {
  '0': [0b01110, 0b10001, 0b10011, 0b10101, 0b11001, 0b10001, 0b01110],
  '1': [0b00100, 0b01100, 0b00100, 0b00100, 0b00100, 0b00100, 0b01110],
  '2': [0b01110, 0b10001, 0b00001, 0b00110, 0b01000, 0b10000, 0b11111],
  '3': [0b01110, 0b10001, 0b00001, 0b00110, 0b00001, 0b10001, 0b01110],
  '4': [0b00010, 0b00110, 0b01010, 0b10010, 0b11111, 0b00010, 0b00010],
  '5': [0b11111, 0b10000, 0b11110, 0b00001, 0b00001, 0b10001, 0b01110],
  '6': [0b00110, 0b01000, 0b10000, 0b11110, 0b10001, 0b10001, 0b01110],
  '7': [0b11111, 0b00001, 0b00010, 0b00100, 0b01000, 0b01000, 0b01000],
  '8': [0b01110, 0b10001, 0b10001, 0b01110, 0b10001, 0b10001, 0b01110],
  '9': [0b01110, 0b10001, 0b10001, 0b01111, 0b00001, 0b00010, 0b01100],
  $: [0b00100, 0b01111, 0b10100, 0b01110, 0b00101, 0b11110, 0b00100],
  ' ': [0, 0, 0, 0, 0, 0, 0],
};

function bitmap(text: string): boolean[][] {
  const chars = [...text.toUpperCase()];
  const cols = chars.length * (GLYPH_W + 1) - 1;
  const grid = Array.from({ length: GLYPH_H }, () => Array<boolean>(cols).fill(false));

  chars.forEach((ch, i) => {
    const rows = GLYPHS[ch] ?? GLYPHS[' '];
    const ox = i * (GLYPH_W + 1);
    for (let y = 0; y < GLYPH_H; y++) {
      for (let x = 0; x < GLYPH_W; x++) {
        grid[y][ox + x] = !!(rows[y] & (1 << (GLYPH_W - 1 - x)));
      }
    }
  });
  return grid;
}

// радиус влияния курсора в клетках: горстка дисков вокруг него
const HOVER_R = 1.45;

// сколько диск обязан оставаться перевёрнутым, даже если курсор уже ушёл.
// настоящая шайба не умеет передумать на полпути: без выдержки быстрый
// росчерк мышью включал диск и снимал его через кадр, переход разворачивался
// с середины, и табло вздрагивало вместо переворота
const HOLD = 700;

const Disk = memo(function Disk({ on, delay }: { on: boolean; delay: number }) {
  return (
    <span className="v65-disk">
      <span
        className={`v65-disk__flip${on ? ' is-on' : ''}`}
        style={{ ['--d' as string]: `${delay}ms` }}
      >
        <i className="v65-disk__face v65-disk__face--off" />
        <i className="v65-disk__face v65-disk__face--on" />
      </span>
    </span>
  );
});

export default function FlipDiskNumber({ value }: { value: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const [shown, setShown] = useState(false);
  const grid = useMemo(() => bitmap(value), [value]);
  const cols = grid[0]?.length ?? 0;

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      setShown(true);
      return;
    }
    // наблюдатель не отключаем: табло переигрывает появление каждый раз,
    // когда к нему возвращаются скроллом
    const io = new IntersectionObserver(
      (entries) => setShown(entries.some((e) => e.isIntersecting)),
      { threshold: 0.4 },
    );
    io.observe(el);
    return () => io.disconnect();
  }, []);

  // диски под курсором переворачиваются в противоположную сторону.
  // состояние пишем прямо в стиль и только изменившимся: в сетке их полторы
  // сотни, и рендер на каждое движение мыши сжёг бы кадры
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;

    const flips = () => [...el.querySelectorAll<HTMLElement>('.v65-disk__flip')];
    // индекс диска и момент включения: по нему решается, вышла ли выдержка
    const active = new Map<number, number>();
    let want = new Set<number>();
    let raf = 0;
    let hold = 0;

    const sync = () => {
      raf = 0;
      const now = performance.now();
      const nodes = flips();
      let waiting = false;

      for (const [i, since] of active) {
        if (want.has(i)) continue;
        if (now - since < HOLD) {
          waiting = true;
          continue;
        }
        const n = nodes[i];
        if (n) {
          n.style.removeProperty('--hv');
          n.style.removeProperty('--hs');
          n.style.removeProperty('--hd');
        }
        active.delete(i);
      }

      for (const i of want) {
        if (active.has(i)) continue;
        const n = nodes[i];
        if (n) {
          n.style.setProperty('--hv', '180deg');
          n.style.setProperty('--hs', '1.18');
          // задержку появления на время наведения снимаем: иначе дальние
          // диски догоняют курсор с опозданием
          n.style.setProperty('--hd', '0ms');
        }
        active.set(i, now);
      }

      // держим цикл, пока кто-то досиживает выдержку: курсор может больше
      // не двинуться, а отпустить диски всё равно надо
      if (waiting) {
        clearTimeout(hold);
        hold = window.setTimeout(() => {
          if (raf === 0) raf = requestAnimationFrame(sync);
        }, 60);
      }
    };

    let px = 0;
    let py = 0;
    const recompute = () => {
      const r = el.getBoundingClientRect();
      // переводим курсор в дробные координаты клетки
      const cx = ((px - r.left) / r.width) * cols - 0.5;
      const cy = ((py - r.top) / r.height) * GLYPH_H - 0.5;
      const next = new Set<number>();
      for (let y = 0; y < GLYPH_H; y++) {
        for (let x = 0; x < cols; x++) {
          const dx = x - cx;
          const dy = y - cy;
          if (dx * dx + dy * dy <= HOVER_R * HOVER_R) next.add(y * cols + x);
        }
      }
      want = next;
      sync();
    };

    const onMove = (e: PointerEvent) => {
      px = e.clientX;
      py = e.clientY;
      if (raf === 0) raf = requestAnimationFrame(recompute);
    };
    const onLeave = () => {
      want = new Set();
      sync();
    };

    // палец слушаем на ОКНЕ и пассивно, а не на самом табло: на элементе
    // touchmove приходит, только если касание на нём и началось, и палец,
    // ведущий страницу сверху вниз, прошёл бы по табло молча. пассивный
    // слушатель при этом не может отменить прокрутку
    const onTouch = (e: TouchEvent) => {
      const t = e.touches[0];
      if (!t) return;
      const box = el.getBoundingClientRect();
      const near =
        t.clientX >= box.left - 40 &&
        t.clientX <= box.right + 40 &&
        t.clientY >= box.top - 40 &&
        t.clientY <= box.bottom + 40;
      if (!near) {
        if (want.size) onLeave();
        return;
      }
      px = t.clientX;
      py = t.clientY;
      if (raf === 0) raf = requestAnimationFrame(recompute);
    };

    const opts = { passive: true } as const;
    el.addEventListener('pointermove', onMove);
    el.addEventListener('pointerleave', onLeave);
    window.addEventListener('touchstart', onTouch, opts);
    window.addEventListener('touchmove', onTouch, opts);
    window.addEventListener('touchend', onLeave, opts);
    return () => {
      cancelAnimationFrame(raf);
      clearTimeout(hold);
      el.removeEventListener('pointermove', onMove);
      el.removeEventListener('pointerleave', onLeave);
      window.removeEventListener('touchstart', onTouch);
      window.removeEventListener('touchmove', onTouch);
      window.removeEventListener('touchend', onLeave);
    };
  }, [cols]);

  return (
    <div
      ref={ref}
      className="v65-flipdisk"
      style={{ ['--v65-disk-cols' as string]: cols }}
      role="img"
      aria-label={value}
    >
      {grid.map((row, y) =>
        row.map((on, x) => (
          <Disk
            key={`${x}-${y}`}
            on={shown && on}
            // волна слева направо с наклоном по вертикали: табло
            // не переворачивается разом, а прокатывается, как настоящее
            delay={x * 26 + y * 12}
          />
        )),
      )}
    </div>
  );
}
