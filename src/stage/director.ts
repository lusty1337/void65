import * as THREE from 'three';
import { actAt, START, SPAN } from './acts';
import { KEYS, ROW_STEP } from '../keyboard/layout';
import { BASE_Y } from '../keyboard/stack';
import type { LayerName } from '../keyboard/types';

// кадр сцены на любой точке прокрутки: где камера, где клавиатура, где
// летит сорвавшийся колпачок, насколько разъехались слои.
//
// кадр задан НЕ координатами камеры, а направлением съёмки, габаритом,
// который должен поместиться, и точкой взгляда - дистанцию решает
// fitDistance по пропорциям окна. зашитые координаты работали ровно на
// одном размере экрана: канвас во всё окно, и на широком мониторе та же
// позиция давала клавиатуру во весь кадр, а на узком точку вдали.
//
// состояния и времени здесь нет. сглаживание живёт снаружи: прокрутка
// приходит сюда уже размазанной, поэтому разгон, торможение и зеркальный
// обратный ход получаются сами, без единой отдельной строчки

export type Shot = {
  pos: THREE.Vector3;
  look: THREE.Vector3;
  /** разлёт стопки: 0 собрано, 1 полностью врозь */
  apart: number;
  /**
   * сборка на свитчи: −1 её нет и слои идут по очереди своими отрезками,
   * 0…1 - все сходятся ОДНОВРЕМЕННО. разбирать надо по одному, каждый слой
   * там отдельная мысль, а собирать по одному нечего: одновременный сход
   * читается как "встало на место", а не как перемотка разборки назад
   */
  gather: number;
  /** подъём всей клавиатуры */
  boardY: number;
  /** заваливание к зрителю вокруг X: 0 клавиши вверх, π/2 лицом к зрителю */
  boardTilt: number;
  /** разворот влево вокруг вертикали - им клавиатура кувыркается в финале */
  boardYaw: number;
  /**
   * крен камеры вокруг оси съёмки. нужен ровно в падении: колпачок летит
   * в пустоте, вокруг нет ни одной прямой, и ровный кадр читается
   * неподвижным, как бы быстро объект ни падал
   */
  roll: number;
  /** мировое положение сорвавшегося колпачка */
  keyPos: THREE.Vector3;
  /**
   * насколько колпачок остался один: 0 клавиатура ещё рядом, 1 она ушла.
   * по нему разгорается его собственный источник света - в полную силу
   * у самой платы тот выжигал гнездо и соседние клавиши в белое пятно
   */
  keyFree: number;
  /** его кувырок */
  keyRot: THREE.Euler;
  /** 0 - колпачок сидит в раскладке, 1 - живёт сам по себе */
  keyLoose: number;
  /** проявление: −1 выключено и видно всё, 0…1 - ход волны над ценой */
  reveal: number;
};

/** сглаженная ступенька: производная нулевая на обоих концах */
const s = (t: number) => {
  const x = Math.min(1, Math.max(0, t));
  return x * x * (3 - 2 * x);
};
const seg = (t: number, a: number, b: number) => s((t - a) / (b - a));
/** линейный отрезок без сглаживания - для того, что обязано идти равномерно */
const ramp = (t: number, a: number, b: number) => Math.min(1, Math.max(0, (t - a) / (b - a)));
const clamp01 = (t: number) => Math.min(1, Math.max(0, t));
const lerp = THREE.MathUtils.lerp;

/** обратная сглаженная ступенька: на какой доле хода s(x) даёт v */
function invSmooth(v: number): number {
  let lo = 0;
  let hi = 1;
  for (let i = 0; i < 30; i++) {
    const mid = (lo + hi) / 2;
    if (s(mid) < v) lo = mid;
    else hi = mid;
  }
  return (lo + hi) / 2;
}

/** габарит собранной клавиатуры по корпусу */
const BOARD = { w: 16.8, h: 1.4, d: 5.7 };

// на сколько юнитов слой уезжает при полном разлёте. лежит здесь, а не
// в сцене: это раскадровка, и от этих же чисел считается подъём клавиатуры
// в финале - иначе слой свитчей не останется стоять на месте
export const SPREAD: { key: LayerName; y: number }[] = [
  { key: 'keycaps', y: 4.8 },
  { key: 'plate', y: 3.6 },
  { key: 'switches', y: 2.6 },
  { key: 'stabilizers', y: 1.9 },
  { key: 'foam', y: 1.25 },
  { key: 'pcb', y: 0.62 },
  // база отъезжает вниз: иначе последний шаг разборки выглядит так, будто
  // ничего не произошло
  { key: 'bottomCase', y: -0.6 },
];

/** на сколько растёт стопка в полной разборке */
const SPREAD_H = 5.4;
/** куда уезжает слой свитчей - он же точка сборки в финале */
const SWITCH_SPREAD = SPREAD.find((l) => l.key === 'switches')!.y;

// первый экран: клавиатура заваливается к зрителю и одновременно
// поднимается, а на вертикали с неё срывается колпачок. подъём быстрее
// поворота намеренно - колпачку нужна высота, с которой есть куда падать
/** до скольки заваливается клавиатура - 135 градусов, заметно за вертикаль */
const TILT_MAX = (135 * Math.PI) / 180;
/** доля акта, на которой поворот закончен */
const TILT_SPAN = 0.86;
/** подъём к моменту срыва колпачка */
const LIFT_H = 9.2;
const LIFT_SPAN = 0.55;
/** сколько клавиатура добирает вверх уже после срыва, уходя за кадр */
const EXIT_H = 11;

const heroTilt = (local: number) => s(local / TILT_SPAN) * TILT_MAX;
const heroLift = (local: number) =>
  s(local / LIFT_SPAN) * LIFT_H + seg(local, LIFT_SPAN, 1) * EXIT_H;

/** доля акта, на которой наклон проходит вертикаль - считаем, а не подбираем */
const RELEASE_LOCAL = invSmooth(Math.PI / 2 / TILT_MAX) * TILT_SPAN;

// клавиша выбирается случайно при каждой загрузке и только квадратная:
// с широкой вроде enter колпачок читался бы куском корпуса, а не деталью
const SQUARE = KEYS.map((key, index) => ({ key, index })).filter(
  (e) => e.key.w === 1 && !e.key.stab && e.key.legend,
);
const PICK = SQUARE[Math.floor(Math.random() * SQUARE.length)] ?? { key: KEYS[0], index: 0 };

export const DROP_KEY = PICK.key;
/** индекс в KEYS: по нему слой колпачков гасит своё гнездо, а атлас берёт легенду */
export const DROP_INDEX = PICK.index;

/** посадочное место колпачка в координатах клавиатуры */
export const SEAT = {
  x: PICK.key.x,
  y: BASE_Y.keycaps + ROW_STEP[PICK.key.row],
  z: PICK.key.z,
};

/** наклон клавиатуры в момент срыва - ровно вертикаль */
const RELEASE_TILT = Math.PI / 2;

// мировое положение гнезда в момент срыва: локальная точка, повёрнутая
// вместе с клавиатурой и поднятая на её высоту. считаем, а не задаём
// числом, иначе колпачок появится рядом со своим местом, а не ровно в нём
const BIRTH = new THREE.Vector3(
  SEAT.x,
  SEAT.y * Math.cos(RELEASE_TILT) - SEAT.z * Math.sin(RELEASE_TILT) + heroLift(RELEASE_LOCAL),
  SEAT.y * Math.sin(RELEASE_TILT) + SEAT.z * Math.cos(RELEASE_TILT),
);

/** доля прокрутки, на которой колпачок срывается */
const P_RELEASE = START.hero + SPAN.hero * RELEASE_LOCAL;
/** доля прокрутки, на которой он приземляется: ровно на стыке с разборкой */
export const P_LAND = START.build;

/** сколько оборотов колпачок делает за полёт; кратно 2π - иначе он ляжет углом */
const SPIN_X = Math.PI * 6 - RELEASE_TILT;
/** насколько его сносит вбок по дуге: падает не отвесно, а как выброшенный */
const ARC_X = 0.9;
const ARC_Z = 0.6;

// доля траектории на хвост первого экрана. колпачок срывается на
// вертикали, но акт после этого длится ещё половину высоты, и всё это
// время он не падает, а отделяется. на линейном времени он успевал
// провернуться на треть кувырка, ещё стоя на свитче: путь падения идёт
// как квадрат и в начале незаметен, а вращение шло равномерно
const PEEL_SHARE = 0.09;

// какая ДОЛЯ отделения уходит на выход из гнезда: всё это время колпачок
// ещё принадлежит клавиатуре и едет вместе с ней. дальше он сам по себе,
// и к этому моменту она успевает уйти настолько, что дотянуться до него
// соседними клавишами уже не может
const GRIP = 0.55;

// на сколько колпачок выходит из гнезда. клавиатура в этот момент стоит
// вертикально, поэтому "вверх из шахты" - это на зрителя. без выхода
// заваливающаяся дальше клавиатура прошивала его соседними клавишами
const POP_OUT = 0.85;

// кадр на одном колпачке. крупный, но не во весь экран: вплотную он
// переставал читаться клавишей и становился просто серым брусом
const KEY_BOX = { w: 2.5, h: 2.2, d: 2.5 };
/** кадр в момент приземления: клавиатура вошла, колпачок садится в неё */
const LAND_SHOT = { yaw: 24, elev: 18, margin: 1.1, w: 13, h: 4.2, d: 6.2, lookY: 0.9, rise: 0.02 };
// два набора кадров, широкий и портретный. на широком экране текст стоит
// СБОКУ от клавиатуры и её надо увести в левую половину, на узком он
// ложится ПОД неё и уводить надо вверх, а по ширине отдать всё. отсюда
// и разные запасы: широкий кадр ограничен высотой, и 1.12 там читается
// воздухом, а узкий ограничен шириной - тот же запас оставил бы полоску
// посреди пустого экрана
/** кадр разборки: клавиатура занимает левую половину, справа список слоёв */
const BUILD_WIDE = { yaw: 30, elev: 23, margin: 1.12, lookX: 4.1, rise: 0.03 };
// он же на телефоне набок: список слоёв там занимает половину ширины,
// и стопку приходится уводить дальше влево, чем на десктопе
const BUILD_SHORT = { yaw: 30, elev: 23, margin: 1.2, lookX: 6.2, rise: 0.03 };
/** он же в портрете: клавиатура во всю ширину и выше центра, текст под ней */
const BUILD_TALL = { yaw: 26, elev: 26, margin: 1.03, lookX: 0, rise: -0.11 };
/** общий план финала, на нём клавиатуру подбрасывает */
const HOME_WIDE = { yaw: 8, elev: 16, margin: 1.24, lookY: SWITCH_SPREAD + 0.7, rise: 0.02 };
const HOME_TALL = { yaw: 8, elev: 16, margin: 1.03, lookY: SWITCH_SPREAD + 0.7, rise: -0.02 };
/** кадр цены: вторая клавиатура стоит в ВЕРХНЕЙ половине, под ней счётчик */
const PRICE_WIDE = { yaw: 5, elev: 18, margin: 1.34, lookY: 0.9, rise: -0.1 };
// на телефоне набок под клавиатурой стоят и счётчик, и кнопка, и строки
// характеристик: предмет уходит выше и мельче, иначе он ложится на них
const PRICE_SHORT = { yaw: 5, elev: 18, margin: 1.62, lookY: 0.9, rise: -0.34 };
// в портрете уводим заметно выше и до самого низа страницы. причина
// не в композиции: снизу стоит панель браузера, видимая часть окна короче
// документа, и на последних процентах цена подъезжала прямо под модель
const PRICE_TALL = { yaw: 5, elev: 18, margin: 1.03, lookY: 0.9, rise: -0.34 };

// финал: подъём и падение идут по одной параболе y = v0*t - g*t^2,
// поэтому на апогее нет остановки. вращение линейное - угловая скорость
// после толчка постоянна, и клавиатура не дотормаживает перед уходом
const TOSS_V0 = 14.7;
const TOSS_G = 36.7;
// на сколько проворачивается за полёт: к зрителю и влево. на обороте
// с лишним она успевала показать изнанку и нырнуть от камеры - с общего
// плана это читалось рывком назад, а не подбросом
const TUMBLE_X = Math.PI * 0.8;
const TUMBLE_Y = -Math.PI * 0.55;

const dir = new THREE.Vector3();

/** на каком расстоянии коробка целиком влезает в кадр; d - направление
 *  от цели к камере, длина не важна */
function fitDistance(
  d: THREE.Vector3,
  box: { w: number; h: number; d: number },
  fovDeg: number,
  aspect: number,
  margin: number,
): number {
  const yaw = Math.atan2(Math.abs(d.x), Math.abs(d.z));
  const elev = Math.asin(Math.min(1, Math.abs(d.y)));

  // ширина силуэта: у повёрнутого объекта в неё вносит вклад и глубина
  const projW = box.w * Math.cos(yaw) + box.d * Math.sin(yaw);
  // то, что уходит вдаль, при взгляде сверху подмешивается в высоту
  const away = box.w * Math.sin(yaw) + box.d * Math.cos(yaw);
  const projH = box.h * Math.cos(elev) + away * Math.sin(elev);

  const tanHalf = Math.tan(((fovDeg / 2) * Math.PI) / 180);
  const byH = projH / 2 / tanHalf;
  const byW = projW / 2 / (tanHalf * aspect);
  return Math.max(byH, byW) * margin;
}

/** направление съёмки из углов: так высота точки съёмки не плывёт от разворота */
function aim(yawDeg: number, elevDeg: number, out: THREE.Vector3) {
  const yaw = (yawDeg * Math.PI) / 180;
  const elev = (elevDeg * Math.PI) / 180;
  return out.set(Math.sin(yaw) * Math.cos(elev), Math.sin(elev), Math.cos(yaw) * Math.cos(elev));
}

const _rot = new THREE.Matrix4();
const _euler = new THREE.Euler();
const _corner = new THREE.Vector3();
const _box = { w: 0, h: 0, d: 0 };

// габарит повёрнутой клавиатуры по восьми углам. раскладывать поворот
// по осям нельзя: в финале она крутится сразу вокруг двух, и ширина
// с глубиной мешаются друг с другом - формула по одной оси давала
// заниженную ширину, и клавиатура вылезала за оба края кадра
function rotatedBox(rx: number, ry: number) {
  _rot.makeRotationFromEuler(_euler.set(rx, ry, 0));
  _box.w = 0;
  _box.h = 0;
  _box.d = 0;
  for (let i = 0; i < 8; i++) {
    _corner
      .set(
        (i & 1 ? 0.5 : -0.5) * BOARD.w,
        (i & 2 ? 0.5 : -0.5) * BOARD.h,
        (i & 4 ? 0.5 : -0.5) * BOARD.d,
      )
      .applyMatrix4(_rot);
    _box.w = Math.max(_box.w, Math.abs(_corner.x) * 2);
    _box.h = Math.max(_box.h, Math.abs(_corner.y) * 2);
    _box.d = Math.max(_box.d, Math.abs(_corner.z) * 2);
  }
  return _box;
}

// полёт колпачка на любой точке прокрутки. пишет прямо в кадр, потому что
// камера в падении смотрит ровно на него: две копии траектории разъезжаются,
// и объект уходит из центра
function flyKey(p: number, out: Shot) {
  // два отрезка прокрутки на одну траекторию: хвост первого экрана -
  // отделение, акт падения - само падение
  const t =
    p < START.drop
      ? PEEL_SHARE * clamp01((p - P_RELEASE) / (START.drop - P_RELEASE))
      : PEEL_SHARE + (1 - PEEL_SHARE) * clamp01((p - START.drop) / (P_LAND - START.drop));

  // показатель ВЫШЕ квадрата. камера прижата к колпачку, и скорость видно
  // только по тому, как быстро растёт клавиатура под ним: на чистом
  // квадрате она приближалась ровно, и акт выглядел невесомостью
  const g = Math.pow(t, 2.4);
  const glide = s(t);
  // дугу ведём от сглаженного хода, а не от самого t: иначе на первых же
  // процентах колпачок отъезжал вбок на четверть клавиши, ещё стоя в гнезде
  const arc = Math.sin(Math.PI * glide);
  // выход из гнезда: короткий горб в начале пути, к двум долям отделения
  // сходит на нет
  const pop = POP_OUT * Math.sin(Math.PI * Math.min(1, t / (PEEL_SHARE * 2)));
  // свободный полёт: от мировой точки отрыва к гнезду
  let x = lerp(BIRTH.x, SEAT.x, glide) + arc * ARC_X;
  let y = lerp(BIRTH.y, SEAT.y, g);
  let z = lerp(BIRTH.z, SEAT.z, glide) + arc * ARC_Z + pop;
  // линейная добавка даёт ненулевую угловую скорость с первого мгновения:
  // колпачок, соскальзывая с наклонённой клавиатуры, обязан провернуться
  // сразу, а не лечь плашмя, как снятая с вешалки одежда. основную часть
  // ведёт сглаженная ступенька, и в сумме кувырок приходит в кратное 2π -
  // иначе колпачок воткнётся в свитч углом
  const turn = s(t) * 0.86 + t * 0.14;
  let rx = RELEASE_TILT + turn * SPIN_X;
  let ry = turn * Math.PI * 2;
  let rz = turn * Math.PI * -2;

  // отрыв не мгновенный. мировую точку отрыва берём один раз, а гнездо
  // под колпачком живёт дальше: клавиатура продолжает заваливаться и идёт
  // вверх. застывший в той точке колпачок остаётся у неё на пути, и она
  // проходит сквозь него соседними клавишами - это и было видно на телефоне.
  // поэтому первую долю пути он держится ЖИВОГО гнезда, выходит из шахты
  // вдоль её оси, а не по мировой вертикали, и отпускает клавиатуру
  // постепенно: она уходит вверх, он отстаёт и остаётся один
  const free = s(clamp01(t / (PEEL_SHARE * GRIP)));
  if (free < 1) {
    const local = clamp01((p - START.hero) / SPAN.hero);
    const tilt = heroTilt(local);
    const sx = Math.sin(tilt);
    const cx = Math.cos(tilt);
    // та же точка, что у BIRTH, но на текущем наклоне и с выходом из шахты
    const up = SEAT.y + pop;
    x = lerp(SEAT.x, x, free);
    y = lerp(up * cx - SEAT.z * sx + heroLift(local), y, free);
    z = lerp(up * sx + SEAT.z * cx, z, free);
    rx = lerp(tilt, rx, free);
    ry = lerp(0, ry, free);
    rz = lerp(0, rz, free);
  }
  out.keyPos.set(x, y, z);
  out.keyRot.set(rx, ry, rz);
  out.keyLoose = p > P_RELEASE && p < P_LAND ? 1 : 0;
  // одиночество считаем отдельно от отрыва и позже него: пока клавиатура
  // рядом, её собственный свет колпачок и освещает, а вот его личный
  // источник в это время бьёт в упор по соседним клавишам и по гнезду
  out.keyFree = s(clamp01((t / PEEL_SHARE - GRIP) / (1 - GRIP)));
}

// насколько клавиатура уходит вправо на первом экране низкого широкого
// окна: телефон набок. текст в такой раскладке стоит слева колонкой,
// и по центру кадра ему не разойтись с моделью
const SHORT_HERO_X = -5.2;

export function shotAt(p: number, fov: number, aspect: number, out: Shot, short = false): Shot {
  const { id, local } = actAt(p);

  // ориентацию берём из пропорций кадра, а не из ширины окна: канвас
  // занимает всё окно, и композиция строится именно под его пропорции.
  // планшет набок ведёт себя как десктоп, и это верно
  const portrait = aspect < 1;
  const BUILD_SHOT = portrait ? BUILD_TALL : short ? BUILD_SHORT : BUILD_WIDE;
  const HOME_SHOT = portrait ? HOME_TALL : HOME_WIDE;
  const PRICE_SHOT = portrait ? PRICE_TALL : short ? PRICE_SHORT : PRICE_WIDE;

  flyKey(p, out);

  // значения кадра собираются по актам, а считаются ниже одинаково
  // для всех - иначе кадры не стыкуются на границах
  let yaw = 4;
  let elev = 20;
  let margin = 1.3;
  let apart = 0;
  let gather = -1;
  let boardY = 0;
  let boardTilt = 0;
  let boardYaw = 0;
  let roll = 0;
  let reveal = -1;
  // подъём цели над объектом опускает его в кадре: текст занимает верх
  // экрана, и клавиатура обязана быть под ним
  let lookX = 0;
  let lookY = 0.7;
  let lookZ = 0;
  let lookRise = 0.17;
  // насколько объект стоит не в середине кадра. где цель уведена вбок,
  // чтобы освободить половину экрана под текст, объекту нужно вдвое больше
  // места по ширине - иначе он вылезает за противоположный край
  let offCenter = 0;
  // коробка кадра: чем она меньше, тем ближе подходит камера
  let boxW = BOARD.w;
  let boxH = BOARD.h;
  let boxD = BOARD.d;

  if (id === 'hero') {
    boardTilt = heroTilt(local);
    boardY = heroLift(local);
    const tt = boardTilt / TILT_MAX;
    const silhouette = rotatedBox(boardTilt, 0);

    // кадр, пока в нём клавиатура
    const bYaw = lerp(4, 2, tt);
    const bElev = lerp(20, 7, tt);
    // в портрете кадр упирается в ширину, поэтому запас почти нулевой.
    // и опускать так же сильно нельзя: видимая высота узкого кадра втрое
    // больше, и та же доля увела бы предмет под нижний край
    const bMargin = portrait ? lerp(1.04, 1.02, tt) : lerp(1.3, 1.12, tt);
    // на низком широком окне уводим предмет вбок, освобождая колонку тексту
    const bLookX = short && !portrait ? SHORT_HERO_X : 0;
    const bLookY = boardY + lerp(0.7, 0.2, tt);
    // на телефоне набок предмет опускаем ниже обычного: слева от него
    // стоит не только текст, но и выбор свитча, и на общей высоте они
    // сходятся в одной полосе кадра
    const bRise = portrait ? lerp(0.11, 0.03, tt) : lerp(short ? 0.3 : 0.17, 0.04, tt);

    // дальше камера переходит на колпачок, ровно с момента срыва:
    // клавиатура в это время уходит вверх, и к стыку её в кадре уже нет
    const chase = seg(local, RELEASE_LOCAL, 1);
    yaw = lerp(bYaw, 14, chase);
    elev = lerp(bElev, 6, chase);
    margin = lerp(bMargin, 1.04, chase);
    lookX = lerp(bLookX, out.keyPos.x, chase);
    // сдвинутой цели объекту нужно вдвое больше места по ширине, иначе
    // он вылезет за противоположный край
    offCenter = Math.abs(bLookX) * (1 - chase);
    lookY = lerp(bLookY, out.keyPos.y, chase);
    lookZ = lerp(0, out.keyPos.z, chase);
    lookRise = lerp(bRise, 0, chase);
    boxW = lerp(silhouette.w, KEY_BOX.w, chase);
    boxH = lerp(silhouette.h, KEY_BOX.h, chase);
    boxD = lerp(silhouette.d, KEY_BOX.d, chase);
  } else if (id === 'drop') {
    // камера идёт рядом с колпачком и смотрит ровно на него - отсюда
    // и ощущение падения: движется не объект в кадре, а кадр. клавиатура
    // при этом уже стоит внизу и ждёт, а прыжок туда из верхней точки
    // прошлого акта сделан резко, одним кадром на стыке: в обоих положениях
    // она вне кадра, а плавный переезд провёл бы её через центр экрана.

    // раскрываем кадр с 0.22, а не с начала: пока в нём один колпачок
    // на чёрном, скорость падения не с чем сравнить, и растущая снизу
    // клавиатура - единственная мерка
    const k = s(Math.max(0, (local - 0.22) / 0.78));
    // камера не отпускает колпачок до самого удара: клавиша выбирается
    // случайно, и с крайней приземление ушло бы за край кадра - а ради него
    // весь акт. композицию держит коробка, а не точка взгляда
    yaw = lerp(14, LAND_SHOT.yaw, k);
    elev = lerp(6, LAND_SHOT.elev, k);
    margin = lerp(portrait ? 1.02 : 1.04, LAND_SHOT.margin, k);
    lookX = out.keyPos.x;
    lookY = out.keyPos.y;
    lookZ = out.keyPos.z;
    lookRise = lerp(0, LAND_SHOT.rise, k);
    // горизонт выправляется к удару, иначе клавиатура встречает колпачок косо
    roll = lerp(-0.06, 0, s(local));
    // коробка растёт по ходу падения: сперва один колпачок во весь экран,
    // к концу в кадр входит и клавиатура
    boxW = lerp(KEY_BOX.w, LAND_SHOT.w, k);
    boxH = lerp(KEY_BOX.h, LAND_SHOT.h, k);
    boxD = lerp(KEY_BOX.d, LAND_SHOT.d, k);
  } else if (id === 'build') {
    // первую пятую акта камера отходит от места удара на общий план,
    // и только когда клавиатура освободила правую половину, там проступает
    // текст. разлёт начинается уже после отъезда
    const back = seg(local, 0, 0.22);
    const k = s(clamp01((local - 0.22) / 0.78));
    apart = k;
    const spreadMid = 0.7 + (SPREAD_H * k) / 2;

    yaw = lerp(LAND_SHOT.yaw, lerp(BUILD_SHOT.yaw, 34, k), back);
    elev = lerp(LAND_SHOT.elev, lerp(BUILD_SHOT.elev, 25, k), back);
    margin = lerp(LAND_SHOT.margin, lerp(BUILD_SHOT.margin, 1.06, k), back);
    // отъезд начинается от гнезда, в которое сел колпачок: между актами
    // не должно быть склейки
    lookX = lerp(SEAT.x, BUILD_SHOT.lookX, back);
    lookY = lerp(SEAT.y, spreadMid, back);
    lookZ = lerp(SEAT.z, 0, back);
    lookRise = lerp(LAND_SHOT.rise, BUILD_SHOT.rise, back);
    boxW = lerp(LAND_SHOT.w, BOARD.w, back);
    boxH = lerp(LAND_SHOT.h, BOARD.h + SPREAD_H * k, back);
    boxD = lerp(LAND_SHOT.d, BOARD.d, back);
    offCenter = back * Math.abs(BUILD_SHOT.lookX);
  } else {
    // сборка на свитчи: слой свитчей стоит, верхние опускаются, нижние
    // поднимаются, и всё одновременно. чтобы свитчи и правда не двигались,
    // вся клавиатура поднимается ровно на то, на сколько уезжал их слой -
    // иначе сборка оказывается оседанием стопки вниз.
    //
    // собравшись, она выходит в центр кадра и только ПОСЛЕ этого её
    // подбрасывает: внахлёст финал читался перемоткой разборки назад
    const asm = seg(local, 0, 0.3);
    gather = asm;
    apart = 1 - asm;
    boardY = SWITCH_SPREAD * asm;

    // подброс и кувырок идут по одним часам. само время толчка
    // разгоняется: первую восьмую доля хода растёт квадратично и дальше
    // переходит в равномерную, стык гладкий по производной. на чистой
    // линейной доле вся скорость появлялась за один кадр, и подброс
    // читался пинком, а не броском
    const raw = ramp(local, 0.46, 0.82);
    const tau = raw < 0.12 ? (raw * raw) / 0.24 : raw - 0.06;
    boardY += TOSS_V0 * tau - TOSS_G * tau * tau;
    boardTilt = tau * TUMBLE_X;
    boardYaw = tau * TUMBLE_Y;

    const home = seg(local, 0.14, 0.44);
    // доводим до самого конца акта: последние проценты прокрутки - это
    // как раз то место, где на телефоне клавиатура обязана доуйти вверх,
    // освобождая счётчик
    const price = seg(local, 0.8, 1);
    const silhouette = rotatedBox(boardTilt, boardYaw);

    yaw = lerp(lerp(34, HOME_SHOT.yaw, home), PRICE_SHOT.yaw, price);
    elev = lerp(lerp(25, HOME_SHOT.elev, home), PRICE_SHOT.elev, price);
    margin = lerp(lerp(1.06, HOME_SHOT.margin, home), PRICE_SHOT.margin, price);
    lookX = lerp(BUILD_SHOT.lookX * (1 - home), 0, price);
    lookY = lerp(lerp(0.7 + SPREAD_H / 2, HOME_SHOT.lookY, home), PRICE_SHOT.lookY, price);
    lookRise = lerp(lerp(BUILD_SHOT.rise, HOME_SHOT.rise, home), PRICE_SHOT.rise, price);
    boxW = lerp(BOARD.w, silhouette.w, home);
    boxH = lerp(BOARD.h + SPREAD_H * apart, silhouette.h, home);
    boxD = lerp(BOARD.d, silhouette.d, home);
    offCenter = Math.abs(lookX);

    // вторая клавиатура - та же модель: улетев за нижний край, она
    // возвращается на место и проступает тем же фронтом, что под заставкой.
    // проявление включаем РАНЬШЕ возврата не для запаса: кадр и волна живут
    // в разных useFrame, порядок вызова за кадр не гарантирован, и в одном
    // кадре с включением волны она успела бы мигнуть в полную силу
    if (local > 0.82) reveal = seg(local, 0.85, 1);
    if (local > 0.84) {
      boardY = 0;
      boardTilt = 0;
      boardYaw = 0;
      gather = 1;
      apart = 0;
      boxW = BOARD.w;
      boxH = BOARD.h;
      boxD = BOARD.d;
    }
  }

  aim(yaw, elev, dir);
  // сдвиг цели вбок означает, что объекту нужно вдвое больше места
  // по ширине: без поправки стопка на полном разлёте вылезала за левый край
  const dist = fitDistance(dir, { w: boxW + offCenter * 2, h: boxH, d: boxD }, fov, aspect, margin);
  // подъём цели считаем от видимой высоты кадра, а не в юнитах: те же
  // юниты на широком экране сдвигают объект вдвое слабее
  const visibleH = 2 * dist * Math.tan(((fov / 2) * Math.PI) / 180);

  out.look.set(lookX, lookY + visibleH * lookRise, lookZ);
  out.pos.copy(out.look).addScaledVector(dir, dist);
  out.apart = apart;
  out.gather = gather;
  out.boardY = boardY;
  out.boardTilt = boardTilt;
  out.boardYaw = boardYaw;
  out.roll = roll;
  out.reveal = reveal;
  return out;
}

export function makeShot(): Shot {
  return {
    pos: new THREE.Vector3(),
    look: new THREE.Vector3(),
    apart: 0,
    gather: -1,
    boardY: 0,
    boardTilt: 0,
    boardYaw: 0,
    roll: 0,
    keyPos: new THREE.Vector3(),
    keyRot: new THREE.Euler(),
    keyLoose: 0,
    keyFree: 0,
    reveal: -1,
  };
}

// курсор поднимает клавиши, только пока клавиатура стоит ровно. окно
// узкое, потому что заваливание начинается с первого щелчка колеса
export function isHero(p: number) {
  const { id, local } = actAt(p);
  return id === 'hero' && local < 0.12;
}
