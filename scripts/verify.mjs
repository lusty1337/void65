// headless-приёмка страницы: гоняем настоящий Chrome с GPU, потому что
// иначе визуальную задачу не принять. кроме снимков проверяем числами три
// вещи - ошибки в консоли, отклик клавиш на курсор и отсутствие длинных
// блокировок главного потока после ухода заставки
import puppeteer from 'puppeteer-core';
import { mkdirSync, existsSync, readFileSync } from 'node:fs';

const CHROME = process.env.CHROME_PATH ?? 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const URL = process.env.VERIFY_URL ?? 'http://127.0.0.1:5173/';
const OUT = 'verify-out';
const W = Number(process.env.W ?? 1440);
const H = Number(process.env.H ?? 900);

if (!existsSync(CHROME)) {
  console.error(`Chrome не найден: ${CHROME}. Задай CHROME_PATH.`);
  process.exit(1);
}
mkdirSync(OUT, { recursive: true });

const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: true,
  // без принудительного GPU headless уходит в софтверный рендер и меряет
  // совсем не то
  args: ['--headless=new', '--use-angle=d3d11', '--enable-gpu', `--window-size=${W},${H}`],
  defaultViewport: { width: W, height: H },
});

const page = await browser.newPage();
const errors = [];
page.on('console', (m) => {
  if (m.type() === 'error') errors.push(m.text().slice(0, 200));
});
page.on('pageerror', (e) => errors.push(`pageerror: ${e.message.slice(0, 200)}`));

await page.evaluateOnNewDocument(() => {
  const t0 = performance.now();
  window.__marks = {};
  window.__long = [];
  new PerformanceObserver((l) => {
    for (const e of l.getEntries()) window.__long.push([Math.round(performance.now() - t0), Math.round(e.duration)]);
  }).observe({ entryTypes: ['longtask'] });
  setInterval(() => {
    const boot = document.querySelector('.v-boot');
    if (!window.__marks.entered && boot?.classList.contains('is-done')) {
      window.__marks.entered = Math.round(performance.now() - t0);
    }
  }, 25);
});

await page.goto(URL, { waitUntil: 'domcontentloaded', timeout: 60000 });

// заставка держится, пока не собраны шейдеры сцены
for (let i = 0; i < 90; i++) {
  if (await page.evaluate(() => window.__marks.entered)) break;
  await new Promise((r) => setTimeout(r, 500));
}
// вход - не одна анимация, а два такта: сперва каркас, следом материал
// по нему. снимать надо по ходу: к общим снимкам он давно отыграл,
// и сломаться может незаметно
const intro = [250, 700, 1250, 1900];
let waited = 0;
for (let i = 0; i < intro.length; i++) {
  await new Promise((r) => setTimeout(r, intro[i] - waited));
  waited = intro[i];
  await page.screenshot({ path: `${OUT}/i${i}-intro.png` });
}

// хвост волны проявления
await new Promise((r) => setTimeout(r, 1200));

// точки съёмки задаём в актах, а не долями документа: доли протухают при
// первой же правке высоты акта, и снимок с именем "разборка" оказывается
// посреди падения. раскадровку читаем из того же файла, что и сцена
const ACTS = [...readFileSync('src/stage/acts.ts', 'utf8').matchAll(
  /\{\s*id:\s*'(\w+)',\s*vh:\s*(\d+)\s*\}/g,
)].map((m) => ({ id: m[1], vh: Number(m[2]) }));
const SCROLLABLE = ACTS.reduce((sum, a) => sum + a.vh, 0) - 100;
const START = {};
ACTS.reduce((acc, a) => ((START[a.id] = acc / SCROLLABLE), acc + a.vh), 0);
const SPAN = Object.fromEntries(
  ACTS.map((a) => [a.id, (a.id === ACTS.at(-1).id ? a.vh - 100 : a.vh) / SCROLLABLE]),
);
/** доля прокрутки в точке `local` акта */
const at = (id, local) => Math.min(1, START[id] + SPAN[id] * local);

const shots = [
  ['a-hero', at('hero', 0)],
  ['b-tilt', at('hero', 0.55)],
  ['c-fall', at('drop', 0.4)],
  ['d-land', at('drop', 0.98)],
  ['e-build', at('build', 0.5)],
  ['f-apart', at('build', 0.95)],
  ['g-toss', at('order', 0.45)],
  ['h-price', at('order', 1)],
];
for (const [name, frac] of shots) {
  await page.evaluate((f) => {
    const max = document.body.scrollHeight - window.innerHeight;
    window.scrollTo(0, Math.round(max * f));
  }, frac);
  await new Promise((r) => setTimeout(r, 900));
  await page.screenshot({ path: `${OUT}/${name}.png` });
}

// волна от приземления идёт по своим часам, и на снимке её не поймать:
// к моменту кадра она отыграла. проверяем числом - встаём чуть ДО отметки
// удара, перешагиваем её и сразу читаем буфер подъёма
const landAt = START.build;
await page.evaluate((f) => {
  const max = document.body.scrollHeight - window.innerHeight;
  window.scrollTo(0, Math.round(max * (f - 0.02)));
}, landAt);
await new Promise((r) => setTimeout(r, 1400));
await page.evaluate((f) => {
  const max = document.body.scrollHeight - window.innerHeight;
  window.scrollTo(0, Math.round(max * (f + 0.004)));
}, landAt);
// сглаживание прокрутки доводит камеру до отметки не мгновенно
let impact = 0;
for (let i = 0; i < 30; i++) {
  await new Promise((r) => setTimeout(r, 60));
  const peak = await page.evaluate(() => {
    const l = window.__heroLift;
    if (!l) return 0;
    let max = 0;
    for (const v of l.y) if (v > max) max = v;
    return max;
  });
  if (peak > impact) impact = peak;
}

// подъём клавиш под курсором: жест легко сломать, не тронув ни одного
// пикселя вокруг, поэтому проверяем числом
await page.evaluate(() => window.scrollTo(0, 0));
await new Promise((r) => setTimeout(r, 700));
const stage = await page.evaluate(() => ({ w: window.innerWidth, h: window.innerHeight }));
const readLift = () =>
  page.evaluate(() => {
    const l = window.__heroLift;
    if (!l) return null;
    let max = 0;
    let n = 0;
    for (const v of l.y) {
      if (v > max) max = v;
      if (v > 0.005) n++;
    }
    return { max, n };
  });

// высоту ведём поиском, а не числом: клавиатура стоит в разном месте кадра
// на широком экране и на узком, и одна зашитая доля промахивалась мимо неё
let lifted = null;
for (const at of [0.66, 0.58, 0.5, 0.72, 0.44]) {
  for (let i = 0; i < 12; i++) {
    await page.mouse.move(stage.w * 0.48 + (i % 2), stage.h * at);
    await new Promise((r) => setTimeout(r, 80));
  }
  await new Promise((r) => setTimeout(r, 700));
  const got = await readLift();
  if (!got) break;
  if (!lifted || got.max > lifted.max) lifted = got;
  if (lifted.max > 0.1) break;
}
await page.screenshot({ path: `${OUT}/h-hover.png` });

const marks = await page.evaluate(() => window.__marks);
const lateJank = await page.evaluate(
  () => window.__long.filter(([t, d]) => d > 200 && window.__marks.entered && t >= window.__marks.entered),
);
await browser.close();

console.log(`ЗАСТАВКА УШЛА: ${marks.entered} мс`);
if (impact < 0.02) errors.push(`волна от приземления не пошла: пик ${impact.toFixed(4)}`);
else console.log(`ВОЛНА ОТ УДАРА: пик ${impact.toFixed(3)} юнита`);
if (!lifted) errors.push('первый экран не отдал буфер подъёма клавиш');
else if (lifted.max < 0.1 || lifted.n < 4)
  errors.push(`клавиши под курсором не поднялись: максимум ${lifted.max.toFixed(3)} на ${lifted.n} клавишах`);
else console.log(`ПОДЪЁМ: ${lifted.max.toFixed(3)} юнита, клавиш в волне ${lifted.n}`);

if (lateJank.length) {
  errors.push(`главный поток блокируется ПОСЛЕ заставки: ${JSON.stringify(lateJank)}`);
} else {
  console.log('после заставки блокировок нет');
}

console.log(`Снимки: ${OUT}/`);
if (errors.length) {
  console.error('ОШИБКИ:');
  errors.forEach((e) => console.error(`  ${e}`));
  process.exit(1);
}
console.log('OK');
