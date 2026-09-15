import { useEffect, useMemo, useRef, useState } from 'react';
import * as THREE from 'three';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import { OrbitControls, Grid, Environment } from '@react-three/drei';
import { StageRig } from '../stage/rig';
import CaseShell from '../keyboard/layers/CaseShell';
import Pcb from '../keyboard/layers/Pcb';
import Foam from '../keyboard/layers/Foam';
import Switches from '../keyboard/layers/Switches';
import Stabilizers from '../keyboard/layers/Stabilizers';
import Plate from '../keyboard/layers/Plate';
import Keycaps from '../keyboard/layers/Keycaps';
import { SAGE_CAP } from '../keyboard/materials';
import { SWITCH_TINT } from '../keyboard/materials';
import SwitchModel from '../keyboard/SwitchModel';
import type { SwitchType } from '../keyboard/types';
import { BASE_Y } from '../keyboard/stack';
import { CASE_DEFAULTS, type CaseParams } from '../keyboard/caseGeometry';

// стенд для сборки модели, отдельной страницей: на основном сайте камера
// привязана к прокрутке, и деталь там не осмотреть

type LayerId = 'case' | 'pcb' | 'foam' | 'stabilizers' | 'switches' | 'plate' | 'keycaps';

const LAYERS: { id: LayerId; label: string; ready: boolean }[] = [
  { id: 'case', label: 'Корпус', ready: true },
  { id: 'pcb', label: 'Плата', ready: true },
  { id: 'foam', label: 'Пена', ready: true },
  { id: 'stabilizers', label: 'Стабилизаторы', ready: true },
  { id: 'switches', label: 'Свитчи', ready: true },
  { id: 'plate', label: 'Пластина', ready: true },
  { id: 'keycaps', label: 'Колпачки', ready: true },
];

type SliderDef = { key: keyof CaseParams; label: string; min: number; max: number; step: number };

const SLIDERS: SliderDef[] = [
  { key: 'frontHeight', label: 'Высота переда', min: 0.3, max: 1.2, step: 0.01 },
  { key: 'backHeight', label: 'Высота зада', min: 0.3, max: 1.4, step: 0.01 },
  { key: 'corner', label: 'Скругление углов', min: 0.05, max: 0.9, step: 0.01 },
  { key: 'topChamfer', label: 'Верхняя фаска', min: 0, max: 0.3, step: 0.005 },
  { key: 'bottomChamfer', label: 'Нижняя фаска', min: 0, max: 0.3, step: 0.005 },
  { key: 'wall', label: 'Толщина борта', min: 0.15, max: 1, step: 0.01 },
  { key: 'trayFloor', label: 'Дно лотка', min: 0.05, max: 0.7, step: 0.01 },
  { key: 'seamY', label: 'Высота шва', min: 0.1, max: 1.2, step: 0.01 },
  { key: 'seamDepth', label: 'Глубина шва', min: 0, max: 0.1, step: 0.002 },
  { key: 'seamLip', label: 'Фаска шва', min: 0, max: 0.06, step: 0.002 },
];

// отдаём камеру наружу для headless-съёмки: вести OrbitControls мышью
// из скрипта неточно, проще поставить её в нужную точку напрямую
function ExposeCamera() {
  const camera = useThree((s) => s.camera);
  const controls = useThree((s) => s.controls);
  const scene = useThree((s) => s.scene);
  useEffect(() => {
    const w = window as unknown as Record<string, unknown>;
    w.__labCam = camera;
    w.__labControls = controls;
    // сцену туда же: по габаритам мешей быстрее всего искать, какой кусок
    // геометрии вылез не туда
    w.__labScene = scene;
  }, [camera, controls, scene]);
  return null;
}

// подводит камеру под режим: свитч в полюнита и корпус в семнадцать требуют
// дистанций на два порядка, и крутить колесо вручную - минута на каждое
// переключение
function FitCamera({ solo }: { solo: boolean }) {
  const camera = useThree((s) => s.camera);
  const controls = useThree((s) => s.controls) as { target: THREE.Vector3; update: () => void } | null;
  useEffect(() => {
    const target = solo ? new THREE.Vector3(0, 0.34, 0) : new THREE.Vector3(0, 0.4, 0);
    // свитч со штоком высотой 0.8 юнита: при fov 32 он влезает с 2.4,
    // ближе камера садится внутрь корпуса
    const pos = solo ? new THREE.Vector3(1.3, 1.05, 1.75) : new THREE.Vector3(17, 12, 21);
    camera.position.copy(pos);
    if (controls) {
      controls.target.copy(target);
      controls.update();
    }
    camera.lookAt(target);
  }, [solo, camera, controls]);
  return null;
}

// просит перерисовать кадр при смене настроек: орбита и ползунки
// инвалидируют сцену сами, а переключение слоя нет
function LabRedraw({ deps }: { deps: unknown }) {
  const invalidate = useThree((s) => s.invalidate);
  useEffect(() => {
    invalidate();
  }, [deps, invalidate]);
  return null;
}

/** счётчик треугольников и кадров: читаем то, что реально ушло в GPU */
function Stats({ onSample }: { onSample: (tris: number, fps: number) => void }) {
  const scene = useThree((s) => s.scene);
  const acc = useRef({ frames: 0, t0: performance.now() });

  useFrame(() => {
    const a = acc.current;
    a.frames++;
    const dt = performance.now() - a.t0;
    // раз в полсекунды: чаще смысла нет, а setState на каждом кадре сам
    // съедает кадры
    if (dt < 500) return;

    // по сцене, а не по gl.info.render: последним проходом идёт полноэкранный
    // квадрат композера, и он затирает статистику двойкой
    let tris = 0;
    scene.traverse((o) => {
      const mesh = o as THREE.Mesh;
      if (!mesh.isMesh || !mesh.visible) return;
      const g = mesh.geometry;
      if (!g?.attributes?.position) return;
      const own = (g.index ? g.index.count : g.attributes.position.count) / 3;
      // у InstancedMesh геометрия одна, а рисуется count раз: без множителя
      // счётчик показывал пять тысяч там, где на экране сто с лишним
      const inst = (mesh as THREE.InstancedMesh).isInstancedMesh
        ? (mesh as THREE.InstancedMesh).count
        : 1;
      tris += own * inst;
    });

    onSample(Math.round(tris), Math.round((a.frames / dt) * 1000));
    a.frames = 0;
    a.t0 = performance.now();
  });
  return null;
}

export default function Lab() {
  const [on, setOn] = useState<Record<LayerId, boolean>>({
    case: true,
    pcb: true,
    foam: true,
    stabilizers: true,
    switches: true,
    plate: true,
    keycaps: true,
  });
  const [grid, setGrid] = useState(true);
  const [wireframe, setWireframe] = useState(false);
  const [rig, setRig] = useState(true);
  const [params, setParams] = useState<CaseParams>(CASE_DEFAULTS);
  const [stats, setStats] = useState({ tris: 0, fps: 0 });
  // крупный план: деталь одна, в натуральную величину, камера вплотную.
  // иначе свитч в полюнита не разглядеть рядом с корпусом в семнадцать
  const [solo, setSolo] = useState(false);
  // непрерывный рендер нужен только для замера кадров: сцена статична,
  // и от её перерисовки 165 раз в секунду раскручивается вентилятор - сам
  // кадр при этом занимает 4 мс из 6
  const [continuous, setContinuous] = useState(false);
  const [switchType, setSwitchType] = useState<SwitchType>('tactile');

  const toggle = (id: LayerId) => setOn((s) => ({ ...s, [id]: !s[id] }));
  const setParam = (key: keyof CaseParams, value: number) =>
    setParams((p) => ({ ...p, [key]: value }));

  // объект параметров пересоздаётся на каждый ход ползунка: за него
  // и цепляется мемоизация геометрии внутри CaseShell
  const caseParams = useMemo(() => params, [params]);

  return (
    <div className="lab">
      <Canvas
        className="lab__canvas"
        camera={{ position: [17, 12, 21], fov: 32 }}
        gl={{ antialias: true, alpha: false }}
        dpr={[1, 2]}
        frameloop={continuous ? 'always' : 'demand'}
        flat
      >
        <color attach="background" args={['#0b0b0e']} />
        {rig ? (
          // тот же риг, что на сайте: смотреть надо на то, что поедет
          <StageRig />
        ) : (
          // без постобработки, но с окружением: у металла с metalness=1 весь
          // цвет берётся из отражений, и на голых источниках он чёрный
          <>
            <Environment files={`${import.meta.env.BASE_URL}hdri/studio.hdr`} resolution={512} />
            <ambientLight intensity={0.35} />
            <directionalLight position={[6, 8, 5]} intensity={1.1} />
            <directionalLight position={[-6, 4, -5]} intensity={0.4} />
          </>
        )}

        {grid && (
          <Grid
            args={[40, 40]}
            cellSize={1}
            cellColor="#2a2a31"
            sectionSize={5}
            sectionColor="#3d3d47"
            fadeDistance={38}
            infiniteGrid
            position={[0, -0.002, 0]}
          />
        )}

        {solo ? (
          <SwitchModel switchType={switchType} />
        ) : (
          <>
            {on.case && <CaseShell params={caseParams} wireframe={wireframe} />}
            {/* каждый слой садится на свою высоту из стека, а не на глаз */}
            {on.pcb && (
              <group position={[0, BASE_Y.pcb, 0]}>
                <Pcb />
              </group>
            )}
            {on.foam && (
              <group position={[0, BASE_Y.foam, 0]}>
                <Foam />
              </group>
            )}
            {on.stabilizers && (
              <group position={[0, BASE_Y.stabilizers, 0]}>
                <Stabilizers />
              </group>
            )}
            {on.switches && (
              <group position={[0, BASE_Y.switches, 0]}>
                <Switches tint={SWITCH_TINT[switchType]} />
              </group>
            )}
            {on.plate && (
              <group position={[0, BASE_Y.plate, 0]}>
                <Plate />
              </group>
            )}
            {on.keycaps && (
              <group position={[0, BASE_Y.keycaps, 0]}>
                <Keycaps accentColor={SAGE_CAP} />
              </group>
            )}
          </>
        )}

        <OrbitControls
          makeDefault
          enableDamping
          dampingFactor={0.08}
          minDistance={solo ? 0.25 : 2}
          maxDistance={40}
          target={solo ? [0, 0.3, 0] : [0, 0.4, 0]}
        />
        <FitCamera solo={solo} />
        <Stats onSample={(tris, fps) => setStats({ tris, fps })} />
        <ExposeCamera />
        <LabRedraw deps={`${JSON.stringify(on)}|${solo}|${switchType}|${grid}|${rig}|${wireframe}|${JSON.stringify(params)}`} />
      </Canvas>

      <div className="lab__panel">
        <h1 className="lab__title">VOID65 · стенд</h1>
        <p className="lab__hint">ЛКМ — вращать, колесо — зум, ПКМ — сдвиг</p>

        <div className="lab__group">
          <div className="lab__legend">Режим</div>
          <label className="lab__row">
            <input type="checkbox" checked={solo} onChange={() => setSolo((v) => !v)} />
            Крупный план: свитч
          </label>
          <label className="lab__row">
            <input
              type="checkbox"
              checked={continuous}
              onChange={() => setContinuous((v) => !v)}
            />
            Непрерывный рендер
          </label>
          {(['linear', 'tactile', 'clicky'] as SwitchType[]).map((t) => (
              <label key={t} className="lab__row">
                <input
                  type="radio"
                  name="swtype"
                  checked={switchType === t}
                  onChange={() => setSwitchType(t)}
                />
                {t === 'linear' ? 'Glide Line' : t === 'tactile' ? 'Pulse Bump' : 'Snap Click'}
              </label>
            ))}
        </div>

        <div className="lab__group" hidden={solo}>
          <div className="lab__legend">Слои</div>
          {LAYERS.map((l) => (
            <label key={l.id} className={`lab__row${l.ready ? '' : ' lab__row--off'}`}>
              <input
                type="checkbox"
                checked={on[l.id]}
                disabled={!l.ready}
                onChange={() => toggle(l.id)}
              />
              {l.label}
              {!l.ready && ' — позже'}
            </label>
          ))}
        </div>

        <div className="lab__group">
          <div className="lab__legend">Сцена</div>
          <label className="lab__row">
            <input type="checkbox" checked={rig} onChange={() => setRig((v) => !v)} />
            Свет и постобработка
          </label>
          <label className="lab__row">
            <input type="checkbox" checked={grid} onChange={() => setGrid((v) => !v)} />
            Сетка
          </label>
          <label className="lab__row">
            <input type="checkbox" checked={wireframe} onChange={() => setWireframe((v) => !v)} />
            Каркас
          </label>
        </div>

        <div className="lab__group" hidden={solo}>
          <div className="lab__legend">Корпус</div>
          {SLIDERS.map((s) => (
            <label key={s.key} className="lab__slider">
              <span>
                {s.label}
                <b>{(params[s.key] as number).toFixed(3)}</b>
              </span>
              <input
                type="range"
                min={s.min}
                max={s.max}
                step={s.step}
                value={params[s.key] as number}
                onChange={(e) => setParam(s.key, Number(e.target.value))}
              />
            </label>
          ))}
        </div>
      </div>

      <div className="lab__stats">
        <div>
          треугольников <b>{stats.tris.toLocaleString('ru')}</b>
        </div>
        <div>
          кадров/с <b>{stats.fps}</b>
        </div>
      </div>
    </div>
  );
}
