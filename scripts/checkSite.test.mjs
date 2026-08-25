// страница и сцена держатся на одних числах: высоты секций в vh задают
// и вёрстку, и границы актов камеры. разъедутся - камера начнёт жить
// отдельно от текста, а заметить это можно только глазами
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const acts = readFileSync('src/stage/acts.ts', 'utf8');
const page = readFileSync('src/page/Page.tsx', 'utf8');
const copy = readFileSync('src/page/copy.ts', 'utf8');
const { ROWS } = await import('../src/keyboard/layoutData.mjs');

/** высоты актов из самого файла: переписывать их сюда нельзя */
const ACT_VH = [...acts.matchAll(/\{\s*id:\s*'(\w+)',\s*vh:\s*(\d+)\s*\}/g)].map((m) => ({
  id: m[1],
  vh: Number(m[2]),
}));

test('акты объявлены и у каждого положительная высота', () => {
  assert.ok(ACT_VH.length >= 3, 'актов должно быть хотя бы три');
  for (const a of ACT_VH) assert.ok(a.vh > 0, `${a.id} без высоты`);
});

test('последний акт длиннее экрана', () => {
  // нижние 100vh не прокручиваются: последний акт ровно в экран никогда
  // не доиграет до конца
  const last = ACT_VH[ACT_VH.length - 1];
  assert.ok(last.vh > 100, `последний акт ${last.id} = ${last.vh}vh, отыграет только часть`);
});

test('страница берёт высоты секций из актов, а не пишет свои', () => {
  assert.ok(
    page.includes("height('hero')") && page.includes("height('build')"),
    'секции задают высоту мимо ACTS',
  );
  assert.ok(!/height:\s*'\d+svh'/.test(page), 'в разметке зашита высота числом');
});

test('число клавиш считается по раскладке', () => {
  const keys = ROWS.reduce((sum, row) => sum + row.length, 0);
  assert.ok(copy.includes('ROWS'), 'copy.ts печатает число клавиш вручную');
  assert.ok(!/75%|knob/i.test(copy), 'остались данные от 75% с крутилкой');
  assert.ok(keys > 0);
});

test('список слоёв совпадает с разлётом сцены', () => {
  // таблица разлёта живёт в режиссуре, сцена только применяет её к группам:
  // читаем оттуда же, откуда её читает камера
  const director = readFileSync('src/stage/director.ts', 'utf8');
  const spread = [...director.matchAll(/\{\s*key:\s*'(\w+)',\s*y:\s*-?[\d.]+\s*\}/g)].map(
    (m) => m[1],
  );
  const layers = [...copy.matchAll(/\{\s*name:\s*'([^']+)'/g)].map((m) => m[1]);
  assert.equal(
    spread.length,
    layers.length,
    `в сцене ${spread.length} слоёв, в тексте ${layers.length}`,
  );
  // порядок - это содержание: список читается сверху вниз, и разлёт обязан
  // идти так же, иначе подсвеченная строка указывает не на тот слой
  const norm = (s) => s.toLowerCase().replace(/[^a-z]/g, '');
  assert.deepEqual(
    spread.map(norm),
    layers.map(norm),
    'порядок слоёв в разлёте разошёлся с порядком в тексте',
  );
});

test('сборка идёт одним ходом, а не отрезками разборки', () => {
  const director = readFileSync('src/stage/director.ts', 'utf8');
  assert.ok(
    /gather:\s*number/.test(director),
    'в кадре нет режима сборки - сборка снова стала перемоткой разборки',
  );
});
