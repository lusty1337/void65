import { useRef } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import { DPR_STEPS } from './quality';

// плотность пикселей подстраивается под то, что железо тянет на деле.
// уровень качества при загрузке угадывается по признакам, а для них
// восьмиядерный бюджетник с тачскрином такой же телефон, как флагман.
// здесь решает замер: кадры идут медленно - сцена спускается на ступень.
//
// только вниз. вернувшись на ступень, где кадр уже не успевал, сцена снова
// споткнётся, и резкость начнёт мигать туда-сюда.
//
// меряем только соседние кадры: сцена рисует по требованию, между жестами
// кадров нет вовсе, и пауза в секунду - это не медленный кадр

/** кадров в окне замера */
const WINDOW = 20;
// медиана окна хуже этого - кадр не укладывается в 60 Гц и через раз ждёт
// следующего обновления экрана. на 90 и 120 Гц просадка до 60 сюда
// не попадает, и это верно: 60 кадров сцене хватает
const SLOW_MS = 24;
/** промежуток длиннее - это уже пауза между жестами, а не кадр */
const GAP_MS = 120;
/** медленных окон подряд до спуска: одно бывает и от сборки мусора */
const PATIENCE = 2;

export function AdaptiveResolution({ onDrop }: { onDrop: (dpr: number) => void }) {
  const dpr = useThree((s) => s.viewport.dpr);
  const last = useRef(0);
  const samples = useRef<number[]>([]);
  const slow = useRef(0);

  useFrame(() => {
    const now = performance.now();
    const dt = now - last.current;
    last.current = now;
    if (dt > GAP_MS) return;

    const buf = samples.current;
    buf.push(dt);
    if (buf.length < WINDOW) return;
    buf.sort((a, b) => a - b);
    const median = buf[WINDOW >> 1];
    buf.length = 0;

    slow.current = median > SLOW_MS ? slow.current + 1 : 0;
    if (slow.current < PATIENCE) return;
    slow.current = 0;
    const next = DPR_STEPS.find((s) => s < dpr - 0.01);
    if (next !== undefined) onDrop(next);
  });

  return null;
}
