import { useMemo } from 'react';
import { toCreasedNormals } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { buildCase, CASE_DEFAULTS, type CaseParams } from '../caseGeometry';
import { BRASS } from '../materials';
import { shared } from '../shared';

// фрезерованный алюминиевый корпус: оболочка из колец. у коробки
// из ExtrudeGeometry фаска шла одинаковой по всему периметру, а высота была
// постоянной, и силуэт читался бруском, а не деталью с ЧПУ

// нормали с порогом излома, а не обычный computeVertexNormals: гладкие
// размазывают фаску в градиент, плоские гранят скругления. на 32° одно
// остаётся гладким, другое острым
const CREASE = (Math.PI / 180) * 32;

export type CaseShellProps = {
  params?: CaseParams;
  /** латунная рейка вдоль торца */
  brassRail?: boolean;
  wireframe?: boolean;
};

export default function CaseShell({
  params = CASE_DEFAULTS,
  brassRail = true,
  wireframe = false,
}: CaseShellProps) {
  // ключ по самим параметрам: на сайте корпус всегда один и тот же, а в
  // стенде ползунки дают новый ключ на каждое значение - там пересборка
  // и нужна
  const { shell, floor, base, outerPlate, innerPlate, tunnel } = useMemo(
    () =>
      shared(`case:${JSON.stringify(params)}`, () => {
        const built = buildCase(params);
        return { ...built, shell: toCreasedNormals(built.shell, CREASE) };
      }),
    [params],
  );

  const railZ = params.depth / 2 - params.bottomChamfer;

  return (
    <group>
      {/* metalness строго 1: анодированный алюминий - металл, промежуточные
          значения физически не значат ничего и дают пластик. тёмным его
          делает не чёрный цвет, а высокая шероховатость */}
      <mesh geometry={shell} castShadow receiveShadow>
        {/* на 0.44 металл ловил софтбокс почти зеркалом, верхняя фаска
            выбивалась в белый и уходила в блум. чёрное анодирование
            физически заметно матовее */}
        <meshStandardMaterial
          color="#34343b"
          metalness={1}
          roughness={0.64}
          envMapIntensity={0.8}
          wireframe={wireframe}
        />
      </mesh>

      {/* дно лотка, куда ляжет плата */}
      <mesh geometry={floor} receiveShadow>
        {/* почти не отражает: это внутренность корпуса, она обязана уходить
            в тень, иначе спорит по яркости с наружной стенкой */}
        <meshStandardMaterial
          color="#0c0c10"
          metalness={0.2}
          roughness={0.92}
          envMapIntensity={0.12}
          wireframe={wireframe}
        />
      </mesh>

      {/* окантовка выреза под разъём: тот же фрезерованный борт, просто
          прямоугольную дырку кольцами стенки не построить */}
      <mesh geometry={outerPlate}>
        <meshStandardMaterial color="#34343b" metalness={1} roughness={0.64} envMapIntensity={0.8} />
      </mesh>
      <mesh geometry={innerPlate}>
        <meshStandardMaterial color="#1a1a20" metalness={1} roughness={0.8} envMapIntensity={0.3} />
      </mesh>
      {/* канал даёт видимую толщину борта в вырезе */}
      <mesh geometry={tunnel}>
        <meshStandardMaterial color="#131318" metalness={0.9} roughness={0.85} envMapIntensity={0.2} />
      </mesh>

      <mesh geometry={base}>
        <meshStandardMaterial color="#17171c" metalness={1} roughness={0.6} envMapIntensity={0.4} />
      </mesh>

      {/* единственное тёплое пятно на корпусе, ради контраста с холодным
          анодированием */}
      {brassRail && (
        <mesh position={[0, params.frontHeight * 0.42, railZ]}>
          <boxGeometry args={[params.width * 0.34, 0.035, 0.02]} />
          <meshStandardMaterial color={BRASS} metalness={1} roughness={0.22} envMapIntensity={1.6} />
        </mesh>
      )}
    </group>
  );
}
