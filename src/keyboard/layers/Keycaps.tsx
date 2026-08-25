import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  type MutableRefObject,
} from 'react';
import * as THREE from 'three';
import { useGLTF } from '@react-three/drei';
import { invalidate, useFrame } from '@react-three/fiber';
import { KEYS, KEYCAP_GAP, ROW_STEP } from '../layout';
import type { KeyLift } from '../keyLift';

// щель между соседними колпачками в мировых единицах - около миллиметра
const GAP = 1 - KEYCAP_GAP;
import { CHARCOAL, CHARCOAL_ALPHA } from '../materials';
import { makeLegendAtlas, legendStretch } from '../keycapAtlas';
import { paintLegend } from '../legendPaint';
import { shared } from '../shared';

const KEYCAPS_URL = '/keycaps.glb';
useGLTF.preload(KEYCAPS_URL);

/** полуразмеры площадки печати легенды в мировых единицах */
export const LEGEND_AREA = { x: 0.64, z: 0.623 };

// клавиши по комбинации "ряд × ширина", под каждую свой меш. глобальный
// индекс тащим с собой: он нужен и для ячейки атласа, и для общего массива
// подъёма клавиш
const GROUPS = [...new Set(KEYS.map((k) => k.combo))].map((combo) => ({
  combo,
  keys: KEYS.map((key, index) => ({ key, index })).filter((e) => e.key.combo === combo),
}));

export default function Keycaps({
  accentColor,
  lift,
  spread,
  loose,
}: {
  accentColor: THREE.ColorRepresentation;
  /** подъём клавиш под курсором; без него колпачки стоят неподвижно */
  lift?: KeyLift;
  /** разлёт слоя в разборке: тот же механизм, своя амплитуда и свой ход */
  spread?: KeyLift;
  /**
   * индекс колпачка, который сейчас летит сам по себе, или −1. реф, а не
   * проп: гнездо гаснет посреди прокрутки, и гонять ради этого перерисовку
   * всей клавиатуры через состояние нельзя - слой сверит число на кадре
   */
  loose?: MutableRefObject<number>;
}) {
  const { nodes } = useGLTF(KEYCAPS_URL) as unknown as { nodes: Record<string, THREE.Mesh> };
  const refs = useRef<(THREE.InstancedMesh | null)[]>([]);
  // холст под два мегапикселя с семью десятками надписей. общий
  // с сорвавшимся колпачком и намеренно не освобождается: тот берёт из него
  // свою ячейку и живёт до конца страницы
  const atlas = shared('capAtlas', makeLegendAtlas);

  // легенды рисуются до загрузки веб-шрифта, поэтому перерисовываем
  useEffect(() => {
    let alive = true;
    document.fonts?.ready.then(() => {
      if (alive) {
        atlas.redraw();
        invalidate();
      }
    });
    return () => {
      alive = false;
    };
  }, [atlas]);

  // ячейка атласа приезжает в шейдер per-instance атрибутом на самой
  // геометрии. она общая на группу и приходит из .glb, поэтому проверяем,
  // не дописан ли атрибут уже: второму потребителю достанется та же
  const geometries = useMemo(
    () =>
      GROUPS.map((group) => {
        const geo = nodes[`cap_${group.combo}`].geometry;
        if (!geo.getAttribute('legendCell')) {
          const cells = new Float32Array(group.keys.length * 2);
          group.keys.forEach(({ index }, i) => {
            const [u, v] = atlas.cellOf(index);
            cells[i * 2] = u;
            cells[i * 2 + 1] = v;
          });
          geo.setAttribute('legendCell', new THREE.InstancedBufferAttribute(cells, 2));
        }
        return geo;
      }),
    [nodes, atlas],
  );

  // материал свой на группу: площадка печати задаётся в координатах
  // геометрии, а они у клавиш разной ширины разные.
  //
  // зерна PBT здесь нет намеренно: процедурный шум по roughness и bump
  // читался не фактурой пластика, а грязью - будто колпачки запылены.
  // литой PBT матовый и ровный, характер ему даёт форма и свет
  const materials = useMemo(
    () =>
      GROUPS.map((group) => {
        const w = group.keys[0].key.w;
        const sx = (w - GAP) / w;
        const m = new THREE.MeshStandardMaterial({
          // база белая, оттенок несёт instanceColor
          color: '#ffffff',
          // на 0.62 шляпки ловили широкий блик всей плоскостью и уходили
          // из графита в светло-серое: пластик читался глянцевым, каким
          // у колпачков он не бывает
          roughness: 0.88,
          metalness: 0,
          envMapIntensity: 0.32,
          // колпачок - оболочка со стенками, дном и шахтой, грани у неё
          // односторонние: с ракурсов, где видно ближнюю стенку изнутри,
          // она отсекалась как задняя, и сквозь колпачок просвечивала
          // его собственная полость
          side: THREE.DoubleSide,
        });
        paintLegend(m, atlas, {
          // делим на масштаб инстанса: он досыпается сверху, и без этого
          // на широких клавишах надпись растянется вместе с колпачком
          x: (LEGEND_AREA.x * legendStretch(w)) / sx,
          z: LEGEND_AREA.z / KEYCAP_GAP,
        });
        return m;
      }),
    [atlas],
  );

  useEffect(() => () => materials.forEach((m) => m.dispose()), [materials]);

  // матрицы собираются и на монтировании, и заново на каждом кадре
  // наведения, поэтому цикл один на оба случая. hop - подъём под курсором
  const write = useCallback(
    (hop: Float32Array | null, fly: Float32Array | null, gap: number) => {
      const m = new THREE.Matrix4();
      const rot = new THREE.Quaternion();
      const pos = new THREE.Vector3();
      const scl = new THREE.Vector3(1, 1, 1);
      // акцент, буквенный блок и модификаторы
      const TONES = {
        accent: new THREE.Color(accentColor),
        alpha: new THREE.Color(CHARCOAL_ALPHA),
        mod: new THREE.Color(CHARCOAL),
      };
      const tint = new THREE.Color();

      GROUPS.forEach((group, gi) => {
        const mesh = refs.current[gi];
        if (!mesh) return;
        group.keys.forEach(({ key, index }, i) => {
          // не поворачиваем: наклон ряда запечён в геометрию, и подошвы всех
          // клавиш лежат в одной плоскости, как на настоящей клавиатуре.
          // поворотом задиралась и подошва, отчего сбоку зияла щель
          rot.identity();
          pos.set(key.x, ROW_STEP[key.row] + (hop ? hop[index] : 0) + (fly ? fly[index] : 0), key.z);
          // зазор абсолютный, а не пропорциональный: множитель 0.94 отнимал
          // шесть процентов ШИРИНЫ, и у пробела в 6.25 юнита выходило 7 мм
          // щели с каждой стороны вместо миллиметра
          const sx = (key.w - GAP) / key.w;
          // гнездо улетевшего колпачка схлопываем в точку: инстанс-меш
          // рисуется одним вызовом, и выключить в нём элемент можно только
          // нулевым масштабом
          if (index === gap) scl.set(0, 0, 0);
          else scl.set(sx, 1, KEYCAP_GAP);
          m.compose(pos, rot, scl);
          mesh.setMatrixAt(i, m);
          // разброс тона ±2.5%, детерминированный: одинаковый пластик по всей
          // раскладке мгновенно читается компьютерной графикой
          const seed = (((key.x * 1000 + key.z * 37) | 0) * 2654435761) >>> 0;
          tint.copy(TONES[key.tone]).multiplyScalar(0.975 + (seed % 100) / 2000);
          mesh.setColorAt(i, tint);
        });
        mesh.instanceMatrix.needsUpdate = true;
        if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
      });
    },
    [accentColor],
  );

  useLayoutEffect(() => {
    write(lift ? lift.y : null, spread ? spread.y : null, loose?.current ?? -1);
  }, [write, lift, spread, loose]);

  // пружину крутит KeyLiftDriver, здесь только сверяем счётчик: иначе два
  // слоя шагали бы одну пружину дважды за кадр
  const seen = useRef(-1);
  const seenLoose = useRef(-1);
  useFrame(() => {
    const rev = (lift?.rev ?? 0) + (spread?.rev ?? 0);
    const gap = loose?.current ?? -1;
    if (rev === seen.current && gap === seenLoose.current) return;
    seen.current = rev;
    seenLoose.current = gap;
    write(lift ? lift.y : null, spread ? spread.y : null, gap);
  });

  return (
    <>
      {GROUPS.map((group, gi) => (
        <instancedMesh
          key={group.combo}
          ref={(el) => {
            refs.current[gi] = el;
          }}
          args={[geometries[gi], materials[gi], group.keys.length]}
          // без этого в разборке над корпусом висели все шесть слоёв,
          // а тени на нём не было вовсе: самый крупный силуэт в карту
          // не попадал
          castShadow
          receiveShadow
        />
      ))}
    </>
  );
}
