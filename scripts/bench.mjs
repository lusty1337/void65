// замер цены кадра на всей прокрутке. fps в браузере здесь не годится:
// сцена рисует по требованию, а на мощной машине всё упирается в vsync,
// и любая правка покажет те же 60. поэтому цикл сцены глушится, кадры
// рисуются по одному, и после каждого readPixels ждёт, пока видеокарта
// действительно дорисует - в цифру входит и её работа, а не только JS.
//
// телефона под рукой нет, поэтому слабое железо изображаем двумя ручками:
// heavy даёт в девять раз больше пикселей, чем у телефона, и узким местом
// становится заливка, как на мобильной видеокарте; --cpu тормозит главный
// поток во столько раз
//
//   node scripts/bench.mjs --profile phone --tag base
//   node scripts/bench.mjs --profile heavy --cpu 4 --tag base --shots
import puppeteer from 'puppeteer-core';
import { mkdirSync, existsSync, readFileSync, writeFileSync } from 'node:fs';

const arg = (name, def) => {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 ? process.argv[i + 1] : def;
};
const flag = (name) => process.argv.includes(`--${name}`);

const CHROME = process.env.CHROME_PATH ?? 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const BASE = arg('url', 'http://127.0.0.1:4173/');
const TAG = arg('tag', 'run');
const CPU = Number(arg('cpu', 1));
const FRAMES = Number(arg('frames', 600));
const SOFT = flag('soft');

// телефон - бюджетный android: 360 на 800 при плотности 2
const PROFILES = {
  phone: { w: 360, h: 800, dpr: 2, mobile: true, q: 'low' },
  // вчетверо больше пикселей, чем у телефона: заливка уже заметна,
  // а памяти видеокарте ещё хватает, и провалы не смазывают цифры
  mid: { w: 720, h: 1600, dpr: 2, mobile: true, q: 'low' },
  heavy: { w: 1080, h: 2400, dpr: 2, mobile: true, q: 'low' },
  desktop: { w: 1920, h: 1080, dpr: 1, mobile: false, q: 'high' },
};
const NAME = arg('profile', 'phone');
const P = PROFILES[NAME];
if (!P) {
  console.error(`нет профиля ${NAME}: ${Object.keys(PROFILES).join(', ')}`);
  process.exit(1);
}
const Q = arg('q', P.q);

if (!existsSync(CHROME)) {
  console.error(`Chrome не найден: ${CHROME}. Задай CHROME_PATH.`);
  process.exit(1);
}
const OUT = 'verify-out/bench';
mkdirSync(OUT, { recursive: true });

const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: true,
  args: [
    '--headless=new',
    ...(SOFT ? ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] : ['--use-angle=d3d11', '--enable-gpu']),
    '--ignore-gpu-blocklist',
    '--disable-gpu-vsync',
    '--disable-frame-rate-limit',
    `--window-size=${P.w},${P.h}`,
  ],
  defaultViewport: { width: P.w, height: P.h, deviceScaleFactor: P.dpr, isMobile: P.mobile, hasTouch: P.mobile },
});

const page = await browser.newPage();
const errors = [];
page.on('console', (m) => {
  if (m.type() === 'error') errors.push(m.text().slice(0, 200));
});
page.on('pageerror', (e) => errors.push(`pageerror: ${e.message.slice(0, 200)}`));

// колпачок для падения выбирается случайно, а сравнивать снимки двух прогонов
// можно только на одном и том же. подменяем генератор до скриптов страницы
await page.evaluateOnNewDocument(() => {
  let seed = 7;
  Math.random = () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
});

const url = `${BASE}${BASE.includes('?') ? '&' : '?'}q=${Q}`;
await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 });

for (let i = 0; i < 240; i++) {
  if (await page.evaluate(() => document.querySelector('.v-boot')?.classList.contains('is-done'))) break;
  await new Promise((r) => setTimeout(r, 500));
}
// вход: каркас и волна материала идут по часам, дожидаемся их конца
await new Promise((r) => setTimeout(r, 3500));

const gpu = await page.evaluate(() => {
  const ctx = window.__stage?.().gl.getContext();
  const ext = ctx?.getExtension('WEBGL_debug_renderer_info');
  return ext ? ctx.getParameter(ext.UNMASKED_RENDERER_WEBGL) : 'нет данных';
});

const ACTS = [...readFileSync('src/stage/acts.ts', 'utf8').matchAll(/\{\s*id:\s*'(\w+)',\s*vh:\s*(\d+)\s*\}/g)].map(
  (m) => ({ id: m[1], vh: Number(m[2]) }),
);
const SCROLLABLE = ACTS.reduce((sum, a) => sum + a.vh, 0) - 100;
const START = {};
ACTS.reduce((acc, a) => ((START[a.id] = acc / SCROLLABLE), acc + a.vh), 0);
const actOf = (p) => [...ACTS].reverse().find((a) => p >= START[a.id])?.id ?? ACTS[0].id;

// один проход по всей странице: кадр за кадром, с прокруткой на каждом
const sweep = (frames) =>
  page.evaluate(async (frames) => {
    const s = window.__stage();
    s.setFrameloop('never');
    const gl = s.gl;
    const ctx = gl.getContext();
    const px = new Uint8Array(4);
    gl.info.autoReset = false;
    const max = document.body.scrollHeight - window.innerHeight;
    let t = s.clock.elapsedTime;
    const out = [];
    for (let i = 0; i < frames; i++) {
      const p = i / (frames - 1);
      window.scrollTo(0, Math.round(max * p));
      t += 1 / 60;
      gl.info.reset();
      const t0 = performance.now();
      s.advance(t);
      // до синхронизации - только работа главного потока: команды видеокарте
      // уходят в очередь и сами по себе ждать не заставляют
      const cpu = performance.now() - t0;
      gl.setRenderTarget(null);
      ctx.readPixels(0, 0, 1, 1, ctx.RGBA, ctx.UNSIGNED_BYTE, px);
      out.push([p, performance.now() - t0, gl.info.render.calls, gl.info.render.triangles, cpu]);
      // отпускаем поток: страница должна успеть обработать прокрутку
      if (i % 20 === 19) await new Promise((r) => setTimeout(r, 0));
    }
    return out;
  }, frames);

// прогрев: всё, что три дособерёт на первом проходе, в замер не идёт
await sweep(120);
if (CPU > 1) await page.emulateCPUThrottling(CPU);
const rows = await sweep(FRAMES);
if (CPU > 1) await page.emulateCPUThrottling(null);

const pct = (arr, q) => {
  const a = [...arr].sort((x, y) => x - y);
  return a[Math.min(a.length - 1, Math.floor(q * a.length))];
};
const stat = (list) => ({
  median: pct(list.map((r) => r[1]), 0.5),
  p90: pct(list.map((r) => r[1]), 0.9),
  max: Math.max(...list.map((r) => r[1])),
  cpu: pct(list.map((r) => r[4]), 0.5),
  calls: Math.round(list.reduce((s, r) => s + r[2], 0) / list.length),
  tris: Math.round(list.reduce((s, r) => s + r[3], 0) / list.length),
});

const report = { tag: TAG, profile: NAME, q: Q, cpu: CPU, soft: SOFT, gpu, all: stat(rows), acts: {} };
for (const a of ACTS) report.acts[a.id] = stat(rows.filter((r) => actOf(r[0]) === a.id));

const f = (n) => n.toFixed(2).padStart(7);
console.log(`\n${TAG} | ${NAME} ${P.w * P.dpr}x${P.h * P.dpr} q=${Q} cpu=${CPU}x | ${gpu}`);
console.log('акт       медиана     p90     max     cpu  вызовов  треугольников');
for (const [id, s] of [...Object.entries(report.acts), ['всё', report.all]]) {
  console.log(
    `${id.padEnd(8)} ${f(s.median)} ${f(s.p90)} ${f(s.max)} ${f(s.cpu)} ${String(s.calls).padStart(8)} ${String(s.tris).padStart(14)}`,
  );
}
console.log(`по медиане это ${(1000 / report.all.median).toFixed(0)} кадров в секунду на такой нагрузке`);
writeFileSync(`${OUT}/${TAG}-${NAME}${CPU > 1 ? `-cpu${CPU}` : ''}.json`, JSON.stringify(report, null, 2));

// снимки в одних и тех же точках - по ним сравнивается картинка до и после
if (flag('shots')) {
  const dir = `${OUT}/shots/${TAG}-${NAME}`;
  mkdirSync(dir, { recursive: true });
  const SPAN = Object.fromEntries(ACTS.map((a) => [a.id, (a.id === ACTS.at(-1).id ? a.vh - 100 : a.vh) / SCROLLABLE]));
  const at = (id, local) => Math.min(1, START[id] + SPAN[id] * local);
  const points = [
    ['a-hero', at('hero', 0)],
    ['b-tilt', at('hero', 0.55)],
    ['c-fall', at('drop', 0.4)],
    ['d-land', at('drop', 0.98)],
    ['e-build', at('build', 0.5)],
    ['f-apart', at('build', 0.95)],
    ['g-toss', at('order', 0.45)],
    ['h-price', at('order', 1)],
  ];
  for (const [name, p] of points) {
    await page.evaluate(async (p) => {
      const s = window.__stage();
      const max = document.body.scrollHeight - window.innerHeight;
      window.scrollTo(0, Math.round(max * p));
      await new Promise((r) => setTimeout(r, 50));
      // сглаживание прокрутки догоняет цель за пару сотен кадров
      let t = s.clock.elapsedTime;
      for (let i = 0; i < 240; i++) s.advance((t += 1 / 60));
      // волна от удара идёт по настоящим часам, а кадры выше пролетают
      // быстрее её полутора секунд. пока она идёт, клавиатура доворачивается
      // к месту удара, и два прогона снимали бы её в разной фазе
      await new Promise((r) => setTimeout(r, 1700));
      for (let i = 0; i < 240; i++) s.advance((t += 1 / 60));
    }, p);
    await new Promise((r) => setTimeout(r, 400));
    await page.screenshot({ path: `${dir}/${name}.png` });
  }
  console.log(`снимки: ${dir}/`);
}

await browser.close();
if (errors.length) {
  console.error('ОШИБКИ:');
  errors.forEach((e) => console.error(`  ${e}`));
  process.exit(1);
}
