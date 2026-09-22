import { KEYS } from './layout';

// настоящая клавиша под пальцем зрителя - та же, что в модели. браузер
// присылает КОД клавиши, то есть её место на железе, а не набранный символ:
// поэтому русская раскладка, dvorak и любая другая попадают в ту же
// клавишу, а не мимо.
//
// коды, которых в 65% нет (F-ряд, цифровой блок, insert), сюда не попадают
// и просто не зажигают ничего

const SAME = ['tab', 'space', 'enter', 'backspace', 'home', 'end', 'minus', 'equal', 'slash', 'comma', 'quote', 'semicolon', 'backslash'];

const NAMED: Record<string, string> = {
  Escape: 'esc',
  CapsLock: 'caps',
  ShiftLeft: 'lshift',
  ShiftRight: 'rshift',
  ControlLeft: 'lctrl',
  ControlRight: 'rctrl',
  AltLeft: 'lalt',
  AltRight: 'ralt',
  MetaLeft: 'win',
  MetaRight: 'win',
  OSLeft: 'win',
  ContextMenu: 'fn',
  BracketLeft: 'lbracket',
  BracketRight: 'rbracket',
  Period: 'dot',
  PageUp: 'pgup',
  PageDown: 'pgdn',
  ArrowUp: 'up',
  ArrowDown: 'down',
  ArrowLeft: 'left',
  ArrowRight: 'right',
  NumpadEnter: 'enter',
};

/** номер клавиши в KEYS по её id */
const INDEX = new Map(KEYS.map((key, i) => [key.id, i]));

const CODE = new Map<string, number>();
for (const [code, id] of Object.entries(NAMED)) {
  const i = INDEX.get(id);
  if (i !== undefined) CODE.set(code, i);
}
for (const id of SAME) {
  const i = INDEX.get(id);
  // Tab, Space, Enter: у браузера код совпадает с нашим id с большой буквы
  if (i !== undefined) CODE.set(id[0].toUpperCase() + id.slice(1), i);
}
for (const key of KEYS) {
  if (/^[a-z]$/.test(key.id)) CODE.set(`Key${key.id.toUpperCase()}`, INDEX.get(key.id)!);
  if (/^[0-9]$/.test(key.id)) CODE.set(`Digit${key.id}`, INDEX.get(key.id)!);
}

/** номер клавиши модели под этим кодом браузера, −1 - такой у нас нет */
export function keyOfCode(code: string): number {
  return CODE.get(code) ?? -1;
}
