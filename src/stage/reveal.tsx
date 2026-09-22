import { useMemo, useRef, type MutableRefObject } from 'react';
import * as THREE from 'three';
import { useFrame, useThree } from '@react-three/fiber';
import { createRevealUniforms, revealTwin, REVEAL_MAX } from '../keyboard/revealWave';
import type { KeyboardLayers, LayerName } from '../keyboard/types';

// клавиатура проступает круговой волной из центра, слой за слоем снизу
// вверх. прозрачностью так нельзя: половина слоёв непрозрачна, а у стеклянных
// колпаков свитчей свой проход отрисовки, и они проявлялись бы не в черёд -
// поэтому волна режет фрагменты по расстоянию, прямо в шейдере материала.
//
// ходов два, с виду одинаковых: первый идёт по часам под заставкой, второй
// ведёт прокрутка - им в финале проступает клавиатура над ценой.
//
// режет не сам материал, а его двойник (revealWave.ts), и надет двойник
// только пока волна идёт. всё остальное время на мешах обычные материалы
// без discard, и видеокарта отбрасывает спрятанное до закраски

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

/** меш и оба его набора материалов: обычный и с волной */
type Dress = {
  mesh: THREE.Mesh;
  plain: THREE.Material | THREE.Material[];
  wave: THREE.Material | THREE.Material[];
};

export default function RevealWave({
  layers,
  shadow,
  start,
  scroll,
  onProgress,
  onCompiled,
}: {
  layers: MutableRefObject<KeyboardLayers | null>;
  /** контактная тень: проявляется тем же фронтом, что и корпус под ней */
  shadow?: MutableRefObject<THREE.Object3D | null>;
  /** момент старта по performance.now(); null - волна ещё не запущена */
  start: MutableRefObject<number | null>;
  /**
   * ход волны от прокрутки: −1 выключено и видно всё, 0…1 - проявление.
   * двойники стоят кадров, поэтому надеваются только на своём отрезке
   * страницы
   */
  scroll: MutableRefObject<{ reveal: number }>;
  /**
   * ход подготовки сцены, 0…1 - его показывает полоса на заставке. шагов
   * ровно столько, сколько здесь настоящих событий: приехали колпачки,
   * и дальше по одному на каждый тихий кадр сборки программ
   */
  onProgress?: (value: number) => void;
  /**
   * программы двойников собраны, вход можно начинать. сигнал обязателен:
   * первая отрисовка нового шейдера держит главный поток, и на старте волны
   * страница замирала на секунды ровно в момент ухода заставки - волна
   * проходила по часам, и клавиатура появлялась разом
   */
  onCompiled?: () => void;
}) {
  const gl = useThree((s) => s.gl);
  const scene = useThree((s) => s.scene);
  const camera = useThree((s) => s.camera);
  const redraw = useThree((s) => s.invalidate);
  const uniforms = useMemo(() => ORDER.map(() => createRevealUniforms()), []);
  const done = useRef(false);
  const quiet = useRef(0);
  const compiled = useRef(false);
  /** надеты ли сейчас двойники ради прокрутки */
  const scrolled = useRef(false);
  const dressed = useRef<Dress[]>([]);
  const known = useMemo(() => new WeakSet<THREE.Object3D>(), []);
  /** что надето сейчас: true - двойники с волной */
  const worn = useRef(false);
  /** программы обычных материалов собраны, двойников можно снимать */
  const plainReady = useRef(false);
  /** что уже сказано наружу: иначе заставка перерисовывалась бы каждый кадр */
  const told = useRef(-1);

  // с этим расширением драйвер линкует программы в своих потоках, и спросить
  // о готовности можно, не останавливая страницу
  const parallel = useMemo(() => gl.extensions.has('KHR_parallel_shader_compile'), [gl]);

  const wear = (wave: boolean) => {
    worn.current = wave;
    for (const d of dressed.current) d.mesh.material = wave ? d.wave : d.plain;
  };

  // обычные материалы собираются в фоне, пока идёт вход. под заставкой
  // собирать обе программы каждого материала нельзя: на замере это растягивало
  // её в полтора раза, а вход всё равно идёт в двойниках.
  //
  // собираем в буфер, а не в экран: от того, куда идёт отрисовка, зависит
  // цветовое пространство программы, а сцена рисуется в буфер композера.
  // программа, собранная под экран, в кадре не пригодилась бы
  const compilePlain = () => {
    const target = new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType });
    const prev = gl.getRenderTarget();
    wear(false);
    gl.setRenderTarget(target);
    // изнанку двустороннего стекла три рисует в буфер преломления отдельной
    // программой, со стороной BackSide. compile про неё не знает, и она
    // линковалась бы на живой странице: на замере это секунда стоящего потока
    const flips = dressed.current
      .flatMap((d) => (Array.isArray(d.plain) ? d.plain : [d.plain]))
      .filter((m) => (m as THREE.MeshPhysicalMaterial).transmission > 0 && m.side === THREE.DoubleSide);
    for (const m of flips) {
      m.side = THREE.BackSide;
      m.needsUpdate = true;
    }
    const back = gl.compileAsync(scene, camera);
    for (const m of flips) {
      m.side = THREE.DoubleSide;
      m.needsUpdate = true;
    }
    const front = gl.compileAsync(scene, camera);
    gl.setRenderTarget(prev);
    wear(true);
    Promise.all([back, front]).then(() => {
      plainReady.current = true;
      target.dispose();
      redraw();
    });
  };

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
          if (!mesh.isMesh || known.has(mesh)) return;
          known.add(mesh);
          const plain = mesh.material;
          const wave = Array.isArray(plain)
            ? plain.map((m) => revealTwin(m, uniforms[i]))
            : revealTwin(plain, uniforms[i]);
          dressed.current.push({ mesh, plain, wave });
          // догрузившийся меш сразу в том же наряде, что и соседи
          if (worn.current) mesh.material = wave;
          fresh++;
        });
      };
      ORDER.forEach((name, i) => patch(groups[name], i));
      // тень идёт первым фронтом, вместе с корпусом
      patch(shadow?.current, 0);
    }

    // готовность: колпачки приехали, новых мешей нет, и с последнего
    // прошло несколько кадров - их хватает драйверу на сборку программ.
    // кадры заказываем сами, канвас рисует по требованию.
    //
    // без фоновой сборки наряды под заставкой чередуются: иначе программа
    // обычного материала слинкуется уже на живой странице, в момент первой
    // смены, и встанет весь поток
    if (!compiled.current) {
      const capsIn = (groups.keycaps?.children.length ?? 0) > 0;
      quiet.current = fresh || !capsIn ? 0 : quiet.current + 1;
      // наружу отдаём ровно то, что знаем: сколько слоёв уже в сцене,
      // а когда все семь собраны - сколько тихих кадров простояла сборка
      // программ. ни одного числа от таймера
      const inScene = ORDER.filter((name) => (groups[name]?.children.length ?? 0) > 0).length;
      const step = capsIn
        ? 0.5 + 0.5 * Math.min(1, quiet.current / 4)
        : 0.5 * (inScene / ORDER.length);
      if (step !== told.current) {
        told.current = step;
        onProgress?.(step);
      }
      wear(parallel || quiet.current % 2 === 1);
      invalidate();
      if (quiet.current >= 4) {
        compiled.current = true;
        if (parallel) compilePlain();
        else plainReady.current = true;
        wear(true);
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
      // прошла, но обычные материалы ещё собираются - остаёмся в двойниках
      // с раскрытым фронтом и ждём. кадр закажет сама сборка, когда кончится
      if (!plainReady.current) {
        sweep(1);
        return;
      }
      // снимаем двойников, чтобы не стоили кадров
      for (const u of uniforms) u.uRevealOn.value = 0;
      wear(false);
      done.current = true;
      invalidate();
      return;
    }

    // двойников надеваем обратно только на своём отрезке и снимаем, едва
    // он кончился
    const t = scroll.current.reveal;
    if (t >= 0) {
      if (!scrolled.current) wear(true);
      scrolled.current = true;
      sweep(t);
    } else if (scrolled.current) {
      scrolled.current = false;
      wear(false);
      for (const u of uniforms) {
        u.uRevealOn.value = 0;
        u.uRevealR.value = REVEAL_MAX;
      }
    }
  });

  return null;
}
