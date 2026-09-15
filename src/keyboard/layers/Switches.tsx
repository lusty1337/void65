import { useCallback, useLayoutEffect, useMemo, useRef } from 'react';
import * as THREE from 'three';
import { useFrame } from '@react-three/fiber';
import { KEYS } from '../layout';
import { THICKNESS } from '../stack';
import { SWITCH_FOLLOW, type KeyLift } from '../keyLift';
import { shared } from '../shared';
import { REAL_GLASS, SWITCH_SPRINGS } from '../../stage/quality';
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
} from '../switchGeometry';

const MM = 1 / 19.05;
const N = KEYS.length;

// семь InstancedMesh, по одному на материал, а не по мешу на клавишу:
// иначе это восемь десятков вызовов отрисовки и столько же копий геометрии
// в памяти вместо семи.
//
// локальные высоты частей повторяют SwitchModel - там та же сборка,
// но в одном экземпляре для крупного плана
const PART_Y: Record<string, number> = {
  bottom: 0,
  pole: 0,
  pins: 0,
  contacts: 0,
  top: SW.bottomH * MM,
  spring: (SW.bottomH + SW.topH * 0.1) * MM,
  stem: SWITCH_HEIGHT + SW.stemUp * MM,
};

export default function Switches({
  tint,
  lift,
  spread,
}: {
  tint: string;
  /** тот же буфер, что у колпачков: свитч обязан идти следом за штоком */
  lift?: KeyLift;
  /** разлёт в разборке: один к одному, без коэффициента следования */
  spread?: KeyLift;
}) {
  const refs = {
    bottom: useRef<THREE.InstancedMesh>(null),
    pole: useRef<THREE.InstancedMesh>(null),
    pins: useRef<THREE.InstancedMesh>(null),
    contacts: useRef<THREE.InstancedMesh>(null),
    top: useRef<THREE.InstancedMesh>(null),
    spring: useRef<THREE.InstancedMesh>(null),
    stem: useRef<THREE.InstancedMesh>(null),
  };

  // одна сборка на страницу: те же заготовки берёт и крупный план свитча
  const geo = shared('switchParts', () => ({
    bottom: buildSwitchBottom(),
    top: buildSwitchTop(),
    pole: buildSwitchPole(),
    pins: buildSwitchPins().plastic,
    contacts: buildSwitchContacts(),
    spring: buildSwitchSpring(),
    stem: buildSwitchStem(),
  }));

  // цвет палитры задан для интерфейса и как диффузное альбедо выбивается
  // в белое под студийным софтбоксом
  const stemColor = useMemo(() => new THREE.Color(tint).multiplyScalar(0.38), [tint]);

  const write = useCallback((hop: Float32Array | null, fly: Float32Array | null) => {
    const m = new THREE.Matrix4();
    for (const [part, ref] of Object.entries(refs)) {
      const mesh = ref.current;
      if (!mesh) continue;
      const y = PART_Y[part];
      KEYS.forEach((key, i) => {
        m.makeTranslation(
          key.x,
          y + (hop ? hop[i] * SWITCH_FOLLOW : 0) + (fly ? fly[i] : 0),
          key.z,
        );
        mesh.setMatrixAt(i, m);
      });
      mesh.instanceMatrix.needsUpdate = true;
      mesh.computeBoundingSphere();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useLayoutEffect(() => {
    write(lift ? lift.y : null, spread ? spread.y : null);
  }, [write, lift, spread]);

  const seen = useRef(-1);
  useFrame(() => {
    const rev = (lift?.rev ?? 0) + (spread?.rev ?? 0);
    if ((!lift && !spread) || rev === seen.current) return;
    seen.current = rev;
    write(lift ? lift.y : null, spread ? spread.y : null);
  });

  return (
    // стек ставит слой по центру, а свитч построен от подошвы: без сдвига
    // вся клавиатура повиснет над платой
    <group position={[0, -THICKNESS.switches / 2, 0]}>
      {/* нейлоновый низ. DoubleSide обязателен: корпус собран оболочкой,
          и с изнанки его грани отсекались бы как задние */}
      <instancedMesh ref={refs.bottom} args={[geo.bottom, undefined, N]} castShadow receiveShadow>
        <meshStandardMaterial
          color="#1f2025"
          roughness={0.6}
          metalness={0.05}
          envMapIntensity={0.6}
          side={THREE.DoubleSide}
        />
      </instancedMesh>

      <instancedMesh ref={refs.pole} args={[geo.pole, undefined, N]}>
        <meshStandardMaterial color="#24252a" roughness={0.58} metalness={0.05} envMapIntensity={0.3} />
      </instancedMesh>

      <instancedMesh ref={refs.pins} args={[geo.pins, undefined, N]}>
        <meshStandardMaterial color="#1c1d21" roughness={0.62} metalness={0.05} envMapIntensity={0.35} />
      </instancedMesh>

      <instancedMesh ref={refs.contacts} args={[geo.contacts, undefined, N]}>
        <meshStandardMaterial color="#b9a06a" metalness={1} roughness={0.4} envMapIntensity={0.5} />
      </instancedMesh>

      {SWITCH_SPRINGS && (
        <instancedMesh ref={refs.spring} args={[geo.spring, undefined, N]}>
          <meshStandardMaterial color="#9aa0a8" metalness={1} roughness={0.42} envMapIntensity={0.6} />
        </instancedMesh>
      )}

      <instancedMesh ref={refs.stem} args={[geo.stem, undefined, N]} castShadow>
        <meshStandardMaterial color={stemColor} roughness={0.62} metalness={0} envMapIntensity={0.1} />
      </instancedMesh>

      {/* колпак последним: transmission рисуется отдельным проходом, и
          в буфер преломления должно попасть всё остальное. этот проход
          на всю клавиатуру - самый дорогой материал в сцене.

          на лёгком уровне стекло подделано, см. quality.ts. от стенки
          остаётся блик и лёгкая дымка поверх того, что за ней: на чисто
          чёрном колпак выходил темнее настоящего, дымку подбирали по снимкам
          разборки. смешивание своё: обычное гасило бы прозрачностью и сам
          блик, а у стекла он в полную силу */}
      <instancedMesh ref={refs.top} args={[geo.top, undefined, N]}>
        {REAL_GLASS ? (
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
        ) : (
          <meshPhysicalMaterial
            color="#20242a"
            ior={1.585}
            roughness={0.045}
            envMapIntensity={1.4}
            clearcoat={0.6}
            clearcoatRoughness={0.04}
            side={THREE.DoubleSide}
            transparent
            opacity={0.18}
            depthWrite={false}
            blending={THREE.CustomBlending}
            blendSrc={THREE.OneFactor}
            blendDst={THREE.OneMinusSrcAlphaFactor}
            // обе стороны за один вызов: при таком смешивании порядок
            // граней на картинке не сказывается
            forceSinglePass
          />
        )}
      </instancedMesh>
    </group>
  );
}
