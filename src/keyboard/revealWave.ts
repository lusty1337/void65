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
