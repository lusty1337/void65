import type { LayerName } from './types';
import { TRAY_FLOOR_Y } from './caseGeometry';
import { SW, SWITCH_HEIGHT, SWITCH_STEM_TOP } from './switchGeometry';
import { STAB_HEIGHT } from './stabGeometry';
// .mjs, а не .ts: этот же файл читает офлайн-генератор геометрии в node
import { SOCKET_DEPTH, CAP_CLEARANCE } from './keycapSpec.mjs';

const MM = 1 / 19.05;

// толщины слоёв в мировых единицах - единственный источник правды:
// геометрия обязана совпадать с этими числами, иначе стек разъедется
export const THICKNESS: Record<LayerName, number> = {
  bottomCase: 1.02, // корпус целиком, от дна до верхней кромки переднего борта
  pcb: 0.06,
  // пена ровно заполняет зазор между платой и пластиной, 2.5 мм
  foam: 0.131,
  // высота ножки стабилизатора - тоже из её геометрии
  stabilizers: STAB_HEIGHT,
  // из геометрии самого свитча, 11.6 мм по MX. на зашитых 0.48 он был
  // на два миллиметра ниже настоящего, и колпачки садились глубже
  switches: SWITCH_HEIGHT,
  plate: 1.5 * MM, // стальная пластина, 1.5 мм
  keycaps: 0.42,
};

// берём у самого корпуса, а не дублируем числом: на зашитых 0.16 при дне
// в 0.3 весь стек висел на три миллиметра ниже пола
const TRAY_FLOOR = TRAY_FLOOR_Y;

const pcbY = TRAY_FLOOR + THICKNESS.pcb / 2;

// свитч стоит подошвой на ПЛАТЕ, а не на пене: пена - лист с вырезами,
// корпус проходит сквозь неё насквозь. поверх пены он висел на два
// с половиной миллиметра выше платы, куда уходят его ножки
export const SWITCH_SOLE_Y = TRAY_FLOOR + THICKNESS.pcb;

const foamY = SWITCH_SOLE_Y + THICKNESS.foam / 2;
const switchY = SWITCH_SOLE_Y + THICKNESS.switches / 2;

// пластина ложится под юбку свитча - именно ей он и опирается. высоту
// берём из его геометрии, чтобы она не разъехалась
const plateTop = SWITCH_SOLE_Y + (SW.bottomH - SW.flangeH) * MM;

// центр каждого слоя в собранном состоянии. считается из толщин, а не на глаз
export const BASE_Y: Record<LayerName, number> = {
  bottomCase: 0,
  pcb: pcbY,
  foam: foamY,
  // стабилизаторы стоят на плате рядом со свитчами, подошвой на той же высоте
  stabilizers: SWITCH_SOLE_Y + THICKNESS.stabilizers / 2,
  switches: switchY,
  // пластина пересекает корпус свитча - так и должно быть, свитч в неё защёлкнут
  plate: plateTop - THICKNESS.plate / 2,
  // считаем от макушки штока минус глубина шахты, а не подбираем от верха
  // корпуса: шахта всего 0.15, а шток торчит на 0.19, и при подобранной
  // высоте он выходил сквозь крышку - на каждой клавише торчал крест
  keycaps:
    SWITCH_SOLE_Y +
    (SWITCH_STEM_TOP - SOCKET_DEPTH) +
    CAP_CLEARANCE +
    THICKNESS.keycaps / 2,
};
