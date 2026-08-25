import { useEffect, useMemo, useRef, type MutableRefObject } from 'react';
import * as THREE from 'three';
import { useFrame } from '@react-three/fiber';
import { useGLTF } from '@react-three/drei';
import { KEYCAP_GAP } from '../keyboard/layout';
import { CHARCOAL, CHARCOAL_ALPHA, SAGE_CAP } from '../keyboard/materials';
import { makeLegendAtlas, legendStretch } from '../keyboard/keycapAtlas';
import { paintLegend } from '../keyboard/legendPaint';
import { LEGEND_AREA } from '../keyboard/layers/Keycaps';
import { shared } from '../keyboard/shared';
import { DROP_INDEX, DROP_KEY, SEAT, type Shot } from './director';

// связка между первым экраном и разборкой: клавиатура роняет колпачок
// и уходит за кадр, а зритель дальше следит за ним. приземлившись точно
// в своё гнездо, он пускает по раскладке волну.
//
// это ТОТ ЖЕ колпачок, что стоит в раскладке, а не похожий: та же геометрия
// из общего .glb, тот же тон и та же ячейка общего атласа. пока он летит,
// слой колпачков гасит своё гнездо - иначе клавиша будет в двух местах.
//
// траектория считается в director вместе с камерой: только так падение
// и кадр не могут разъехаться


// источник, едущий рядом с колпачком: студийная схема рассчитана
// на клавиатуру целиком и стоит далеко, а падающая деталь крутится,
// и половину полёта к камере повёрнуты грани, в которые ни один из тех
// источников не светит - на чёрной странице колпачок просто пропадал.
//
// гореть он начинает только на полёте, но из сцены не исчезает: набор
// источников входит в шейдер, и новый заставил бы три пересобрать
// программы всех материалов ровно в момент срыва
const LAMP_OFFSET = new THREE.Vector3(1.2, 1.6, 2.6);
const LAMP_POWER = 18;

export default function FallingKey({ shot }: { shot: MutableRefObject<Shot> }) {
  const { nodes } = useGLTF('/keycaps.glb') as unknown as { nodes: Record<string, THREE.Mesh> };
  const group = useRef<THREE.Group>(null);
  const lamp = useRef<THREE.PointLight>(null);
  const atlas = shared('capAtlas', makeLegendAtlas);

  const geometry = nodes[`cap_${DROP_KEY.combo}`]?.geometry;

  // ширина колпачка - та же, что у него в раскладке
  const sx = (DROP_KEY.w - (1 - KEYCAP_GAP)) / DROP_KEY.w;

  // тот же материал, что у колпачков в раскладке, вплоть до впечатанной
  // легенды. ячейка атласа одна на весь меш и запекается в исходник -
  // инстансов тут нет
  const material = useMemo(() => {
    const m = new THREE.MeshStandardMaterial({
      color: new THREE.Color(
        DROP_KEY.tone === 'accent' ? SAGE_CAP : DROP_KEY.tone === 'alpha' ? CHARCOAL_ALPHA : CHARCOAL,
      ),
      roughness: 0.88,
      metalness: 0,
      envMapIntensity: 0.32,
      side: THREE.DoubleSide,
    });
    paintLegend(
      m,
      atlas,
      {
        x: (LEGEND_AREA.x * legendStretch(DROP_KEY.w)) / sx,
        z: LEGEND_AREA.z / KEYCAP_GAP,
      },
      atlas.cellOf(DROP_INDEX),
    );
    return m;
  }, [atlas, sx]);

  // атлас перерисовывается, когда догрузился веб-шрифт
  useEffect(() => {
    let alive = true;
    document.fonts?.ready.then(() => {
      if (alive) atlas.texture.needsUpdate = true;
    });
    return () => {
      alive = false;
    };
  }, [atlas]);

  useEffect(() => () => material.dispose(), [material]);

  useFrame(() => {
    const g = group.current;
    if (!g) return;
    const { keyLoose, keyPos, keyRot } = shot.current;

    if (lamp.current) lamp.current.intensity = keyLoose * LAMP_POWER;

    // не прячем через visible: невидимый объект не рисуется, а значит
    // и шейдер не собирается - программа линковалась при первом появлении
    // колпачка, уже на живой странице. схлопнутая в точку группа рисуется
    // всегда и компилируется под заставкой
    if (keyLoose < 0.5) {
      g.scale.setScalar(0.0004);
      g.position.set(SEAT.x, SEAT.y, SEAT.z);
      g.rotation.set(0, 0, 0);
      return;
    }

    g.scale.setScalar(1);
    g.position.copy(keyPos);
    g.rotation.copy(keyRot);
    lamp.current?.position.copy(keyPos).add(LAMP_OFFSET);
  });

  if (!geometry) return null;

  return (
    <>
      {/* decay=2 и короткая дистанция: светить в один колпачок, а не
          подсвечивать заодно клавиатуру, к которой он подлетает */}
      <pointLight ref={lamp} color="#e8eeff" intensity={0} distance={7} decay={2} />
      <group ref={group}>
        <mesh geometry={geometry} material={material} scale={[sx, 1, KEYCAP_GAP]} castShadow />
      </group>
    </>
  );
}
