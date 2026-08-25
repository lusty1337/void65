import { useLayoutEffect, useMemo } from 'react';
import * as THREE from 'three';
import { makeCutoutSheet } from '../geometry';
import { TRAY_WIDTH, TRAY_DEPTH, TRAY_CORNER } from '../caseGeometry';
import { THICKNESS } from '../stack';
import { shared } from '../shared';

const MM = 1 / 19.05;

// стальной лист, в который защёлкиваются свитчи. габарит берём у лотка -
// тот же источник, что у платы и пены, иначе слои разъезжаются

// стандартные 14 мм: корпус свитча 13.98, входит впритык
const SWITCH_HOLE = 14 * MM;

export default function Plate() {
  // общая заготовка и не освобождается: триангуляция листа с восемью
  // десятками вырезов - самая дорогая операция во всей сборке
  const geo = shared('plate', () =>
    makeCutoutSheet(
      TRAY_WIDTH - 0.04,
      TRAY_DEPTH - 0.04,
      TRAY_CORNER,
      THICKNESS.plate,
      SWITCH_HOLE,
      true,
    ),
  );

  const materials = useMemo(
    () => [
      // лицо и изнанка: порошковое покрытие почти не отражает, поэтому
      // шероховатость высокая, а окружение придавлено - иначе плоский лист
      // под софтбоксом ловит блик во всю площадь и перестаёт быть чёрным
      new THREE.MeshStandardMaterial({
        color: '#17181c',
        metalness: 0.65,
        roughness: 0.72,
        envMapIntensity: 0.3,
      }),
      // торцы и стенки вырезов, чуть светлее лица: их под сотню, и в одну
      // тьму с ним кромка выреза перестаёт читаться
      new THREE.MeshStandardMaterial({
        color: '#26282e',
        metalness: 0.7,
        roughness: 0.62,
        envMapIntensity: 0.35,
      }),
    ],
    [],
  );

  useLayoutEffect(() => () => materials.forEach((m) => m.dispose()), [materials]);

  return <mesh geometry={geo} material={materials} castShadow receiveShadow />;
}
