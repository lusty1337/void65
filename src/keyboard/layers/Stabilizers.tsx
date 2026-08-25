import { useCallback, useLayoutEffect, useRef } from 'react';
import * as THREE from 'three';
import { useFrame } from '@react-three/fiber';
import { STAB_KEYS, stabHalfSpan } from '../layout';
import { THICKNESS } from '../stack';
import { buildStabHousing, buildStabWire } from '../stabGeometry';
import { shared } from '../shared';
import type { KeyLift } from '../keyLift';

// две ножки по краям длинной клавиши и стальная скоба между ними. ножек
// на клавиатуру всего десяток, но они одинаковые - инстансим, как свитчи.
// скобы разной длины: разнос ножек свой у каждой длинной клавиши

export default function Stabilizers({ spread }: { spread?: KeyLift }) {
  const housingRef = useRef<THREE.InstancedMesh>(null);
  const wireRefs = useRef<(THREE.Mesh | null)[]>([]);

  const housing = shared('stabHousing', buildStabHousing);

  // скоб пять, а длин среди них три: двухюнитовый Backspace и правый Shift
  // сходятся к одному минимальному разносу
  const wires = shared('stabWires', () => {
    const cache = new Map<number, THREE.BufferGeometry>();
    return STAB_KEYS.map((key) => {
      const half = stabHalfSpan(key.w);
      let geo = cache.get(half);
      if (!geo) {
        geo = buildStabWire(half);
        cache.set(half, geo);
      }
      return { key, geo };
    });
  });

  const write = useCallback((fly: Float32Array | null) => {
    const mesh = housingRef.current;
    if (!mesh) return;
    const m = new THREE.Matrix4();
    let i = 0;
    STAB_KEYS.forEach((key, k) => {
      const half = stabHalfSpan(key.w);
      const y = fly ? fly[k] : 0;
      for (const dx of [-half, half]) {
        m.makeTranslation(key.x + dx, y, key.z);
        mesh.setMatrixAt(i++, m);
      }
      // скобы обычные меши, каждая своей длины - двигаем напрямую
      const wire = wireRefs.current[k];
      if (wire) wire.position.y = y;
    });
    mesh.instanceMatrix.needsUpdate = true;
    mesh.computeBoundingSphere();
  }, []);

  useLayoutEffect(() => {
    write(spread ? spread.y : null);
  }, [write, spread]);

  const seen = useRef(-1);
  useFrame(() => {
    if (!spread || spread.rev === seen.current) return;
    seen.current = spread.rev;
    write(spread.y);
  });

  return (
    // стек ставит слой по центру, а ножка построена от подошвы, как свитч
    <group position={[0, -THICKNESS.stabilizers / 2, 0]}>
      <instancedMesh
        ref={housingRef}
        args={[housing, undefined, STAB_KEYS.length * 2]}
        castShadow
        receiveShadow
      >
        <meshStandardMaterial color="#24252b" roughness={0.55} metalness={0.1} envMapIntensity={0.4} />
      </instancedMesh>

      {wires.map(({ key, geo }, i) => (
        <mesh
          key={key.id}
          ref={(el) => {
            wireRefs.current[i] = el;
          }}
          geometry={geo}
          position={[key.x, 0, key.z]}
          castShadow
        >
          {/* сталь, а не латунь: проволока стабилизатора всегда стальная,
              а латунь здесь закреплена за рейкой корпуса - второй золотой
              предмет размывает акцент */}
          <meshStandardMaterial color="#b8bcc2" metalness={1} roughness={0.3} envMapIntensity={0.9} />
        </mesh>
      ))}
    </group>
  );
}
