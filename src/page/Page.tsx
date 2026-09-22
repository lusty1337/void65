import { useCallback, useEffect, useRef, useState } from 'react';
import { useProgress } from '@react-three/drei';
import Stage from '../stage/Stage';
import { ACTS, SPAN, START } from '../stage/acts';
import FlipDiskNumber from './ui/FlipDiskNumber';
import { HERO, LAYERS, ORDER, SWITCHES } from './copy';
import { SWITCH_TINT } from '../keyboard/materials';
import type { SwitchType } from '../keyboard/types';
import './page.css';

// сцена лежит фоном и не принадлежит ни одной секции: текст скроллится
// поверх неё. прокрутка - единственный вход, из неё считается и кадр сцены,
// и то, какой слой подсвечен в списке

const height = (id: (typeof ACTS)[number]['id']) =>
  `${ACTS.find((a) => a.id === id)!.vh}svh`;

// палец, а не мышь. проверяем один раз: тип указателя за жизнь страницы
// не меняется, а от ответа зависит и текст первого экрана, и то, ловит ли
// сцена касания
const COARSE =
  typeof window !== 'undefined' && (window.matchMedia?.('(pointer: coarse)').matches ?? false);

// из чего складывается полоса на заставке. считать нечего: это две
// РАЗНЫЕ работы подряд, и доли между ними отмерены по замеру времени -
// файлы приезжают заметно быстрее, чем собираются программы шейдеров.
// ничего не идёт по таймеру: полоса стоит там, где стоит дело
const BOOT_FILES = 0.3;

// ход сцены до половины - это сборка слоёв, после - сборка программ:
// столько же, сколько стоит сама подготовка, см. RevealWave
const BOOT_LAYERS = 0.5;

/** подпись под полосой - что именно сейчас происходит */
function bootStage(boot: number, ready: boolean): string {
  if (ready) return 'Ready';
  if (boot < BOOT_FILES) return 'Loading model';
  if (boot < BOOT_FILES + (1 - BOOT_FILES) * BOOT_LAYERS) return 'Building layers';
  return 'Compiling shaders';
}

/** та же ступенька, по которой сцена ведёт разлёт слоёв */
const smooth = (t: number) => {
  const x = Math.min(1, Math.max(0, t));
  return x * x * (3 - 2 * x);
};

export default function Page({ price = '349' }: { price?: string }) {
  const progress = useRef(0);
  // высоту документа меряет страница, а положение прокрутки сцена читает
  // сама, на кадре: обработчик scroll и кадр браузера идут вразнобой
  const maxScroll = useRef(0);
  const redraw = useRef<(() => void) | null>(null);
  const revealStart = useRef<number | null>(null);

  const [ready, setReady] = useState(false);
  // ход сцены после загрузки файлов: сборка слоёв и программ. приходит
  // из RevealWave - только он знает, что там на самом деле происходит
  const [scene, setScene] = useState(0);
  const [entered, setEntered] = useState(false);
  // сколько слоёв снято - только для подсветки списка, сцена его не ждёт
  const [layerStep, setLayerStep] = useState(-1);
  // курсор ловится сценой, только пока клавиатура стоит ровно: ниже
  // страница обязана прокручиваться, а не цепляться за канвас
  const [heroTop, setHeroTop] = useState(true);
  // подсказка держится дольше поимки курсора: заваливание начинается
  // с первого щелчка, а дожить она обязана до момента, когда клавиатура
  // сама её закроет
  const [hintUp, setHintUp] = useState(true);
  // текст разборки ждёт, пока клавиатура отъедет: раньше он лёг бы поверх
  // ещё едущей модели, а на падении колпачка внизу экрана вообще ничего
  // быть не должно
  const [buildText, setBuildText] = useState(false);
  // цена проступает не сразу: сперва клавиатура обязана уйти за нижний
  // край, иначе счётчик и модель спорят за одно место в кадре
  const [priceUp, setPriceUp] = useState(false);

  // сколько файлов приехало - настоящая доля от самого three, а не таймер.
  // сюда попадают модель колпачков и студийная карта освещения
  const { progress: loaded } = useProgress();
  const files = Math.min(1, loaded / 100);
  // только вперёд. три пересоздаёт отрисовщик на первых кадрах, и сцена
  // на мгновение начинает считаться заново: сделанная работа от этого
  // не исчезает, а полоса, сдающая назад, читается сломанной
  const top = useRef(0);
  top.current = Math.max(top.current, BOOT_FILES * files + (1 - BOOT_FILES) * scene);
  const boot = ready ? 1 : top.current;
  // выбранный свитч меняет цвет штоков и подсветки в сцене и половину
  // строк характеристик
  const [switchType, setSwitchType] = useState<SwitchType>('tactile');
  // счётчик выбора: по нему сцена пускает по клавиатуре волну света нового
  // цвета. реф, а не проп - сцене важно САМО событие, а не число
  const ping = useRef(0);

  const pickSwitch = (id: SwitchType) => {
    if (id === switchType) return;
    setSwitchType(id);
    ping.current += 1;
    redraw.current?.();
  };

  useEffect(() => {
    const onScroll = () => {
      const max = document.body.scrollHeight - window.innerHeight;
      maxScroll.current = max;
      const p = max > 0 ? window.scrollY / max : 0;
      progress.current = p;
      redraw.current?.();

      // список идёт по тому же отрезку и по той же кривой, что разлёт
      // в сцене: с линейной долей подсветка обгоняла модель в начале хода
      // и отставала в конце
      const local = (p - START.build - SPAN.build * 0.22) / (SPAN.build * 0.78);
      const step = smooth(local);
      setLayerStep(local < 0 ? -1 : Math.min(LAYERS.length - 1, Math.floor(step * LAYERS.length)));
      // текст держится до самой сборки: в прилипшей секции он уезжал вверх
      // вместе с ней ровно на последнем слое, про который в нём и написано
      setBuildText(p > START.build + SPAN.build * 0.2 && p < START.order + SPAN.order * 0.02);
      setHeroTop(p < START.hero + SPAN.hero * 0.12);
      setHintUp(p < START.hero + SPAN.hero * 0.3);
      setPriceUp(p > START.order + SPAN.order * 0.84);
    };
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
    window.addEventListener('resize', onScroll);
    return () => {
      window.removeEventListener('scroll', onScroll);
      window.removeEventListener('resize', onScroll);
    };
  }, []);

  // заставка уходит по сигналу сцены, а не по таймеру: шейдеры собираются
  // секунды, и всё это время страница не отвечает - пусть эта пауза пройдёт
  // под заставкой
  const onCompiled = useCallback(() => {
    setReady(true);
    setTimeout(() => {
      setEntered(true);
      revealStart.current = performance.now();
      redraw.current?.();
    }, 340);
  }, []);

  useEffect(() => {
    document.body.style.overflow = entered ? '' : 'hidden';
    return () => {
      document.body.style.overflow = '';
    };
  }, [entered]);

  return (
    <div
      className={`v${COARSE ? ' v--touch' : ''}${entered ? ' is-in' : ''}${
        heroTop ? ' v--hero' : ''
      }${
        priceUp ? ' is-order' : ''
      }${buildText ? ' is-build' : ''}${hintUp ? ' is-hint' : ''}`}
    >
      {/* стоит перед сценой и ниже её по слою: канвас прозрачен, надпись
          видна сквозь него, но заваливающаяся клавиатура закрывает её собой.
          внутри .v-doc так нельзя - там свой слой, и текст всегда поверх 3D */}
      <div className="v-hint" aria-hidden="true">
        {HERO.hint}
      </div>

      <Stage
        progress={progress}
        maxScroll={maxScroll}
        redraw={redraw}
        switchType={switchType}
        ping={ping}
        revealStart={revealStart}
        onProgress={setScene}
        onCompiled={onCompiled}
      />

      <div className={`v-boot${ready ? ' is-ready' : ''}${entered ? ' is-done' : ''}`} aria-hidden="true">
        <div className="v-boot__inner">
          <div className="v-boot__mark">VOID / 65</div>
          {/* полоса показывает настоящий ход, а не время: сперва загрузка
              файлов, потом сборка сцены. дорисовать её до конца нечем -
              она доходит до края ровно тогда, когда сцена готова */}
          <div className="v-boot__bar">
            <i style={{ transform: `scaleX(${boot})` }} />
          </div>
          <div className="v-boot__row">
            {/* подпись идёт от той же доли, что и полоса: иначе она
                возвращалась бы к уже пройденному шагу */}
            <span>{bootStage(boot, ready)}</span>
            <span>{Math.round(boot * 100)}%</span>
          </div>
        </div>
      </div>

      {/* высоты секций берутся из тех же чисел, что и акты: прогресс
          считается от высоты документа, и стоит секции разойтись с актом
          на десяток vh, камера начинает жить отдельно от текста */}
      <div className="v-doc">
        <section className="v-hero" style={{ height: height('hero') }}>
          {/* прижато к первому экрану, а не растянуто на секцию: у акта
              запас высоты на заваливание, и без обёртки нижняя строка
              уезжала под сгиб */}
          <div className="v-hero__screen">
            <div className="v-grid v-hero__top v-rise" style={{ '--i': 0 } as never}>
              <div className="v-mark">
                VOID<i> / </i>65
              </div>
              <div className="v-data v-hero__edition">Edition 001 · 2026</div>
            </div>

            <div className="v-grid v-hero__head">
              <div className="v-tag v-hero__eyebrow v-rise" style={{ '--i': 1 } as never}>
                {HERO.eyebrow}
              </div>
              <h1 className="v-display v-hero__title v-rise" style={{ '--i': 2 } as never}>
                Void<b>65</b>
              </h1>
            </div>

            <div className="v-grid v-hero__sub v-rise" style={{ '--i': 3 } as never}>
              <p className="v-lead v-hero__lead">{COARSE ? HERO.leadTouch : HERO.lead}</p>
              <div className="v-hero__specs">
                {HERO.specs.map((s) => (
                  <span key={s}>{s}</span>
                ))}
              </div>
            </div>

            {/* выбор свитча стоит здесь, а не в блоке заказа: это
                единственная ручка на всей странице, и за ней нельзя гонять
                зрителя до самого низа и обратно. здесь же он и отвечает -
                по плате проходит волна света выбранного цвета, а дальше
                этим цветом горит свет из-под нажатой клавиши */}
            <div className="v-grid v-hero__pick v-rise" style={{ '--i': 4 } as never}>
              <div className="v-hero__pickBox">
                <div className="v-tag v-tag--mute v-hero__pickLabel">{HERO.switchLabel}</div>
                {/* кнопки-переключатели, а не radiogroup: роль радиогруппы
                    обещает переход стрелками, а его здесь нет - три кнопки
                    обходятся табуляцией, как и любые другие на странице */}
                <div className="v-pick" role="group" aria-label={HERO.switchLabel}>
                  {SWITCHES.map((sw) => (
                    <button
                      key={sw.id}
                      type="button"
                      aria-pressed={sw.id === switchType}
                      className={`v-pick__opt${sw.id === switchType ? ' is-on' : ''}`}
                      style={{ '--tint': SWITCH_TINT[sw.id] } as never}
                      onClick={() => pickSwitch(sw.id)}
                    >
                      <i className="v-pick__dot" />
                      <span className="v-pick__name">{sw.name}</span>
                      <span className="v-pick__kind">{sw.kind}</span>
                    </button>
                  ))}
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* пустая секция под падение колпачка. текста нет намеренно:
            в кадре одна деталь во весь экран, и подписи ей мешают */}
        <section className="v-drop" style={{ height: height('drop') }} aria-hidden="true" />

        <section className="v-build" style={{ height: height('build') }}>
          <div className="v-build__sticky">
            <div className="v-grid v-build__inner">
              <div className="v-build__list">
                <div className="v-build__head">
                  <div className="v-tag v-tag--mute">Exploded view</div>
                  <div className="v-build__meter">
                    {LAYERS.map((l, i) => (
                      <i key={l.name} className={i <= layerStep ? 'on' : undefined} />
                    ))}
                  </div>
                </div>
                {LAYERS.map((l, i) => (
                  <div
                    key={l.name}
                    className={`v-layer${i === layerStep ? ' is-live' : i < layerStep ? ' is-past' : ''}`}
                  >
                    <div className="v-layer__row">
                      <div className="v-layer__name">{l.name}</div>
                      <div className="v-layer__spec">{l.spec}</div>
                    </div>
                    <div className="v-layer__note">
                      <span>
                        <p>{l.note}</p>
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </section>

        <section className="v-order" style={{ height: height('order') }}>
          <div className="v-grid v-order__inner">
            <div className="v-order__price">
              <div className="v-tag v-tag--mute v-order__eyebrow">{ORDER.eyebrow}</div>
              <FlipDiskNumber value={`$${String(price).replace(/[^0-9]/g, '') || '349'}`} />
              <p className="v-note v-order__note">{ORDER.note}</p>
            </div>
            <div className="v-order__actions">
              <button type="button" className="v-btn v-btn--primary">
                {ORDER.cta}
              </button>
              <dl className="v-order__specs">
                {ORDER.specs(SWITCHES.find((s) => s.id === switchType)!).map(([label, value]) => (
                  <div className="v-spec" key={label}>
                    <dt>{label}</dt>
                    <dd>{value}</dd>
                  </div>
                ))}
              </dl>
            </div>
          </div>

          <div className="v-foot">
            <span>
              VOID<i style={{ fontStyle: 'normal', color: 'var(--bone-3)' }}> / </i>65
            </span>
            <span>© {new Date().getFullYear()} VOID65. All rights reserved.</span>
          </div>
        </section>
      </div>
    </div>
  );
}
