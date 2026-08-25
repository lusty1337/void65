import type * as THREE from 'three';

export type SwitchType = 'linear' | 'tactile' | 'clicky';

export type LayerName =
  | 'bottomCase'
  | 'pcb'
  | 'foam'
  | 'stabilizers'
  | 'switches'
  | 'plate'
  | 'keycaps';

// вертикальное смещение по каждому слою - то, чем их разводят снаружи
export type LayerOffsets = Partial<Record<LayerName, number>>;

// живые группы слоёв: сцена правит им position прямо на кадре, без React
export type KeyboardLayers = Record<LayerName, THREE.Group | null>;
