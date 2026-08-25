import test from 'node:test';
import assert from 'node:assert/strict';
import { buildCap, CAP_HEIGHT } from './genKeycaps.mjs';
import { uniqueCombos, ROW_TILT } from '../src/keyboard/layoutData.mjs';

// на 65% рядов пять, ряда F нет
test('комбинаций ровно 13', () => {
  assert.equal(uniqueCombos().length, 13);
});

test('колпачок вписан в свою ширину и высоту', () => {
  for (const { row, w } of uniqueCombos()) {
    const { positions } = buildCap(row, w);
    let maxX = -Infinity, maxZ = -Infinity, minY = Infinity, maxY = -Infinity;
    for (let i = 0; i < positions.length; i += 3) {
      maxX = Math.max(maxX, Math.abs(positions[i]));
      minY = Math.min(minY, positions[i + 1]);
      maxY = Math.max(maxY, positions[i + 1]);
      maxZ = Math.max(maxZ, Math.abs(positions[i + 2]));
    }
    // полуширина не превышает половину ширины клавиши в юнитах
    assert.ok(maxX <= w / 2 + 1e-6, `${row}/${w}: ширина ${maxX} > ${w / 2}`);
    assert.ok(maxZ <= 0.5 + 1e-6, `${row}/${w}: глубина ${maxZ} > 0.5`);
    // со скошенной шляпкой колпачок выше номинала: наклон ряда запечён
    // в геометрию, и дальняя стенка поднимается на tilt * глубину. это
    // не ошибка, а весь смысл, поэтому он входит в допуск
    const lift = Math.abs(ROW_TILT[row] ?? 0) * 0.5;
    assert.ok(
      maxY - minY <= CAP_HEIGHT + lift + 1e-6,
      `${row}/${w}: высота ${maxY - minY} при потолке ${CAP_HEIGHT + lift}`,
    );
  }
});

test('фаска не растягивается по ширине', () => {
  // меряем горизонтальный отступ верхней кромки стенки от края клавиши:
  // он вычитается в мировых единицах и не должен зависеть от ширины.
  //
  // прошлая версия искала точку с максимальным X и смотрела на её Z, но
  // у суперэллипса максимум X лежит ровно на t=0, где Z тождественно ноль:
  // inset(1) и inset(6.25) оба выходили нулями, и тест был зелёным прямо
  // на том баге, ради которого затевался
  const wallInsetX = (w) => {
    const { positions } = buildCap(4, w);
    // группируем вершины по Y: у колец стенки он строго одинаков по всему
    // кольцу, в отличие от блюдца, где высота плавает по углу из-за прогиба.
    // берём самое верхнее такое кольцо, у него утяжка самая глубокая
    const groups = new Map();
    for (let i = 0; i < positions.length; i += 3) {
      const y = Math.round(positions[i + 1] * 1e5) / 1e5;
      if (!groups.has(y)) groups.set(y, []);
      groups.get(y).push(positions[i]);
    }
    let topY = -Infinity, topXs = null;
    for (const [y, xs] of groups) {
      // порог 20 отсекает одиночные вершины полюсов (центр блюдца, дно полости)
      if (xs.length >= 20 && y > topY) { topY = y; topXs = xs; }
    }
    const maxX = Math.max(...topXs);
    return w / 2 - maxX;
  };
  assert.ok(
    Math.abs(wallInsetX(1) - wallInsetX(6.25)) < 0.02,
    'горизонтальная фаска верхней кромки стенки разъехалась по ширине',
  );
});

test('ряды различаются высотой или наклоном', () => {
  const top = (row) => {
    const { positions } = buildCap(row, 1);
    let maxY = -Infinity;
    for (let i = 1; i < positions.length; i += 3) maxY = Math.max(maxY, positions[i]);
    return maxY;
  };
  const tops = [0, 1, 2, 3, 4].map(top);
  // домашний ряд (2) - самый низкий
  assert.ok(tops[2] < tops[0] && tops[2] < tops[4], `профиль не скульптурный: ${tops}`);
});

test('подошва колпачка плоская при любом наклоне ряда', () => {
  // главное свойство скульптурного профиля: наклон живёт в шляпке, а подошвы
  // всех клавиш лежат в одной плоскости. от поворота всей клавиши подошва
  // задиралась, и сбоку зияла клиновидная щель
  for (const { row, w } of uniqueCombos()) {
    const { positions } = buildCap(row, w);
    let minY = Infinity;
    for (let i = 1; i < positions.length; i += 3) minY = Math.min(minY, positions[i]);
    // считаем вершины, лежащие ровно на нижнем уровне: их должно быть целое
    // кольцо, а не одна точка накренившегося угла
    let onFloor = 0;
    for (let i = 1; i < positions.length; i += 3) {
      if (Math.abs(positions[i] - minY) < 1e-6) onFloor++;
    }
    assert.ok(onFloor >= 24, `${row}/${w}: на подошве всего ${onFloor} вершин - она не плоская`);
  }
});

test('оболочка не вывернута наизнанку', () => {
  // знаковый объём - единственный способ поймать это числом: на картинке
  // вывернутая оболочка выглядит нормально, материал двусторонний, и три сам
  // переворачивает нормаль задних граней. ломается другое - любая проверка
  // по нормали, а на ней держится печать легенды: она идёт только
  // по обращённым вверх граням и на вывернутой шляпке молча не наносилась
  for (const { row, w } of uniqueCombos()) {
    const { positions: p, indices: i } = buildCap(row, w);
    let vol = 0;
    for (let f = 0; f < i.length; f += 3) {
      const a = i[f] * 3;
      const b = i[f + 1] * 3;
      const c = i[f + 2] * 3;
      vol +=
        (p[a] * (p[b + 1] * p[c + 2] - p[b + 2] * p[c + 1]) -
          p[a + 1] * (p[b] * p[c + 2] - p[b + 2] * p[c]) +
          p[a + 2] * (p[b] * p[c + 1] - p[b + 1] * p[c])) /
        6;
    }
    assert.ok(vol > 0, `${row}/${w}: знаковый объём ${vol.toFixed(4)} - обход развёрнут`);
  }
});

test('нормали шляпки смотрят вверх', () => {
  for (const { row, w } of uniqueCombos()) {
    const { positions: p, normals: n } = buildCap(row, w);
    let top = -Infinity;
    let up = 0;
    for (let k = 0; k < p.length / 3; k++) {
      if (Math.hypot(p[k * 3], p[k * 3 + 2]) > 0.12) continue;
      if (p[k * 3 + 1] > top) {
        top = p[k * 3 + 1];
        up = n[k * 3 + 1];
      }
    }
    assert.ok(up > 0.8, `${row}/${w}: нормаль на макушке ${up.toFixed(3)}`);
  }
});
