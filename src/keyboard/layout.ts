import { ROWS, ROW_TILT, ROW_STEP, SHIFTED, FN_LAYER, comboKey, uniqueCombos } from './layoutData.mjs';

export const KEY_UNIT = 1; // шаг между центрами клавиш в мировых единицах
export const KEYCAP_GAP = 0.94; // колпачок чуть меньше юнита - отсюда зазоры

// тонов три, а не два: акценты, буквенный блок чуть светлее и всё
// остальное почти чёрное. в два тона алфавит не отделяется от модификаторов
export type KeyTone = 'accent' | 'alpha' | 'mod';

export type PlacedKey = {
  id: string;
  x: number;
  z: number;
  w: number;
  row: number; // номер ряда сверху: задаёт профиль и наклон колпачка
  combo: string; // ключ геометрии, например r2_w175
  legend: string;
  accent: boolean;
  stab: boolean;
  tone: KeyTone;
  /** верхний символ - то, что печатается с Shift. пусто там, где его нет */
  sub: string;
  /** подпись слоя Fn: на 65% так печатают F1-F12, отдельного ряда нет */
  fn: string;
};

// правая колонка тёмная, хотя её клавиши шириной в юнит и стоят в тех же
// рядах, что буквы: по одной ширине её не отличить
const NAV_COLUMN = new Set(['home', 'pgup', 'pgdn', 'end']);

function toneOf(id: string, row: number, w: number, accent: boolean): KeyTone {
  if (accent) return 'accent';
  if (id === 'space') return 'alpha';
  // буквенный блок: три средних ряда шириной в юнит, кроме правой колонки
  if (w === 1 && row >= 1 && row <= 3 && !NAV_COLUMN.has(id)) return 'alpha';
  return 'mod';
}

function buildKeys(): PlacedKey[] {
  const boardWidth = Math.max(
    ...ROWS.map((row) => row.reduce((sum, key) => sum + key.w, 0)),
  );
  const rows = ROWS.length;

  const keys: PlacedKey[] = [];
  ROWS.forEach((row, rowIndex) => {
    let cursor = 0; // накопленная ширина слева в юнитах
    const z = (rowIndex - (rows - 1) / 2) * KEY_UNIT;
    for (const key of row) {
      const x = (cursor + key.w / 2 - boardWidth / 2) * KEY_UNIT;
      keys.push({
        id: key.id,
        x,
        z,
        w: key.w,
        row: rowIndex,
        combo: comboKey(rowIndex, key.w),
        legend: key.legend,
        accent: key.accent,
        stab: key.stab,
        tone: toneOf(key.id, rowIndex, key.w, key.accent),
        sub: (SHIFTED as Record<string, string>)[key.id] ?? '',
        fn: (FN_LAYER as Record<string, string>)[key.id] ?? '',
      });
      cursor += key.w;
    }
  });
  return keys;
}

export const KEYS: PlacedKey[] = buildKeys();

export const BOARD_WIDTH = 16 * KEY_UNIT;
export const BOARD_DEPTH = ROWS.length * KEY_UNIT;

export const STAB_KEYS: PlacedKey[] = KEYS.filter((key) => key.stab);

// половина разноса ножек: у длинных клавиш они ближе к краям
export function stabHalfSpan(w: number): number {
  return Math.max(0.5, w / 2 - 0.5);
}

export { ROW_TILT, ROW_STEP, uniqueCombos };
