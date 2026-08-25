import { useMemo } from 'react';
import * as THREE from 'three';
import {
  buildSwitchBottom,
  buildSwitchTop,
  buildSwitchStem,
  buildSwitchSpring,
  buildSwitchPins,
  buildSwitchPole,
  buildSwitchContacts,
  SW,
  SWITCH_HEIGHT,
} from './switchGeometry';
import { SWITCH_TINT } from './materials';
import { shared } from './shared';
import type { SwitchType } from './types';

const MM = 1 / 19.05;

// одиночный переключатель для крупного плана. начало координат - подошва:
// свитч стоит на плате, как настоящий, и его можно ставить прямо на высоту
// слоя без поправок
export default function SwitchModel({ switchType }: { switchType: SwitchType }) {
  // цвет палитры задан для интерфейса, а как диффузное альбедо тот же
  // светлый пластик под софтбоксом отдаёт больше единицы. приглушаем здесь,
  // чтобы палитра осталась нетронутой
  const stemColor = useMemo(
    () => new THREE.Color(SWITCH_TINT[switchType]).multiplyScalar(0.38),
    [switchType],
  );

  // те же заготовки, что у инстансов на клавиатуре: ключ общий
  const geo = shared('switchParts', () => ({
    bottom: buildSwitchBottom(),
    top: buildSwitchTop(),
    pole: buildSwitchPole(),
    pins: buildSwitchPins().plastic,
    contacts: buildSwitchContacts(),
    spring: buildSwitchSpring(),
    stem: buildSwitchStem(),
  }));

  return (
    <group>
      {/* нейлоновый низ: матовый, почти без отражений, чтобы свитч
          не выглядел цельной стекляшкой.

          DoubleSide обязателен: корпус собран оболочкой из колец, у каждой
          стенки ровно одна лицевая сторона. взгляд на стенку изнутри -
          сквозь колпак, снизу, из-под юбки - и грань отсекается как задняя,
          на её месте пустота */}
      <mesh geometry={geo.bottom} castShadow receiveShadow>
        {/* окружения побольше: у матового нейлона весь свет на
            боковых гранях приходит только отсюда, и на 0.35 юбка проваливалась
            в чистый чёрный, теряя связь с корпусом */}
        <meshStandardMaterial
          color="#1f2025"
          roughness={0.6}
          metalness={0.05}
          envMapIntensity={0.6}
          side={THREE.DoubleSide}
        />
      </mesh>

      {/* штырь внутри корпуса, на него надета пружина.
          Виден сквозь колпак и объясняет, на чём она держится */}
      <mesh geometry={geo.pole}>
        <meshStandardMaterial color="#24252a" roughness={0.58} metalness={0.05} envMapIntensity={0.3} />
      </mesh>

      {/* штырь и ножки снизу: видны, когда слои разъезжаются */}
      <mesh geometry={geo.pins}>
        <meshStandardMaterial color="#1c1d21" roughness={0.62} metalness={0.05} envMapIntensity={0.35} />
      </mesh>

      <mesh geometry={geo.contacts}>
        <meshStandardMaterial color="#b9a06a" metalness={1} roughness={0.4} envMapIntensity={0.5} />
      </mesh>

      {/* поликарбонатный колпак. transmission, а не opacity: полупрозрачность
          через альфу не преломляет и не даёт толщины, пластик выглядит
          плёнкой. матовый колпак читался белой деталью и прятал внутренности,
          а прозрачный показывает пружину и шток, ради которых он и нужен.

          transparent НЕ ставим: для transmission он не нужен, три рисует
          такой материал отдельным проходом. с ним колпак попадал в очередь
          смешивания и по сортировке перекрывал непрозрачные детали за собой -
          юбка и ножки то появлялись, то пропадали при повороте камеры */}
      <mesh geometry={geo.top} position={[0, SW.bottomH * MM, 0]}>
        <meshPhysicalMaterial
          color="#f6f9fc"
          transmission={0.99}
          ior={1.585}
          thickness={SW.wall * MM * 1.2}
          roughness={0.045}
          envMapIntensity={1.4}
          clearcoat={0.6}
          clearcoatRoughness={0.04}
          side={THREE.DoubleSide}
        />
      </mesh>

      {/* пружина: единственная подвижная деталь, которую видно */}
      <mesh geometry={geo.spring} position={[0, (SW.bottomH + SW.topH * 0.1) * MM, 0]}>
        <meshStandardMaterial color="#9aa0a8" metalness={1} roughness={0.42} envMapIntensity={0.6} />
      </mesh>

      {/* цвет штока - единственное, чем свитчи трёх типов отличаются внешне,
          поэтому он вынесен в палитру */}
      <mesh geometry={geo.stem} position={[0, SWITCH_HEIGHT + SW.stemUp * MM, 0]} castShadow>
        {/* шток из POM: матовый, а не глянцевый */}
        <meshStandardMaterial
          color={stemColor}
          roughness={0.62}
          metalness={0}
          envMapIntensity={0.1}
        />
      </mesh>
    </group>
  );
}
