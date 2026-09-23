import * as THREE from 'three';

// появление модели круговой волной: во фрагментном шейдере отбрасывается
// всё, что дальше текущего радиуса от оси. прозрачностью так не сделать -
// половина слоёв непрозрачна, а у стеклянных колпаков своя очередь
// отрисовки, и подкрутка альфы развалила бы и то, и другое.
//
// мировые координаты считаем сами, а не берём worldPosition: тот
// объявляется только при части дефайнов, и на материале без карты
// окружения шейдер молча не собрался бы
export type RevealUniforms = {
  /** радиус фронта в мировых единицах */
  uRevealR: { value: number };
  /** 0 - эффект выключен совсем: отбрасывание в шейдере не выполняется */
  uRevealOn: { value: number };
};

/** дальний угол лотка: дальше этого радиуса геометрии нет */
export const REVEAL_MAX = 9.5;

export function createRevealUniforms(): RevealUniforms {
  return { uRevealR: { value: 0 }, uRevealOn: { value: 1 } };
}

// двойники: волна живёт не в самих материалах слоёв, а в их копиях, и копия
// надета на меш, только пока волна идёт. дорога не проверка в шейдере,
// а сам discard: шейдер, который может отбросить фрагмент, лишает
// видеокарту раннего теста глубины, и всё спрятанное под колпачками
// закрашивается целиком. мобильная видеокарта на таком шейдере ещё
// и перестаёт отсекать скрытое по плиткам. на замере discard в каждом
// материале стоил пятую часть кадра.
//
// двойник снимается один раз: свойства материалов слоёв на странице
// не меняются
const twins = new WeakMap<THREE.Material, THREE.Material>();

/**
 * перенести в двойник то, что на странице всё-таки меняется. двойник снимается
 * один раз, а цвет штока переставляет выбор свитча на первом экране: без переноса
 * вторая волна, та что над ценой, проявляет шток тем цветом, каким он был на входе
 */
export function syncTwin(
  plain: THREE.Material | THREE.Material[],
  twin: THREE.Material | THREE.Material[],
) {
  const from = Array.isArray(plain) ? plain : [plain];
  const to = Array.isArray(twin) ? twin : [twin];
  for (let i = 0; i < from.length; i += 1) {
    const src = from[i] as THREE.MeshStandardMaterial | undefined;
    const dst = to[i] as THREE.MeshStandardMaterial | undefined;
    if (src?.color && dst?.color) dst.color.copy(src.color);
  }
}

export function revealTwin(mat: THREE.Material, u: RevealUniforms): THREE.Material {
  let twin = twins.get(mat);
  if (!twin) {
    twin = mat.clone();
    // clone переносит свойства, но не правки шейдера: печать легенды
    // на колпачках и её ключ программы переносим руками
    twin.onBeforeCompile = mat.onBeforeCompile;
    twin.customProgramCacheKey = mat.customProgramCacheKey;
    patchReveal(twin, u);
    twins.set(mat, twin);
  }
  return twin;
}

/**
 * навесить волну на материал; повторный вызов ничего не делает. метка лежит
 * в userData, а не в отдельном списке: материал может прийти позже, вместе
 * с догрузившимся мешем
 */
export function patchReveal(mat: THREE.Material, u: RevealUniforms): boolean {
  if (mat.userData.reveal) return false;
  mat.userData.reveal = true;

  const prev = mat.onBeforeCompile;
  mat.onBeforeCompile = (shader, renderer) => {
    prev?.call(mat, shader, renderer);
    shader.uniforms.uRevealR = u.uRevealR;
    shader.uniforms.uRevealOn = u.uRevealOn;

    shader.vertexShader =
      'varying vec3 vRevealW;\n' +
      shader.vertexShader.replace(
        '#include <project_vertex>',
        `#ifdef USE_INSTANCING
           vRevealW = (modelMatrix * instanceMatrix * vec4(transformed, 1.0)).xyz;
         #else
           vRevealW = (modelMatrix * vec4(transformed, 1.0)).xyz;
         #endif
         #include <project_vertex>`,
      );

    shader.fragmentShader =
      'varying vec3 vRevealW;\nuniform float uRevealR;\nuniform float uRevealOn;\n' +
      shader.fragmentShader.replace(
        '#include <clipping_planes_fragment>',
        `#include <clipping_planes_fragment>
         if (uRevealOn > 0.5 && length(vRevealW.xz) > uRevealR) discard;`,
      );
  };
  // без своего ключа три может подсунуть программу, собранную до правки.
  // дописываем к прежнему, а не затираем: у колпачка уже есть свой ключ
  // от печати легенды, и общий подсунул бы двум исходникам одну программу
  const prevKey = mat.customProgramCacheKey;
  mat.customProgramCacheKey = () => `v65-reveal|${prevKey ? prevKey.call(mat) : ''}`;
  mat.needsUpdate = true;
  return true;
}
