// сцена на сайте одна и не прерывается - клавиатура не исчезает между
// секциями, а превращается, - поэтому и раскадровка одна, а не набор
// отдельных анимаций. высоты актов в vh, и из этих же чисел вёрстка берёт
// высоты секций: текст и камера физически не могут разъехаться

export type ActId = 'hero' | 'drop' | 'build' | 'order';

export const ACTS: { id: ActId; vh: number }[] = [
  // заваливание начинается с первого же щелчка колеса, поэтому коротко:
  // тут только поворот на 135° и подъём
  { id: 'hero', vh: 120 },
  // падение колпачка. на 180 vh оно читалось невесомостью: клавиатура
  // приближалась медленнее, чем падает предмет
  { id: 'drop', vh: 130 },
  // приземление, отъезд и разборка - семь слоёв, каждому нужно время
  { id: 'build', vh: 340 },
  // сборка, кувырок за нижний край, затем вторая клавиатура и цена;
  // последние сто vh не прокручиваются - это дно страницы
  { id: 'order', vh: 320 },
];

export const TOTAL_VH = ACTS.reduce((sum, a) => sum + a.vh, 0);

/** прокручиваемая высота: последний экран стоит на дне и не листается */
const SCROLLABLE = TOTAL_VH - 100;

/** доля прокрутки, на которой начинается каждый акт */
export const START: Record<ActId, number> = (() => {
  const out = {} as Record<ActId, number>;
  let acc = 0;
  for (const a of ACTS) {
    out[a.id] = acc / SCROLLABLE;
    acc += a.vh;
  }
  return out;
})();

export const SPAN: Record<ActId, number> = (() => {
  const out = {} as Record<ActId, number>;
  for (const a of ACTS) {
    // у последнего акта прокручивается не вся высота: нижние сто vh - дно
    // страницы. без поправки камера не успевала довести движение до конца
    const own = a.id === ACTS[ACTS.length - 1].id ? a.vh - 100 : a.vh;
    out[a.id] = own / SCROLLABLE;
  }
  return out;
})();

/** какой акт идёт на этой доле прокрутки и насколько он пройден */
export function actAt(p: number): { id: ActId; local: number } {
  for (let i = ACTS.length - 1; i >= 0; i--) {
    const a = ACTS[i];
    if (p >= START[a.id] || i === 0) {
      return { id: a.id, local: Math.min(1, Math.max(0, (p - START[a.id]) / SPAN[a.id])) };
    }
  }
  return { id: 'hero', local: 0 };
}
