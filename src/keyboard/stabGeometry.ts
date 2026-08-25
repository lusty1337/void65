import * as THREE from 'three';

// стабилизатор Cherry, врезной в пластину. размеры в миллиметрах и перевод
// в юниты один раз, как у свитча.
//
// у длинных клавиш нажатие приходится не в центр, и без стабилизатора
// колпачок перекашивает: две ножки по краям связаны проволокой, она
// и передаёт ход с одного края на другой

const MM = 1 / 19.05;

export const STAB = {
  /** корпус ножки: узкий вдоль клавиши, длинный поперёк */
  housingW: 6.8,
  housingD: 14.6,
  /** от платы до верхней кромки: чуть выше пластины, там защёлка */
  housingH: 5.6,
  /** проволока: сталь 1.5 мм */
  wireD: 1.5,
  /** насколько проволока вынесена вперёд от оси ножек */
  wireZ: 5.4,
  /** высота проволоки от платы */
  wireY: 3.6,
  corner: 0.5,
};

export const STAB_HEIGHT = STAB.housingH * MM;

// корпус ножки сужается кверху, как у свитча и по той же причине: прямая
// коробка не ловит свет на боковинах и читается бруском
export function buildStabHousing() {
  const w = STAB.housingW * MM;
  const d = STAB.housingD * MM;
  const h = STAB.housingH * MM;
  const geo = new THREE.BoxGeometry(w, h, d, 1, 1, 1);
  const pos = geo.attributes.position;
  for (let i = 0; i < pos.count; i++) {
    if (pos.getY(i) > 0) {
      pos.setX(i, pos.getX(i) * 0.88);
      pos.setZ(i, pos.getZ(i) * 0.94);
    }
  }
  geo.translate(0, h / 2, 0);
  geo.computeVertexNormals();
  return geo;
}

// проволока-скоба: от одной ножки вперёд, поперёк клавиши и назад ко второй.
// half - половина разноса ножек, он свой у каждой длинной клавиши
export function buildStabWire(half: number) {
  const y = STAB.wireY * MM;
  const zBack = 0;
  const zFront = STAB.wireZ * MM;
  const pts = [
    new THREE.Vector3(-half, y, zBack),
    new THREE.Vector3(-half, y, zFront * 0.55),
    new THREE.Vector3(-half * 0.94, y, zFront),
    new THREE.Vector3(half * 0.94, y, zFront),
    new THREE.Vector3(half, y, zFront * 0.55),
    new THREE.Vector3(half, y, zBack),
  ];
  // catmull-rom скругляет углы: у гнутой проволоки острых не бывает
  const curve = new THREE.CatmullRomCurve3(pts, false, 'catmullrom', 0.15);
  return new THREE.TubeGeometry(curve, 40, (STAB.wireD / 2) * MM, 6, false);
}
