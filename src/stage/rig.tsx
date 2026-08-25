import { Environment } from '@react-three/drei';
import { EffectComposer, Bloom, ToneMapping, SMAA } from '@react-three/postprocessing';
import { ToneMappingMode } from 'postprocessing';
import { useEffect, useRef, type MutableRefObject } from 'react';
import * as THREE from 'three';
import { RectAreaLightUniformsLib } from 'three-stdlib';
import { ENV_RES, FILL_LIGHTS, MSAA, SHADOW_SIZE } from './quality';

// схема предметной съёмки, а не три лампы вокруг объекта. вся разница
// в том, откуда берётся основная часть освещённости: у ламп она лепит одну
// грань и оставляет остальные чёрными, а форму предмету даёт то, что
// отражается в нём со всех сторон. поэтому основа - окружение в полную
// силу, а лампы только доводят.
//
// стоит это столько же: направленный источник без тени - доли миллисекунды,
// окружение вообще предпросчитанная карта

/** куда смотрят площадные источники: чуть выше плоскости стола */
const AIM = new THREE.Vector3(0, 0.8, 0);

export function StageRig({ floorRef }: { floorRef?: MutableRefObject<THREE.Mesh | null> }) {
  const fill = useRef<THREE.RectAreaLight>(null);
  const wrap = useRef<THREE.RectAreaLight>(null);

  // без инициализации таблиц rectAreaLight светит неправильно
  useEffect(() => {
    RectAreaLightUniformsLib.init();
  }, []);

  // разворот считаем, а не зашиваем углами: подобранный на глаз поворот
  // разъедется с позицией при первой же правке, и софтбокс уйдёт мимо
  useEffect(() => {
    fill.current?.lookAt(AIM);
    wrap.current?.lookAt(AIM);
  }, []);

  return (
    <>
      {/* основа освещённости, а не добавка. на четверти разрешения
          отражения в анодированном алюминии размазывались в ровное серое
          поле, и металл переставал быть металлом */}
      <Environment files="/hdri/studio.hdr" resolution={ENV_RES} environmentIntensity={0.45} />

      {/* ключевой: единственный с картой теней и единственный, кто лепит
          объём. его работа - направление и тень, а не вся освещённость */}
      <directionalLight
        castShadow
        position={[7, 13, 8.5]}
        intensity={0.85}
        color="#fff4e6"
        // не в полную силу: в разборке поднятая пластина накрывает половину
        // платы, и чёрные корпуса свитчей пропадали в чёрном - оставались
        // одни золотые контакты
        shadow-intensity={0.68}
        shadow-mapSize={[SHADOW_SIZE, SHADOW_SIZE]}
        shadow-radius={3}
        // смещения маленькие, а рамка теневой камеры поджата до того, что
        // в неё реально попадает: полтора раза по плотности текселя, и такая
        // карта маленький сдвиг выдерживает. на большом normalBias тень
        // у соприкасающихся деталей подавлялась целиком и включалась разом,
        // стоило зазору перевалить за порог - корпус на одном щелчке колеса
        // был без тени, а на следующем уже с ней
        shadow-bias={-0.00015}
        shadow-normalBias={0.008}
        shadow-camera-near={1}
        shadow-camera-far={44}
        shadow-camera-left={-11}
        shadow-camera-right={11}
        shadow-camera-top={11}
        shadow-camera-bottom={-11}
      />

      {/* софтбокс слева-спереди: широкий, близкий, слабый. держит левый
          торец и подошвы колпачков, куда ключевой не достаёт. площадной,
          а не точечный: точечный давал жёсткое пятно на ближних колпачках,
          а скруглённая грань читается скруглённой как раз от мягкого */}
      <rectAreaLight
        ref={fill}
        position={[-13, 8, 11]}
        width={24}
        height={15}
        intensity={0.62}
        color="#dde7ff"
      />

      {/* второй, узкий и снизу-спереди: держит передний борт, чтобы тот
          не обрывался в чёрное. на лёгком уровне его нет, см. quality.ts.

          слабый до предела не из осторожности: камера на сайте стоит НИЗКО,
          заметно ниже, чем в стенде, и видит ровно те передние грани
          колпачков, в которые он светит в упор. на полсилы вся раскладка
          уходила из графита в блёклый */}
      {FILL_LIGHTS > 1 && (
        <rectAreaLight
          ref={wrap}
          position={[3, -2.5, 13]}
          width={18}
          height={6}
          intensity={0.14}
          color="#c9d6f0"
        />
      )}

      {/* контровой холодный: кромка по дальним граням слева. ради этой пары
          всё и затевалось - страница чёрная, и без светящейся кромки силуэт
          на ней читается плоской вырезкой */}
      <directionalLight position={[-7, 8, -12]} intensity={0.9} color="#a9c4ff" />
      {/* тёплый: та же работа справа. разная температура - чтобы кромка
          не читалась обводкой, наведённой фильтром. на одном контровом
          в кувырке клавиатура наполовину пропадала */}
      <directionalLight position={[12, 5, -9]} intensity={0.4} color="#ffd7ad" />

      {/* пол ловит только тень: материал без собственного цвета, поэтому
          под клавиатурой лежит тень, а не серый круг */}
      <mesh
        ref={floorRef as never}
        receiveShadow
        rotation={[-Math.PI / 2, 0, 0]}
        position={[0, -0.002, 0]}
      >
        <planeGeometry args={[120, 120]} />
        <shadowMaterial opacity={0.55} />
      </mesh>

      {/* затенения складок здесь нет намеренно: оно рисует их по кадру,
          а не по геометрии, и при повороте объекта тёмные полосы ползут
          по корпусу в обратную сторону. SMAA вместо FXAA - он берёт края
          по образцам, а не угадывает по картинке, и тонкие кромки корпуса
          перестают дрожать на движении */}
      <EffectComposer multisampling={MSAA}>
        {/* порог низкий намеренно: на высоком в блум попадало только
            светящееся, и блики на скруглениях оставались сухими точками.
            теперь расплывается и верхний край колпачка - то, из-за чего
            снимок читается снятым, а не посчитанным */}
        <Bloom mipmapBlur intensity={0.42} luminanceThreshold={0.9} luminanceSmoothing={0.3} />
        <ToneMapping mode={ToneMappingMode.ACES_FILMIC} />
        <SMAA />
      </EffectComposer>
    </>
  );
}
