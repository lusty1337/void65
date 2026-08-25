import { useEffect, useMemo, useRef, type MutableRefObject } from 'react';
import * as THREE from 'three';
import { useFrame } from '@react-three/fiber';
import { createRevealUniforms, patchReveal, REVEAL_MAX } from '../keyboard/revealWave';
import type { KeyboardLayers, LayerName } from '../keyboard/types';

// первый такт входа: заставка уходит не в готовую картинку, сперва из
// центра волной прорисовывается сетка, и уже по ней нарастает материал.
// зритель успевает понять, что перед ним, а пауза на сборку шейдеров
// перестаёт читаться задержкой.
//
// это клон живой модели, а не вторая сборка: клон делит с оригиналом
// геометрию, три копирует ссылки, а не буферы. строить второй раз нельзя -
// на одни листы с восемью десятками вырезов уходят секунды главного потока

/** пауза после старта: заставка ещё растворяется */
const LEAD = 0.1;
/** сколько фронт идёт от центра до дальнего угла */
const SWEEP = 0.9;
// сколько держится в полной силе и сколько тает. уходит заметно раньше,
// чем материал доберётся до края: пока сетка висит поверх готовых
// колпачков, её диагонали читаются царапинами по пластику
const HOLD = 0.05;
const FADE = 0.45;

/** цвет каркаса - акцент сайта */
const WIRE = '#9fe84a';
/** во сколько сетка слабее сплошного цвета */
const WIRE_ALPHA = 0.38;

// только корпус и пластина. каркас обязан читаться каркасом - отдельными
// линиями, сквозь которые видно форму, - а шесть десятков оболочек
// колпачков по паре тысяч треугольников давали сплошное зелёное полотно.
// корпус даёт габарит, пластина - решётку вырезов, и предмет узнаётся
const WIRED: LayerName[] = ['bottomCase', 'plate'];

export default function WireGhost({
  layers,
  start,
}: {
  layers: MutableRefObject<KeyboardLayers | null>;
  /** тот же момент старта, что и у волны материала */
  start: MutableRefObject<number | null>;
}) {
  const uniforms = useMemo(createRevealUniforms, []);
  const material = useMemo(() => {
    const m = new THREE.MeshBasicMaterial({
      color: new THREE.Color(WIRE),
      wireframe: true,
      transparent: true,
      opacity: 0,
      depthWrite: false,
      // обычное смешивание, не аддитивное: линии пересекаются десятками,
      // каждое пересечение добавляет свет, и клавиатура превращалась
      // в белое пятно, которое блум растаскивал на весь экран
    });
    patchReveal(m, uniforms);
    return m;
  }, [uniforms]);

  // Object3D, а не Group: clone() отдаёт базовый тип, и сузить его нечем
  const ghost = useRef<THREE.Object3D | null>(null);
  const done = useRef(false);

  useEffect(
    () => () => {
      ghost.current?.removeFromParent();
      material.dispose();
    },
    [material],
  );

  useFrame(({ invalidate }) => {
    if (done.current) return;
    const groups = layers.current;
    if (!groups) return;

    // снимаем один раз и как можно раньше, ещё под заставкой, пока
    // материалы и так собираются. радиус фронта при этом ноль и не видно
    // ни линии, но программа каркаса линкуется вместе со всеми, а не
    // в момент появления на живой странице
    if (!ghost.current) {
      const root = groups.bottomCase?.parent;
      const capsIn = (groups.keycaps?.children.length ?? 0) > 0;
      if (!root || !capsIn) return;
      const copy = new THREE.Group();
      for (const name of WIRED) {
        const layer = groups[name];
        if (!layer) continue;
        const clone = layer.clone(true);
        clone.traverse((o) => {
          const mesh = o as THREE.Mesh;
          if (!mesh.isMesh) return;
          mesh.material = material;
          // в тенях не участвует: для карты сетка такой же непрозрачный
          // меш, и он отпечатался бы сплошным силуэтом
          mesh.castShadow = false;
          mesh.receiveShadow = false;
        });
        copy.add(clone);
      }
      // рядом с оригиналом, а не в сцену: он обязан ездить вместе с ним
      root.parent?.add(copy);
      ghost.current = copy;
      invalidate();
      return;
    }

    const t0 = start.current;
    if (t0 === null) return;
    const t = (performance.now() - t0) / 1000 - LEAD;
    if (t < 0) return;

    uniforms.uRevealR.value = Math.min(1, t / SWEEP) * REVEAL_MAX;
    // проявление и таяние разведены во времени: пока фронт идёт, каркас
    // набирает силу, иначе дальний край прорисуется уже полупрозрачным
    const out = (t - SWEEP - HOLD) / FADE;
    material.opacity =
      WIRE_ALPHA * Math.min(1, t / (SWEEP * 0.35)) * (1 - Math.max(0, Math.min(1, out)));

    if (out >= 1) {
      done.current = true;
      ghost.current.removeFromParent();
      ghost.current = null;
    }
    invalidate();
  });

  return null;
}
