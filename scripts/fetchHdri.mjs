// качаем CC0 studio HDRI в public/: локально, чтобы в рантайме не ходить
// на сторонний CDN
import { createWriteStream, mkdirSync, existsSync } from 'node:fs';
import { get } from 'node:https';

// Poly Haven, CC0: атрибуция не требуется. тянем через зеркало drei-assets
// на GitHub, потому что прямой dl.polyhaven.org из этой сети отваливается
// по таймауту. карта килопиксельная, и на металле это видно - отражения
// мыльные, заменить на 2k стоит, как только будет доступ к оригиналу
const URL =
  'https://raw.githubusercontent.com/pmndrs/drei-assets/456060a26bbeb8fdf79326f224b6d99b8bcce736/hdri/studio_small_03_1k.hdr';
const OUT = 'public/hdri/studio.hdr';

// FORCE=1 перекачивает поверх: иначе смена HDRI требует удалять файл руками,
// о чём забываешь ровно тогда, когда это важно
if (existsSync(OUT) && process.env.FORCE !== '1') {
  console.log(`${OUT} уже на месте (FORCE=1 чтобы перекачать)`);
  process.exit(0);
}
mkdirSync('public/hdri', { recursive: true });

function download(url, depth = 0) {
  if (depth > 5) throw new Error('слишком много редиректов');
  get(url, { headers: { 'user-agent': 'node' } }, (res) => {
    if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
      res.destroy();
      return download(new URL(res.headers.location, url).href, depth + 1);
    }
    if (res.statusCode !== 200) throw new Error(`HTTP ${res.statusCode}`);
    const file = createWriteStream(OUT);
    res.pipe(file);
    file.on('finish', () => console.log(`скачано: ${OUT}`));
  }).on('error', (e) => {
    throw e;
  });
}
download(URL);
