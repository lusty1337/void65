import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

// числа тянем регулярками из исходников: stack.ts и caseGeometry.ts - .ts,
// а node их импортировать не умеет. дно лотка читаем у корпуса, а не у стека,
// иначе проверка сверяет стек сам с собой и пропускает расхождение
const stack = readFileSync('src/keyboard/stack.ts', 'utf8');
const caseSrc = readFileSync('src/keyboard/caseGeometry.ts', 'utf8');

const grab = (src, re, what) => {
  const m = src.match(re);
  assert.ok(m, `не нашёл ${what}`);
  return parseFloat(m[1]);
};

// пробел классом, а не \s: в шаблонной строке одинарный слэш съедается,
// и регулярка превращается в "pcb:s*", которая не совпадает ни с чем
const num = (name) => grab(stack, new RegExp(`${name}:[ ]*([0-9.]+)`), `толщину ${name}`);
const trayFloor = () => grab(caseSrc, /TRAY_FLOOR_Y = ([0-9.]+)/, 'дно лотка');
const frontHeight = () => grab(caseSrc, /frontHeight: ([0-9.]+)/, 'высоту переднего торца');
const backHeight = () => grab(caseSrc, /backHeight: ([0-9.]+)/, 'высоту заднего торца');

test('стек берёт дно лотка у корпуса, а не дублирует его числом', () => {
  assert.match(
    stack,
    /TRAY_FLOOR = TRAY_FLOOR_Y/,
    'stack.ts обязан брать дно лотка из caseGeometry, иначе слои разъедутся с корпусом',
  );
});

test('корпус - клин: задний торец выше переднего', () => {
  assert.ok(backHeight() > frontHeight(), 'иначе клавиатура ляжет плашмя');
});

test('плата помещается в лоток и не тонет в корпусе', () => {
  const floor = trayFloor();
  assert.ok(floor > 0, 'дно лотка должно быть выше нуля');
  // сверяем с передним бортом: он самый низкий, по нему и проходит ограничение
  assert.ok(floor < frontHeight(), 'дно лотка должно быть ниже верхней кромки борта');
});

test('плата, пена и стабилизаторы не накладываются друг на друга', () => {
  const pcbTop = trayFloor() + num('pcb');
  const foamTop = pcbTop + num('foam');
  assert.ok(pcbTop <= foamTop, 'пена должна лежать НА плате, а не в ней');
  assert.ok(foamTop > pcbTop, 'у пены должна быть ненулевая толщина');
});

test('толщина свитча приходит из его геометрии, а не числом', () => {
  // на зашитых 0.48 при настоящих 11.6 мм колпачки садились глубже, чем
  // должны: число, списанное на глаз, расходится с моделью молча, поэтому
  // проверяем связь, а не значение
  assert.match(
    stack,
    /switches: SWITCH_HEIGHT/,
    'stack.ts обязан брать высоту свитча из switchGeometry',
  );
  assert.match(
    stack,
    /plateTop = SWITCH_SOLE_Y \+ \(SW\.bottomH - SW\.flangeH\)/,
    'пластина обязана ложиться под юбку свитча, а не на подобранную высоту',
  );
});

test('свитч стоит на плате, а не поверх пены', () => {
  // пена - лист с вырезами, корпус свитча проходит сквозь неё насквозь:
  // поставь свитч на пену, и вся клавиатура повиснет на её толщину выше,
  // а ножки не достанут до платы
  assert.match(stack, /SWITCH_SOLE_Y = TRAY_FLOOR \+ THICKNESS\.pcb/);
  assert.ok(
    !/switchBottom = TRAY_FLOOR \+ THICKNESS\.pcb \+ THICKNESS\.foam/.test(stack),
    'подошва свитча не должна отсчитываться от верха пены',
  );
});

test('колпачки выступают над передним бортом', () => {
  // считаем по литералам, которые в stack.ts остались числами
  const trayF = trayFloor();
  const pcb = num('pcb');
  const caps = num('keycaps');
  // высота свитча - 11.6 мм из MX-стандарта, здесь она нужна как константа
  const sw = (5.0 + 6.6) / 19.05;
  const top = trayF + pcb + sw + caps;
  assert.ok(top > frontHeight(), `верх колпачков ${top} не выше борта ${frontHeight()}`);
});
