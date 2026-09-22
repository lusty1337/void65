import { useEffect, useMemo, useRef, type MutableRefObject, type RefObject } from 'react';
import * as THREE from 'three';
import { useFrame, useThree, type ThreeEvent } from '@react-three/fiber';
import { BOARD_WIDTH, BOARD_DEPTH, KEYS } from '../keyboard/layout';
import { TRAY_WIDTH, TRAY_DEPTH } from '../keyboard/caseGeometry';
import { BASE_Y, THICKNESS } from '../keyboard/stack';
import { aimKeyLift, releaseAll, setPress, stepKeyLift, type KeyLift } from '../keyboard/keyLift';
import { keyOfCode } from '../keyboard/keyCodes';

// пятно кладём под самую подошву колпачка, а не на пластину: та на пять
// миллиметров ниже, и с пологого ракурса первого экрана свет читался ниткой
// в пиксель. заодно выходит как на клавиатуре с подсветкой - в покое пятно
// закрыто колпачками, поднялись клавиши, и свет видно
const GLOW_Y = BASE_Y.keycaps - THICKNESS.keycaps / 2 - 0.03;

/** предельный доворот за курсором - пара градусов, больше уже кривляние */
const TILT = (2.4 * Math.PI) / 180;

// сколько клавиши держатся поднятыми после касания. жеста "провести
// по клавишам" на телефоне нет: палец, ведомый по экрану, - это прокрутка,
// и страница уезжает раньше, чем зритель успевает что-то заметить. поэтому
// там работает касание, а поднятые клавиши стоят своё время сами
const TOUCH_HOLD = 620;

// пружину шагает только этот компонент, слои лишь сверяют счётчик:
// колпачки и свитчи читают один буфер, и если каждый шагнёт его сам,
// клавиша за кадр уедет вдвое дальше
export function KeyLiftDriver({
  lift,
  active,
  held,
}: {
  lift: KeyLift;
  /** наведение живёт только на первом экране; дальше клавиши обязаны стоять */
  active: MutableRefObject<boolean>;
  /**
   * буфер занят волной от удара - пружину не шагаем. иначе у массива два
   * хозяина: удар пишет высоты напрямую, пружина на том же кадре тянет их
   * к нулю, и волна выходит вдвое ниже и дёрганой
   */
  held: MutableRefObject<boolean>;
}) {
  const invalidate = useThree((s) => s.invalidate);
  const camera = useThree((s) => s.camera);
  const mesh = useRef<THREE.Mesh>(null);
  const local = useMemo(() => new THREE.Vector3(), []);

  /** до какого момента держать поднятыми клавиши под касанием */
  const hold = useRef(0);

  useFrame((_, dt) => {
    if (held.current) return;
    if (!active.current) {
      if (lift.point) aimKeyLift(lift, null);
      // клавиатура уехала с первого экрана с зажатой клавишей: отпускать
      // её некому, keyup придёт неизвестно когда
      if (lift.pressAt >= 0) releaseAll(lift);
    }
    if (hold.current && performance.now() > hold.current) {
      hold.current = 0;
      aimKeyLift(lift, null);
    }
    if (stepKeyLift(lift, dt)) invalidate();
  });

  // настоящая клавиатура под руками зрителя: та же клавиша проваливается
  // в модели. код приходит от ЖЕЛЕЗА, а не от раскладки, поэтому русская
  // раскладка попадает в ту же клавишу. ничего не отменяем - пробел
  // и стрелки обязаны и дальше прокручивать страницу
  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      if (e.repeat || !active.current || held.current) return;
      if (setPress(lift, keyOfCode(e.code), true)) invalidate();
    };
    const up = (e: KeyboardEvent) => {
      if (setPress(lift, keyOfCode(e.code), false)) invalidate();
    };
    // окно потеряло фокус - keyup не придёт вовсе, и клавиша осталась бы
    // утопленной до следующего нажатия
    const off = () => {
      if (releaseAll(lift)) invalidate();
    };
    window.addEventListener('keydown', down);
    window.addEventListener('keyup', up);
    window.addEventListener('blur', off);
    return () => {
      window.removeEventListener('keydown', down);
      window.removeEventListener('keyup', up);
      window.removeEventListener('blur', off);
    };
  }, [lift, active, held, invalidate]);

  // то же пальцем. через события R3F нельзя: канвасу для них нужен
  // pointer-events, а с ним он забирает жест, и страница перестаёт
  // прокручиваться ровно там, куда палец ложится. поэтому слушаем touch
  // на окне и ПАССИВНО - такой слушатель по определению не может отменить
  // прокрутку, браузер не ждёт от него решения. куда палец показывает,
  // считаем сами, лучом сквозь плоскость колпачков
  useEffect(() => {
    const ndc = new THREE.Vector2();
    const ray = new THREE.Raycaster();
    const plane = new THREE.Plane();
    const up = new THREE.Vector3(0, 1, 0);
    const hit = new THREE.Vector3();
    const at = new THREE.Vector3();

    const aimTouch = (e: TouchEvent) => {
      const parent = mesh.current?.parent;
      const t = e.touches[0];
      if (!parent || !t || !active.current || held.current) return;
      ndc.set(
        (t.clientX / window.innerWidth) * 2 - 1,
        -(t.clientY / window.innerHeight) * 2 + 1,
      );
      ray.setFromCamera(ndc, camera);
      // плоскость строим по живой матрице клавиатуры, а не по мировому
      // нулю: она уже начинает подниматься и заваливаться, и прибитая
      // к нулю плоскость промахнётся мимо колпачков
      plane.setFromNormalAndCoplanarPoint(up, parent.localToWorld(at.set(0, BASE_Y.keycaps, 0)));
      if (!ray.ray.intersectPlane(plane, hit)) return;
      parent.worldToLocal(hit);
      aimKeyLift(lift, { x: hit.x, z: hit.z });
      hold.current = performance.now() + TOUCH_HOLD;
      invalidate();
    };
    // палец убран - клавиши не падают следом: касание короче самой пружины
    // подъёма, и на мгновенном возврате от него оставалась одна дрожь
    const drop = () => {
      if (held.current || !lift.point) return;
      hold.current = performance.now() + TOUCH_HOLD;
      invalidate();
    };

    const opts = { passive: true } as const;
    window.addEventListener('touchstart', aimTouch, opts);
    window.addEventListener('touchmove', aimTouch, opts);
    window.addEventListener('touchend', drop, opts);
    window.addEventListener('touchcancel', drop, opts);
    return () => {
      window.removeEventListener('touchstart', aimTouch);
      window.removeEventListener('touchmove', aimTouch);
      window.removeEventListener('touchend', drop);
      window.removeEventListener('touchcancel', drop);
    };
  }, [camera, invalidate, lift, active, held]);

  const aim = (e: ThreeEvent<PointerEvent>) => {
    const parent = mesh.current?.parent;
    if (!parent || !active.current) return;
    local.copy(e.point);
    parent.worldToLocal(local);
    aimKeyLift(lift, { x: local.x, z: local.z });
    invalidate();
  };

  return (
    <mesh
      ref={mesh}
      position={[0, BASE_Y.keycaps, 0]}
      rotation={[-Math.PI / 2, 0, 0]}
      onPointerMove={aim}
      onPointerOut={() => {
        aimKeyLift(lift, null);
        invalidate();
      }}
    >
      {/* с запасом за габарит: волна у края должна начинаться ещё до того,
          как курсор доедет до крайней клавиши */}
      <planeGeometry args={[BOARD_WIDTH + 3, BOARD_DEPTH + 3]} />
      {/* прозрачный материал, а не visible={false}: невидимые объекты
          выпадают из перебора лучом */}
      <meshBasicMaterial transparent opacity={0} depthWrite={false} />
    </mesh>
  );
}

/** мягкое пятно с растушёванным краем - им светится сама пластина */
function makeGlowTexture() {
  const size = 128;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext('2d')!;
  const g = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  g.addColorStop(0, 'rgba(255,255,255,1)');
  g.addColorStop(0.28, 'rgba(255,255,255,0.62)');
  g.addColorStop(0.62, 'rgba(255,255,255,0.16)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, size, size);
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

// пятно режем по краям лотка: пластина кончается там же, где борт корпуса,
// а круглое пятно нет - у крайних клавиш половина повисала бы светящимся
// полумесяцем в воздухе
const CLIP_LOCAL = [
  new THREE.Plane(new THREE.Vector3(-1, 0, 0), TRAY_WIDTH / 2),
  new THREE.Plane(new THREE.Vector3(1, 0, 0), TRAY_WIDTH / 2),
  new THREE.Plane(new THREE.Vector3(0, 0, -1), TRAY_DEPTH / 2),
  new THREE.Plane(new THREE.Vector3(0, 0, 1), TRAY_DEPTH / 2),
];

// свет из-под приподнятых клавиш, цвета выбранного свитча. точечный
// источник светит снизу вверх и лепит подложку колпачка, проходя сквозь
// прозрачные колпаки; пятно на пластине - то, что видно в самой щели,
// и его цвет намеренно вылезает за единицу, чтобы попасть в блум
export function SwitchGlow({ lift, color }: { lift: KeyLift; color: string }) {
  const light = useRef<THREE.PointLight>(null);
  const spot = useRef<THREE.Mesh>(null);
  const gl = useThree((s) => s.gl);
  const tex = useMemo(makeGlowTexture, []);
  const hot = useMemo(() => new THREE.Color(color).multiplyScalar(3.6), [color]);
  const clip = useMemo(() => CLIP_LOCAL.map((p) => p.clone()), []);

  // без этого флага clippingPlanes на материале молча игнорируются
  gl.localClippingEnabled = true;

  useFrame(() => {
    const l = light.current;
    const s = spot.current;
    if (!l || !s) return;
    // нажатая клавиша забирает свет себе: это прицельный удар, а наведение
    // рядом - лишь присутствие руки
    const hit = lift.pressAt >= 0 ? KEYS[lift.pressAt] : null;
    const p = hit ?? lift.point;
    const k = hit ? Math.max(lift.pressK, lift.peak) : p ? lift.peak : 0;
    // источник никогда не гасим через visible: три пересобирает программы
    // всех материалов, когда меняется набор источников света, - секунды
    // линковки ровно в момент первого наведения. на яркость шейдер
    // не завязан
    l.intensity = k * 18;
    (s.material as THREE.MeshBasicMaterial).opacity = k;
    // пятно тоже не прячем: невидимый меш не рисуется, а значит и программа
    // его материала не собирается - она линковалась при первом наведении,
    // уже на живой странице. схлопнутое в точку пятно рисуется всегда
    // и компилируется под заставкой вместе со всей сценой
    if (!p || k <= 0.01) {
      s.scale.setScalar(0.0004);
      return;
    }
    const host = s.parent;
    if (host) {
      for (let i = 0; i < clip.length; i++) clip[i].copy(CLIP_LOCAL[i]).applyMatrix4(host.matrixWorld);
    }
    l.position.set(p.x, GLOW_Y + 0.04, p.z);
    s.position.set(p.x, GLOW_Y, p.z);
    // растёт вместе с волной: на слабом наведении точка под пальцем,
    // на полном лужа с ладонь. множитель приходит из буфера - у волны
    // от удара пятно расходится на всю плату. под нажатой клавишей оно
    // вдвое туже: свет обязан остаться в её щели, а не заливать соседей
    const r = (hit ? 0.42 : 0.7 + k * 0.3) * lift.glowR;
    s.scale.set(r, r, r);
    // источник тянется за пятном: иначе на разошедшейся волне он светит
    // в одну точку посреди поднявшегося кольца
    l.distance = 3.6 * lift.glowR;
  });

  return (
    <>
      {/* decay=2 обязателен: без затухания источник в тесном зазоре
          засветит всю клавиатуру, а не пятно под курсором */}
      <pointLight ref={light} color={color} intensity={0} distance={3.6} decay={2} />
      <mesh ref={spot} rotation={[-Math.PI / 2, 0, 0]} scale={0.0004}>
        <planeGeometry args={[4.2, 4.2]} />
        <meshBasicMaterial
          map={tex}
          color={hot}
          transparent
          opacity={0}
          blending={THREE.AdditiveBlending}
          depthWrite={false}
          toneMapped={false}
          clippingPlanes={clip}
        />
      </mesh>
    </>
  );
}

// клавиатура чуть доворачивается за курсором, и только вокруг вертикали:
// сторона, на которую показывают, выходит вперёд, и объект читается
// предметом на столе, а не картинкой, дёргающейся от мыши
export function CursorTilt({
  lift,
  group,
}: {
  lift: KeyLift;
  group: RefObject<THREE.Group>;
}) {
  const invalidate = useThree((s) => s.invalidate);

  useFrame((_, dt) => {
    const g = group.current;
    if (!g) return;
    const p = lift.point;
    const aim = p ? -THREE.MathUtils.clamp(p.x / (BOARD_WIDTH / 2), -1, 1) * TILT : 0;
    const from = g.rotation.y;
    if (Math.abs(aim - from) < 1e-4) {
      if (from !== aim) {
        g.rotation.y = aim;
        invalidate();
      }
      return;
    }
    // мягче пружины подъёма: доворот читается инерцией тяжёлой вещи
    g.rotation.y = from + (aim - from) * (1 - Math.exp(-4 * Math.min(dt, 1 / 30)));
    invalidate();
  });

  return null;
}
