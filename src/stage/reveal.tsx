import { useMemo, useRef, type MutableRefObject } from 'react';
import * as THREE from 'three';
import { useFrame } from '@react-three/fiber';
import { createRevealUniforms, patchReveal, REVEAL_MAX } from '../keyboard/revealWave';
import type { KeyboardLayers, LayerName } from '../keyboard/types';

// клавиатура проступает круговой волной из центра, слой за слоем снизу
// вверх. прозрачностью так нельзя: половина слоёв непрозрачна, а у стеклянных
// колпаков свитчей свой проход отрисовки, и они проявлялись бы не в черёд -
// поэтому волна режет фрагменты по расстоянию, прямо в шейдере материала.
//
// ходов два, с виду одинаковых: первый идёт по часам под заставкой, второй
// ведёт прокрутка - им в финале проступает клавиатура над ценой

/** снизу вверх: сначала корпус, последними колпачки */
const ORDER: LayerName[] = [
  'bottomCase',
  'pcb',
  'foam',
  'stabilizers',
  'switches',
  'plate',
  'keycaps',
];

// материал трогается не сразу: первым тактом входа по модели проходит
// каркас, и материал нарастает уже по нему. одновременно нельзя - каркас
// тогда не виден вовсе, он весь под материалом
const LEAD = 0.85;
/** через сколько после предыдущего слоя трогается следующий */
const STEP = 0.075;
/** сколько фронт идёт от центра до дальнего угла */
const SWEEP = 0.5;
/** весь ход волны от первого слоя до последнего */
const TOTAL = STEP * (ORDER.length - 1) + SWEEP;

export default function RevealWave({
  layers,
  shadow,
  start,
  scroll,
  onCompiled,
}: {
  layers: MutableRefObject<KeyboardLayers | null>;
  /** контактная тень: проявляется тем же фронтом, что и корпус под ней */
  shadow?: MutableRefObject<THREE.Object3D | null>;
  /** момент старта по performance.now(); null - волна ещё не запущена */
  start: MutableRefObject<number | null>;
  /**
   * ход волны от прокрутки: −1 выключено и видно всё, 0…1 - проявление.
   * проверка в шейдере стоит кадров, поэтому снята по умолчанию
   * и включается только на своём отрезке страницы
   */
  scroll: MutableRefObject<{ reveal: number }>;
  /**
   * все материалы прошиты и программы собраны. сигнал обязателен: правка
   * шейдера ставит needsUpdate, и три пересобирает КАЖДУЮ программу сцены.
   * на старте волны страница замирала на секунды ровно в момент ухода
   * заставки - волна проходила по часам, и клавиатура появлялась разом
   */
  onCompiled?: () => void;
}) {
  const uniforms = useMemo(() => ORDER.map(() => createRevealUniforms()), []);
  const done = useRef(false);
  const quiet = useRef(0);
  const compiled = useRef(false);
  /** держим ли мы сейчас включённой проверку ради прокрутки */
  const scrolled = useRef(false);

  /** расставить фронт по слоям: 0 не видно ничего, 1 видно всё */
  const sweep = (t: number) => {
    uniforms.forEach((u, i) => {
      u.uRevealOn.value = 1;
      const local = (t * TOTAL - i * STEP) / SWEEP;
      u.uRevealR.value = Math.max(0, Math.min(1, local)) * REVEAL_MAX;
    });
  };

  useFrame(({ invalidate }) => {
    const groups = layers.current;
    if (!groups) return;

    let fresh = 0;
    if (!done.current) {
      const patch = (root: THREE.Object3D | null | undefined, i: number) => {
        if (!root) return;
        root.traverse((o) => {
          const mesh = o as THREE.Mesh;
          if (!mesh.isMesh) return;
          const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
          for (const m of mats) if (m && patchReveal(m, uniforms[i])) fresh++;
        });
      };
      ORDER.forEach((name, i) => patch(groups[name], i));
      // тень идёт первым фронтом, вместе с корпусом
      patch(shadow?.current, 0);
    }

    // готовность: колпачки приехали, новых материалов нет, и с последней
    // правки прошло несколько кадров - их хватает драйверу на сборку
    // программ. кадры заказываем сами, канвас рисует по требованию
    if (!compiled.current) {
      const capsIn = (groups.keycaps?.children.length ?? 0) > 0;
      quiet.current = fresh || !capsIn ? 0 : quiet.current + 1;
      invalidate();
      if (quiet.current >= 4) {
        compiled.current = true;
        onCompiled?.();
      }
      return;
    }

    // пока входная волна не доиграла, прокрутка в проявление не лезет:
    // на первом экране её отрезка страницы всё равно нет
    if (!done.current) {
      const t0 = start.current;
      if (t0 === null) {
        for (const u of uniforms) u.uRevealR.value = 0;
        return;
      }
      const t = (performance.now() - t0) / 1000 - LEAD;
      if (t < TOTAL) {
        sweep(t / TOTAL);
        invalidate();
        return;
      }
      // прошла - снимаем проверку, чтобы не стоила кадров
      for (const u of uniforms) u.uRevealOn.value = 0;
      done.current = true;
      invalidate();
      return;
    }

    // проверку включаем обратно только на своём отрезке и гасим, едва
    // он кончился
    const t = scroll.current.reveal;
    if (t >= 0) {
      scrolled.current = true;
      sweep(t);
    } else if (scrolled.current) {
      scrolled.current = false;
      for (const u of uniforms) {
        u.uRevealOn.value = 0;
        u.uRevealR.value = REVEAL_MAX;
      }
    }
  });

  return null;
}
