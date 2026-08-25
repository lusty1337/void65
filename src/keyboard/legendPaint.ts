import * as THREE from 'three';
import { ATLAS_COLS, ATLAS_ROWS, type LegendAtlas } from './keycapAtlas';

// легенда впечатана в материал самого колпачка, а не подвешена отдельной
// плоскостью над шляпкой. плоскость плоская, а шляпка вогнутая, и отсюда
// шло всё: буква висела над блюдцем с зазором в миллиметр и читалась
// наклейкой, на пологом ракурсе кромка блюдца перекрывала её по глубине
// и легенды пропадали разом со всех клавиш, а сам полупрозрачный меш
// поверх непрозрачного стоил отдельного прохода с сортировкой.
//
// подмешанная во фрагментном шейдере надпись оторваться от геометрии
// не может, перекрыться ей тоже, и сверх обычной отрисовки не стоит ничего.
//
// размеры площадки запекаются в исходник числами: они известны в момент
// создания материала и за его жизнь не меняются. ячейку атласа несёт
// per-instance атрибут - он живёт на геометрии и доходит до шейдера всегда

/** GLSL не принимает целое там, где ждёт float - печатаем с точкой */
const f = (n: number) => n.toFixed(6);

export function paintLegend(
  mat: THREE.MeshStandardMaterial,
  atlas: LegendAtlas,
  /** размеры площадки печати в координатах геометрии */
  size: { x: number; z: number },
  /**
   * ячейка атласа: пара чисел - у одиночного колпачка она одна на весь меш,
   * не передана - ячейку несёт per-instance атрибут legendCell
   */
  cell?: [number, number],
) {
  const fixed = cell !== undefined;

  const prev = mat.onBeforeCompile;
  mat.onBeforeCompile = (shader, renderer) => {
    prev?.call(mat, shader, renderer);
    shader.uniforms.uLegendMap = { value: atlas.texture };

    shader.vertexShader =
      `${fixed ? '' : 'attribute vec2 legendCell;'}
       varying vec2 vLegendUv;
       varying vec2 vLegendCell;
       varying float vLegendUp;
      ` +
      shader.vertexShader.replace(
        '#include <begin_vertex>',
        `#include <begin_vertex>
         // площадка центрирована на шляпке: за её пределами координата
         // уходит из [0,1] и надпись не рисуется. вторая ось развёрнута,
         // первая нет - у PlaneGeometry v растёт по +y, а поворот на −90°
         // вокруг X кладёт её +y в мировое −z, и прямая подстановка z
         // переворачивала надпись вверх ногами
         vLegendUv = vec2(
           position.x / ${f(size.x)} + 0.5,
           0.5 - position.z / ${f(size.z)}
         );
         vLegendCell = ${fixed ? `vec2(${f(cell[0])}, ${f(cell[1])})` : 'legendCell'};
         // только по обращённым вверх граням: изнанка проецируется в ту же
         // площадку, и без множителя надпись проступала на потолке полости -
         // её было видно из-под клавиши, в проёме крестового гнезда
         vLegendUp = smoothstep(0.2, 0.6, normal.y);`,
      );

    shader.fragmentShader =
      `uniform sampler2D uLegendMap;
       varying vec2 vLegendUv;
       varying vec2 vLegendCell;
       varying float vLegendUp;
      ` +
      shader.fragmentShader.replace(
        '#include <color_fragment>',
        `#include <color_fragment>
         // границу держим зажимом координаты, а не ветвлением: за площадкой
         // выборка упирается в край ячейки, где у атласа прозрачное поле.
         // мягкий край поверх - на случай самой длинной легенды, у неё буквы
         // подходят к границе вплотную и мазнули бы по кромке шляпки
         vec2 legendUv = clamp(vLegendUv, 0.0, 1.0);
         vec2 legendEdge = smoothstep(vec2(0.0), vec2(0.05), vLegendUv) *
                           smoothstep(vec2(1.0), vec2(0.95), vLegendUv);
         vec4 legendTexel = texture2D(
           uLegendMap,
           legendUv * vec2(${f(1 / ATLAS_COLS)}, ${f(1 / ATLAS_ROWS)}) + vLegendCell
         );
         diffuseColor.rgb = mix(
           diffuseColor.rgb,
           legendTexel.rgb,
           legendTexel.a * legendEdge.x * legendEdge.y * vLegendUp
         );`,
      );
  };

  // дописываем к прежнему, а не затираем: у вариантов с атрибутом
  // и с запечённой ячейкой исходники разные, и общий ключ подсунул бы
  // одному чужую программу. размеры площадки в ключе по той же причине
  const prevKey = mat.customProgramCacheKey;
  const own = `v65-legend-${fixed ? cell.join('_') : 'inst'}-${f(size.x)}`;
  mat.customProgramCacheKey = () => `${own}|${prevKey ? prevKey.call(mat) : ''}`;
  mat.needsUpdate = true;
}
