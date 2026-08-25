import { KEYS, STAB_KEYS, BOARD_WIDTH, BOARD_DEPTH } from './layout';

// общий буфер на всю клавиатуру, а не проп у каждого слоя: колпачки
// и свитчи живут в разных InstancedMesh, но ходить обязаны от одного
// источника, иначе колпачок оторвётся от своего штока. индексы как в KEYS
export type KeyLift = {
  /** текущая высота каждой клавиши в мировых единицах */
  y: Float32Array;
  /** куда клавиша едет; между target и y стоит пружина */
  target: Float32Array;
  /** растёт на каждом шаге со сдвигом: по нему слои решают, пересобирать
   *  ли матрицы */
  rev: number;
  /** центр наведения в координатах клавиатуры, null - курсор ушёл */
  point: { x: number; z: number } | null;
  /** насколько сильно поднялась самая высокая клавиша, 0…1 - этим гасится подсветка */
  peak: number;
  /**
   * во сколько раз шире обычного расплылось пятно света. под курсором это
   * лужа с ладонь и множитель равен единице, а волна от удара расходится
   * по всей плате - иначе свет останется точкой в месте падения, пока
   * клавиши поднимаются уже у другого края
   */
  glowR: number;
};

/** радиус влияния курсора: примерно две клавиши в каждую сторону */
export const LIFT_RADIUS = 2.0;
// подъём ближней клавиши. это больше реального хода, но клавиатура
// на первом экране показана целиком, и настоящие три миллиметра занимают
// там шесть пикселей - жеста не видно вовсе
export const LIFT_HEIGHT = 0.34;
/** свитч идёт следом, но заметно ниже - он лишь выглядывает из пластины */
export const SWITCH_FOLLOW = 0.3;

export function createKeyLift(size = KEYS.length): KeyLift {
  return {
    y: new Float32Array(size),
    target: new Float32Array(size),
    rev: 0,
    point: null,
    peak: 0,
    glowR: 1,
  };
}

/** удалённость от центра платы, 0 в середине и 1 у самой дальней клавиши */
function radii(keys: { x: number; z: number }[]): Float32Array {
  const r = new Float32Array(keys.length);
  let max = 0;
  for (let i = 0; i < keys.length; i++) {
    // делим на полугабариты: иначе по узкой оси волна не успевает разойтись
    // и фронт выходит не дугой, а вертикальной полосой
    r[i] = Math.hypot(keys[i].x / (BOARD_WIDTH / 2), keys[i].z / (BOARD_DEPTH / 2));
    if (r[i] > max) max = r[i];
  }
  for (let i = 0; i < r.length; i++) r[i] /= max || 1;
  return r;
}

export const KEY_RADIUS = radii(KEYS);
export const STAB_RADIUS = radii(STAB_KEYS);

// разлёт слоя дугой: пласт, который едет целиком, читается одной деталью,
// а от волны из центра сразу видно, что деталей там семь десятков.
// stagger - какая доля хода уходит на разброс стартов
export function fillWave(
  buf: KeyLift,
  amp: number,
  t: number,
  radius: Float32Array,
  // на половине хода волна читалась не дугой, а отдельным трюком: центр
  // уже наверху, края ещё внизу. нужен намёк, а не аттракцион
  stagger = 0.14,
) {
  const span = 1 - stagger;
  for (let i = 0; i < buf.y.length; i++) {
    const local = Math.min(1, Math.max(0, (t - radius[i] * stagger) / span));
    // ступенька, а не ease-out: деталь обязана и разгоняться, и тормозить
    // плавно, иначе слой трогается рывком на первом же щелчке
    buf.y[i] = amp * local * local * (3 - 2 * local);
  }
  buf.rev++;
}

/** до какого радиуса доходит фронт удара - весь габарит платы по диагонали */
export const IMPACT_REACH = Math.hypot(BOARD_WIDTH, BOARD_DEPTH);
/** толщина кольца: на скольких юнитах клавиша успевает подняться и опасть */
const IMPACT_RING = 4.2;
/** высота волны от удара - заметно выше подъёма под курсором */
export const IMPACT_HEIGHT = 0.42;

// от места посадки колпачка по плате расходится кольцо - именно кольцо,
// а не всплеск с затуханием. всплеск гас по расстоянию и обрывался на трёх
// с половиной юнитах: до краёв платы шириной в шестнадцать волна не доходила
// вовсе. фронт проходит ВСЮ плату, каждая клавиша поднимается, когда он до
// неё дошёл, а расстояние ослабляет волну лишь наполовину.
//
// высоты пишем напрямую, минуя пружину: у волны свой ход, и инерция пружины
// поверх него только смазала бы фронт
export function fillImpact(
  lift: KeyLift,
  point: { x: number; z: number },
  amount: number,
  reach = IMPACT_REACH,
  height = IMPACT_HEIGHT,
) {
  // фронт обязан дойти до самой дальней клавиши и полностью через неё пройти
  const front = amount * (reach + IMPACT_RING);
  for (let i = 0; i < KEYS.length; i++) {
    const key = KEYS[i];
    const d = Math.hypot(key.x - point.x, key.z - point.z);
    const local = (front - d) / IMPACT_RING;
    const pulse = local > 0 && local < 1 ? Math.sin(local * Math.PI) : 0;
    const fade = 1 - 0.45 * Math.min(1, d / reach);
    lift.y[i] = height * pulse * fade;
  }
  lift.point = amount > 0.001 && amount < 1 ? point : null;
  // свет разгорается и гаснет вместе с волной. от самой доли хода подсветка
  // вспыхивала на первом кадре и обрывалась в ноль на последнем - то самое
  // щёлканье выключателем
  lift.peak = Math.sin(Math.min(1, Math.max(0, amount)) * Math.PI);
  // пятно расходится вместе с фронтом, а не стоит точкой в месте падения
  lift.glowR = 1 + amount * 2.6;
  lift.rev++;
}

/** пересчитать цели под новое положение курсора */
export function aimKeyLift(lift: KeyLift, point: { x: number; z: number } | null) {
  lift.point = point;
  // под курсором пятно обычного размера: множитель волны сюда не тянем
  lift.glowR = 1;
  if (!point) {
    lift.target.fill(0);
    return;
  }
  for (let i = 0; i < KEYS.length; i++) {
    const key = KEYS[i];
    const dx = key.x - point.x;
    const dz = key.z - point.z;
    const d = Math.sqrt(dx * dx + dz * dz);
    const t = Math.max(0, 1 - d / LIFT_RADIUS);
    // ступенька, а не линейный конус: у конуса на границе радиуса излом,
    // и волна читается треугольником, а не холмом
    lift.target[i] = t * t * (3 - 2 * t) * LIFT_HEIGHT;
  }
}

/**
 * шаг пружины; true - что-то сдвинулось и кадр надо перерисовать. подъём
 * быстрее спада: клавиша обязана отзываться мгновенно, а опадать мягко
 */
export function stepKeyLift(lift: KeyLift, dt: number): boolean {
  // при возврате из фона dt приходит в десятых долях секунды, и пружина
  // проскакивает цель
  const step = Math.min(dt, 1 / 30);
  let moved = false;
  let peak = 0;
  for (let i = 0; i < lift.y.length; i++) {
    const to = lift.target[i];
    const from = lift.y[i];
    const diff = to - from;
    if (Math.abs(diff) > 1e-5) {
      const k = diff > 0 ? 17 : 9;
      lift.y[i] = from + diff * (1 - Math.exp(-k * step));
      moved = true;
    } else if (from !== to) {
      lift.y[i] = to;
      moved = true;
    }
    if (lift.y[i] > peak) peak = lift.y[i];
  }
  lift.peak = peak / LIFT_HEIGHT;
  if (moved) lift.rev++;
  return moved;
}
