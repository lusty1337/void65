import { Suspense, useEffect, useMemo, useRef, type MutableRefObject } from 'react';
import * as THREE from 'three';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import { StageRig } from './rig';
import { makeShot, shotAt, isHero, SEAT, SPREAD, P_LAND, DROP_INDEX } from './director';
import { CursorTilt, KeyLiftDriver, SwitchGlow } from './hover';
import RevealWave from './reveal';
import WireGhost from './ghost';
import { MAX_DPR, SHADOW_EVERY, SHADOW_KIND, WIREFRAME_INTRO } from './quality';
import { PremiumKeyboard } from '../keyboard/PremiumKeyboard';
import { BASE_Y } from '../keyboard/stack';
import { createKeyLift, fillImpact, fillWave, KEY_RADIUS, STAB_RADIUS } from '../keyboard/keyLift';
import { STAB_KEYS } from '../keyboard/layout';
import FallingKey from './fallingKey';
import { SWITCH_TINT } from '../keyboard/materials';
import type { KeyboardLayers, LayerName, SwitchType } from '../keyboard/types';

// единственная сцена сайта: канвас прибит к окну и лежит под всей
// страницей, клавиатура не начинается заново в каждой секции - она одна
// и та же. отсюда и свет один на весь сайт, и отсутствие стыков канваса
// с фоном, и главное: шейдеры собираются один раз. три отдельных канваса
// линковали свои программы по очереди и держали главный поток секундами
// уже на живой странице

/** слои, которые едут не пластом, а волной от центра */
const WAVY = new Set<LayerName>(['keycaps', 'switches', 'stabilizers']);

// ступенька с нулевой производной на обоих концах. ease-out трогается
// с максимальной скорости, и слой начинал ехать рывком: щелчок колеса,
// мгновенный старт, долгое дотормаживание
const ease = (t: number) => {
  const x = Math.min(1, Math.max(0, t));
  return x * x * (3 - 2 * x);
};
const clamp01 = (t: number) => Math.min(1, Math.max(0, t));

/** куда падает сорвавшийся колпачок - от него же расходится волна удара */
const LANDING = { x: SEAT.x, z: SEAT.z };

// сколько живёт волна от удара. к прокрутке не привязана намеренно:
// колпачок ударился - волна доиграла до конца, даже если зритель
// остановился. на прокрутке она замирала посреди хода и читалась
// не ударом, а ползунком
const IMPACT_SEC = 1.5;

function Rig({
  progress,
  maxScroll,
  switchType,
  revealStart,
  floor,
  onCompiled,
}: {
  progress: MutableRefObject<number>;
  /** прокручиваемая высота документа; её меряет страница, а не сцена */
  maxScroll: MutableRefObject<number>;
  switchType: SwitchType;
  revealStart: MutableRefObject<number | null>;
  /** пол, ловящий тень: волна проявления прошивает и его */
  floor: MutableRefObject<THREE.Mesh | null>;
  onCompiled: () => void;
}) {
  const camera = useThree((s) => s.camera) as THREE.PerspectiveCamera;
  const invalidate = useThree((s) => s.invalidate);
  const gl = useThree((s) => s.gl);
  const layers = useRef<KeyboardLayers>(null);
  const tilt = useRef<THREE.Group>(null);
  const flight = useRef<THREE.Group>(null);
  // щелчок колеса - скачок на сотню пикселей, и камера на сырой позиции
  // отрабатывает его рывком. здесь значение догоняет цель по экспоненте,
  // и разгон с торможением получаются сами
  const smooth = useRef(-1);
  /** момент удара по performance.now(); null - волна не идёт */
  const struck = useRef<number | null>(null);
  /** пока волна идёт, пружину наведения не трогаем: буфер занят ударом */
  const held = useRef(false);
  /** какое гнездо сейчас пустует: слой колпачков читает это число сам */
  const loose = useRef(-1);
  /** счётчик кадров - по нему на лёгком уровне прореживается карта теней */
  const tick = useRef(0);

  // без этого рендерер перерисует карту сам, и прореживание ничего не даст
  if (SHADOW_EVERY > 1) gl.shadowMap.autoUpdate = false;

  const shot = useMemo(makeShot, []);
  // тот же объект в виде рефа: снаружи удобнее читать .current, а сам кадр
  // пересчитывается на месте
  const shotRef = useRef(shot);
  const lift = useMemo(() => createKeyLift(), []);
  const heroActive = useRef(true);
  // по буферу на слой: у колпачков, свитчей и стабилизаторов свои амплитуды
  // и свои отрезки хода
  const wave = useMemo(
    () => ({
      keycaps: createKeyLift(),
      switches: createKeyLift(),
      stabilizers: createKeyLift(STAB_KEYS.length),
    }),
    [],
  );

  // наружу для headless-проверки: картинки там нет, и убедиться, что
  // клавиши реально едут, можно только прочитав числа
  (window as unknown as Record<string, unknown>).__heroLift = lift;

  useFrame((_, dt) => {
    if (SHADOW_EVERY > 1) {
      tick.current += 1;
      gl.shadowMap.needsUpdate = tick.current % SHADOW_EVERY === 0;
    }
    // прокрутку читаем здесь, на кадре, а не в обработчике scroll: событие
    // и кадр браузера идут вразнобой, за один кадр событий может не прийти
    // ни одного, а может прийти два. камера на значении из обработчика
    // повторяет этот разнобой мелкими рывками, хотя прокрутка ровная.
    // чтение scrollY на кадре не стоит ничего - это не пересчёт вёрстки
    const max = maxScroll.current;
    const target = max > 0 ? Math.min(1, Math.max(0, window.scrollY / max)) : 0;
    progress.current = target;
    if (smooth.current < 0) smooth.current = target;
    const k = 1 - Math.exp(-6.5 * Math.min(dt, 1 / 30));
    const before = smooth.current;
    if (Math.abs(target - smooth.current) > 2e-4) {
      smooth.current += (target - smooth.current) * k;
      invalidate();
    } else {
      smooth.current = target;
    }
    const p = smooth.current;

    // ловим именно пересечение отметки, а не попадание в окрестность:
    // на обратном ходу удар обязан отыграться так же, а окрестность
    // на быстрой прокрутке проскакивается
    if (before < P_LAND !== p < P_LAND) struck.current = performance.now();

    shotAt(p, camera.fov, camera.aspect, shot);
    heroActive.current = isHero(p);
    loose.current = shot.keyLoose > 0.5 ? DROP_INDEX : -1;

    camera.position.copy(shot.pos);
    camera.lookAt(shot.look);

    // опрокидывание, подъём и разворот всей клавиатуры целиком
    if (flight.current) {
      flight.current.position.y = shot.boardY;
      flight.current.rotation.x = shot.boardTilt;
      flight.current.rotation.y = shot.boardYaw;
    }

    // колпачок летит в пустоте, и без наклона горизонта в кадре не за что
    // зацепиться глазу
    if (shot.roll) camera.rotateZ(shot.roll);

    // волна идёт по своим часам, и пока идёт, буфер подъёма принадлежит
    // ей одной - иначе пружина наведения затирала бы её каждый кадр
    if (struck.current !== null) {
      const age = (performance.now() - struck.current) / (IMPACT_SEC * 1000);
      held.current = true;
      if (age < 1) {
        fillImpact(lift, LANDING, age);
        invalidate();
      } else {
        fillImpact(lift, LANDING, 0);
        struck.current = null;
        held.current = false;
        invalidate();
      }
    }

    SPREAD.forEach((layer, i) => {
      const g = layers.current?.[layer.key];
      if (!g) return;
      // в разборке каждый слой едет в своём отрезке, отрезки идут подряд -
      // та же сетка, по которой раскрывается список справа. на общем разлёте
      // пластина ползла вверх, пока колпачки ещё снимались. в сборке
      // отрезков нет, все слои сходятся одновременно
      const drive =
        shot.gather >= 0
          ? 1 - shot.gather
          : ease(clamp01(shot.apart * SPREAD.length - i));

      if (WAVY.has(layer.key)) {
        // слой стоит, едут его детали: иначе волна сложится с ходом пласта
        // и центральные клавиши уедут вдвое дальше
        g.position.y = BASE_Y[layer.key];
        // разброс стартов только в разборке. в сборке он ломал порядок
        // стопки: крайние стабилизаторы приходили домой раньше пены, которая
        // едет пластом, и на середине хода ныряли сквозь неё
        const stagger = shot.gather >= 0 ? 0 : undefined;
        if (layer.key === 'stabilizers')
          fillWave(wave.stabilizers, layer.y, drive, STAB_RADIUS, stagger);
        else fillWave(wave[layer.key as 'keycaps' | 'switches'], layer.y, drive, KEY_RADIUS, stagger);
      } else {
        // высоту берём из стека, а не из текущей позиции: иначе смещение
        // прибавится к уже смещённому и слой уедет в бесконечность
        g.position.y = BASE_Y[layer.key] + layer.y * drive;
      }
    });
  });

  return (
    <>
      {/* внешняя группа - перелёт, внутренняя - доворот за курсором.
          смешать их нельзя: доворот обязан остаться вокруг ВЕРТИКАЛИ
          объекта, а не вокруг наклонённой оси */}
      <group ref={flight}>
        <group ref={tilt}>
          {/* драйвер первым: он шагает пружину, слои переписывают матрицы
              по её счётчику - иначе отстанут на кадр */}
          <KeyLiftDriver lift={lift} active={heroActive} held={held} />
          <CursorTilt lift={lift} group={tilt} />
          <SwitchGlow lift={lift} color={SWITCH_TINT[switchType]} />
          <Suspense fallback={null}>
            <PremiumKeyboard
              ref={layers}
              switchType={switchType}
              defaultLights={false}
              lift={lift}
              spread={wave}
              loose={loose}
            />
          </Suspense>
        </group>
      </group>
      {/* в мировых координатах, а не вместе с клавиатурой: в том и смысл,
          что клавиатура улетела, а он остался */}
      <Suspense fallback={null}>
        <FallingKey shot={shotRef} />
      </Suspense>
      {/* каркас идёт первым тактом входа, материал - вторым */}
      {WIREFRAME_INTRO && <WireGhost layers={layers} start={revealStart} />}
      <RevealWave
        layers={layers}
        shadow={floor}
        start={revealStart}
        scroll={shotRef}
        onCompiled={() => {
          onCompiled();
          invalidate();
        }}
      />
    </>
  );
}

export default function Stage({
  progress,
  maxScroll,
  redraw,
  switchType,
  revealStart,
  onCompiled,
}: {
  /** доля прокрутки 0→1; реф, а не проп - он меняется каждый кадр */
  progress: MutableRefObject<number>;
  /** прокручиваемая высота документа */
  maxScroll: MutableRefObject<number>;
  /** сюда канвас кладёт свой "перерисуй" */
  redraw: MutableRefObject<(() => void) | null>;
  switchType: SwitchType;
  revealStart: MutableRefObject<number | null>;
  onCompiled: () => void;
}) {
  const floor = useRef<THREE.Mesh | null>(null);

  return (
    <div className="v-stage" aria-hidden="true">
      <Canvas
        camera={{ position: [0.9, 4.6, 13.2], fov: 26 }}
        gl={{ antialias: true, alpha: true }}
        dpr={MAX_DPR}
        shadows={SHADOW_KIND}
        // сцена статична, пока не крутят колесо и не водят курсором.
        // непрерывный режим на неподвижной картинке - это девятнадцать
        // тысяч вызовов отрисовки в секунду и раскрученный вентилятор
        frameloop="demand"
        flat
      >
        <StageRig floorRef={floor} />
        <Expose into={redraw} />
        <Rig
          progress={progress}
          maxScroll={maxScroll}
          switchType={switchType}
          revealStart={revealStart}
          floor={floor}
          onCompiled={onCompiled}
        />
      </Canvas>
    </div>
  );
}

/** отдаёт наружу "перерисуй" именно этого канваса */
function Expose({ into }: { into: MutableRefObject<(() => void) | null> }) {
  const invalidate = useThree((s) => s.invalidate);
  useEffect(() => {
    into.current = invalidate;
    invalidate();
    return () => {
      into.current = null;
    };
  }, [invalidate, into]);
  return null;
}
