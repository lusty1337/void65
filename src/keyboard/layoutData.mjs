// сырые данные раскладки 65%. в .mjs, потому что этот же файл читает
// офлайн-генератор геометрии в node, а .ts он импортировать не умеет

/** @typedef {{id: string, w: number, legend: string, accent: boolean, stab: boolean}} KeyDef */

const k = (id, w = 1, legend, opts = {}) => ({
  id,
  w,
  legend: legend ?? id.toUpperCase(),
  accent: !!opts.accent,
  stab: !!opts.stab,
});

// сверху вниз: цифровой ряд, QWERTY, домашний, шифты, нижний с пробелом.
// ряда F нет, это 65%: с ним справа от F12 оставалась пустая полоса в три
// юнита, занять которую нечем. esc переезжает в цифровой ряд на место
// тильды, как на всех 65%, а правый столбец и стрелки - то, чем 65%
// отличается от 60%
/** @type {KeyDef[][]} */
export const ROWS = [
  [
    k('esc', 1, 'esc', { accent: true }),
    k('1'), k('2'), k('3'), k('4'), k('5'), k('6'), k('7'), k('8'), k('9'), k('0'),
    k('minus', 1, '-'), k('equal', 1, '='),
    k('backspace', 2, 'backspace', { stab: true }),
    k('home', 1, 'home'),
  ],
  [
    k('tab', 1.5, 'tab'),
    k('q'), k('w'), k('e'), k('r'), k('t'), k('y'), k('u'), k('i'), k('o'), k('p'),
    k('lbracket', 1, '['), k('rbracket', 1, ']'),
    k('backslash', 1.5, '\\'),
    k('pgup', 1, 'pgup'),
  ],
  [
    k('caps', 1.75, 'caps lock'),
    k('a'), k('s'), k('d'), k('f'), k('g'), k('h'), k('j'), k('k'), k('l'),
    k('semicolon', 1, ';'), k('quote', 1, "'"),
    k('enter', 2.25, 'enter', { accent: true, stab: true }),
    k('pgdn', 1, 'pgdn'),
  ],
  [
    k('lshift', 2.25, 'shift', { stab: true }),
    k('z'), k('x'), k('c'), k('v'), k('b'), k('n'), k('m'),
    k('comma', 1, ','), k('dot', 1, '.'), k('slash', 1, '/'),
    k('rshift', 1.75, 'shift', { stab: true }),
    k('up', 1, '↑', { accent: true }),
    k('end', 1, 'end'),
  ],
  [
    k('lctrl', 1.25, 'ctrl'),
    k('win', 1.25, 'win'),
    k('lalt', 1.25, 'alt'),
    k('space', 6.25, '', { stab: true }),
    k('ralt', 1, 'alt'),
    k('fn', 1, 'fn'),
    k('rctrl', 1, 'ctrl'),
    k('left', 1, '←', { accent: true }),
    k('down', 1, '↓', { accent: true }),
    k('right', 1, '→', { accent: true }),
  ],
];

// наклон верхней площадки ряда, а НЕ поворот клавиши целиком: подошвы всех
// колпачков лежат в одной плоскости, как на настоящей клавиатуре, а наклон
// запечён в геометрию - одна стенка выше другой. от поворота подошва
// задиралась, и сбоку зияла клиновидная щель
export const ROW_TILT = [-0.10, -0.05, 0, 0.05, 0.09];
export const ROW_STEP = [0.045, 0.02, 0, 0.02, 0.04];


// то, что печатается с Shift: цифровой ряд и знаки препинания подписаны
// в две строки. отдельной таблицей, чтобы не раздувать саму раскладку
export const SHIFTED = {
  1: '!', 2: '@', 3: '#', 4: '$', 5: '%',
  6: '^', 7: '&', 8: '*', 9: '(', 0: ')',
  minus: '_',
  equal: '+',
  lbracket: '{',
  rbracket: '}',
  backslash: '|',
  semicolon: ':',
  quote: '"',
  comma: '<',
  dot: '>',
  slash: '?',
};


// ряда F на 65% физически нет, и заводские наборы печатают F1-F12 второй
// подписью на цифрах - иначе о них не догадаться. тусклее основной легенды:
// это подсказка, а не равноправная надпись
export const FN_LAYER = {
  1: 'F1', 2: 'F2', 3: 'F3', 4: 'F4', 5: 'F5', 6: 'F6',
  7: 'F7', 8: 'F8', 9: 'F9', 0: 'F10',
  minus: 'F11',
  equal: 'F12',
};

export const comboKey = (row, w) => `r${row}_w${String(Math.round(w * 100)).padStart(3, '0')}`;

// уникальные пары "ряд × ширина": под каждую печём свой меш, чтобы фаски
// не растягивались вместе с клавишей
export function uniqueCombos() {
  const seen = new Map();
  ROWS.forEach((row, ri) => {
    for (const key of row) {
      const ck = comboKey(ri, key.w);
      if (!seen.has(ck)) seen.set(ck, { key: ck, row: ri, w: key.w });
    }
  });
  return [...seen.values()].sort((a, b) => a.key.localeCompare(b.key));
}
