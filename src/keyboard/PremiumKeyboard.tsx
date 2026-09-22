import {
  forwardRef,
  Suspense,
  useImperativeHandle,
  useRef,
  type MutableRefObject,
  type RefObject,
} from 'react';
import type * as THREE from 'three';
import { SAGE, SWITCH_TINT } from './materials';
import type { KeyboardLayers, LayerName, LayerOffsets, SwitchType } from './types';
import { BASE_Y } from './stack';
import type { KeyLift } from './keyLift';
import Keycaps from './layers/Keycaps';
import Switches from './layers/Switches';
import Plate from './layers/Plate';
import Pcb from './layers/Pcb';
import Foam from './layers/Foam';
import Stabilizers from './layers/Stabilizers';
import CaseShell from './layers/CaseShell';

export type { KeyboardLayers, LayerName, LayerOffsets, SwitchType };
export { SWITCH_TINT };
export { default as SwitchModel } from './SwitchModel';

// порядок сборки - снизу вверх, тот же, каким слои проступают на входе.
// по нему же они и появляются в сцене: по одному на кадр
export const BUILD_ORDER: LayerName[] = [
  'bottomCase',
  'pcb',
  'foam',
  'stabilizers',
  'switches',
  'plate',
  'keycaps',
];

export type PremiumKeyboardProps = {
  layerOffsets?: LayerOffsets;
  switchType?: SwitchType;
  // акцентные колпачки: esc, enter, del, стрелки
  accentColor?: THREE.ColorRepresentation;
  // встроенный минимум света: страница со студийной схемой его выключает
  defaultLights?: boolean;
  /** подъём клавиш под курсором - общий буфер для колпачков и свитчей */
  lift?: KeyLift;
  /**
   * разлёт дугой в разборке: слои из множества деталей едут не пластом,
   * а волной от центра, и каждому нужен свой буфер - амплитуды и отрезки
   * хода у них разные
   */
  spread?: { keycaps?: KeyLift; switches?: KeyLift; stabilizers?: KeyLift };
  /** индекс колпачка, который сейчас летит сам по себе, или −1 */
  loose?: MutableRefObject<number>;
  /**
   * сколько слоёв уже построено. геометрия здесь процедурная, и вся разом
   * она занимает главный поток на секунды: страница в это время не рисует
   * ничего, заставка стоит мёртвой картинкой, а на телефоне браузер успевает
   * решить, что вкладка зависла. поэтому слои приходят по одному на кадр -
   * между ними браузер и дышит, и рисует настоящий ход подготовки.
   * по умолчанию видно всё: компонент обязан читаться и сам по себе
   */
  built?: number;
};

export const PremiumKeyboard = forwardRef<KeyboardLayers, PremiumKeyboardProps>(
  function PremiumKeyboard(
    {
      layerOffsets = {},
      switchType = 'tactile',
      accentColor = SAGE,
      defaultLights = true,
      lift,
      spread,
      loose,
      built = BUILD_ORDER.length,
    },
    ref,
  ) {
    const groups: Record<LayerName, RefObject<THREE.Group>> = {
      bottomCase: useRef<THREE.Group>(null),
      pcb: useRef<THREE.Group>(null),
      foam: useRef<THREE.Group>(null),
      stabilizers: useRef<THREE.Group>(null),
      switches: useRef<THREE.Group>(null),
      plate: useRef<THREE.Group>(null),
      keycaps: useRef<THREE.Group>(null),
    };

    // через геттеры, чтобы наружу всегда уходил актуальный .current
    useImperativeHandle(
      ref,
      () => ({
        get bottomCase() {
          return groups.bottomCase.current;
        },
        get pcb() {
          return groups.pcb.current;
        },
        get foam() {
          return groups.foam.current;
        },
        get stabilizers() {
          return groups.stabilizers.current;
        },
        get switches() {
          return groups.switches.current;
        },
        get plate() {
          return groups.plate.current;
        },
        get keycaps() {
          return groups.keycaps.current;
        },
      }),
      // eslint-disable-next-line react-hooks/exhaustive-deps
      [],
    );

    const y = (name: LayerName) => BASE_Y[name] + (layerOffsets[name] ?? 0);
    // сами группы стоят всегда: сцена держит на них ссылки и правит им
    // положение прямо на кадре. по одному приходит их содержимое
    const on = (name: LayerName) => BUILD_ORDER.indexOf(name) < built;

    return (
      <group>
        {/* чтобы компонент читался сам по себе, без внешней схемы */}
        {defaultLights && (
          <>
            <ambientLight intensity={0.55} />
            <directionalLight position={[7, 13, 8]} intensity={1.7} />
          </>
        )}

        {/* фрезерованная оболочка из колец: с вырезом под разъём и клином
            под наклон, как у настоящего корпуса */}
        <group ref={groups.bottomCase} position={[0, y('bottomCase'), 0]}>
          {on('bottomCase') && <CaseShell />}
        </group>

        <group ref={groups.pcb} position={[0, y('pcb'), 0]}>
          {on('pcb') && <Pcb />}
        </group>

        <group ref={groups.foam} position={[0, y('foam'), 0]}>
          {on('foam') && <Foam />}
        </group>

        <group ref={groups.stabilizers} position={[0, y('stabilizers'), 0]}>
          {on('stabilizers') && <Stabilizers spread={spread?.stabilizers} />}
        </group>

        <group ref={groups.switches} position={[0, y('switches'), 0]}>
          {on('switches') && (
            <Switches tint={SWITCH_TINT[switchType]} lift={lift} spread={spread?.switches} />
          )}
        </group>

        <group ref={groups.plate} position={[0, y('plate'), 0]}>
          {on('plate') && <Plate />}
        </group>

        <group ref={groups.keycaps} position={[0, y('keycaps'), 0]}>
          {/* группа держится всегда, меш появляется после загрузки .glb */}
          <Suspense fallback={null}>
            {on('keycaps') && (
              <Keycaps
                accentColor={accentColor}
                lift={lift}
                spread={spread?.keycaps}
                loose={loose}
              />
            )}
          </Suspense>
        </group>
      </group>
    );
  },
);
