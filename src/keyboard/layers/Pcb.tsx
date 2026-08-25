import { useMemo } from 'react';
import * as THREE from 'three';
import { roundedRectShape } from '../geometry';
import { TRAY_CORNER, USB, CASE_OUTER_DEPTH } from '../caseGeometry';
import { makePcbMaps, PCB_W, PCB_D, PCB_CLEARANCE } from '../pcbTexture';
import { shared } from '../shared';
import { THICKNESS } from '../stack';

// лист, вырезанный по лотку со скруглением под радиус фрезы - так же, как
// настоящую плату режут под конкретный корпус. простой бокс в 96% ширины
// давал прямой угол и размер, не сходящийся с раскладкой

const T = THICKNESS.pcb;


// размеры по спецификации USB Type-C, 1 юнит = 19.05 мм. габарит обоймы
// берём из caseGeometry: там же считается вырез под неё
const USB_SHELL_W = USB.shellW;
const USB_SHELL_H = USB.shellH;
const USB_MOUTH_W = 0.438; //  8.34 мм
const USB_MOUTH_H = 0.134; //  2.56 мм
const USB_DEPTH = 0.386; //  7.35 мм
const USB_TONGUE_W = 0.352; //  6.7 мм
const USB_TONGUE_H = 0.037; //  0.7 мм

// гнездо USB-C на задней кромке платы. прямоугольный брусок зеркального
// металла читался посторонним предметом, а не разъёмом: узнают его по двум
// вещам - проём не прямоугольный, а "стадион", и внутри стоит язычок
function UsbPort() {
  const shell = useMemo(() => {
    // "стадион": радиус скругления равен половине высоты, торцы полукруглые
    const stadium = (w: number, h: number) => roundedRectShape(w, h, h / 2);
    const shape = stadium(USB_SHELL_W, USB_SHELL_H);
    shape.holes.push(stadium(USB_MOUTH_W, USB_MOUTH_H));
    // фаска даёт развальцованный зев: у настоящего разъёма кромка обоймы
    // отбортована наружу, чтобы штекер заходил без прицеливания
    const g = new THREE.ExtrudeGeometry(shape, {
      depth: USB_DEPTH,
      bevelEnabled: true,
      bevelThickness: 0.012,
      bevelSize: 0.009,
      bevelSegments: 2,
      curveSegments: 10,
    });
    g.computeVertexNormals();
    return g;
  }, []);

  const tongue = useMemo(
    () => roundedRectShape(USB_TONGUE_W, USB_TONGUE_H, USB_TONGUE_H / 2),
    [],
  );

  return (
    // зев смотрит в −z, в сторону выреза, тело уходит на плату. обойма
    // выведена заподлицо с лицом корпуса: на настоящей клавиатуре щели там
    // нет, а утопленный зев читался дыркой в стене, за которой блестит
    <group position={[0, T / 2 + USB_SHELL_H / 2, -CASE_OUTER_DEPTH / 2 + 0.004]}>
      <mesh geometry={shell} castShadow>
        {/* никелированная обойма: металл, но глубоко матовый. верхняя грань
            лежит горизонтально прямо под софтбоксом, и на 0.46 она уходила
            в чистый белый с ореолом */}
        <meshStandardMaterial
          color="#565b62"
          metalness={1}
          roughness={0.72}
          envMapIntensity={0.22}
        />
      </mesh>

      {/* мостик к плате: гнездо стоит у лица корпуса, а кромка платы
          на восемь миллиметров позади, и между ними висел воздух. на живых
          клавиатурах разъём и правда выносят на отдельный язычок, чтобы он
          не тянул усилие на матрицу */}
      <mesh position={[0, -USB_SHELL_H / 2 - 0.012, USB_DEPTH * 0.5 + 0.14]}>
        <boxGeometry args={[USB_SHELL_W * 1.5, 0.024, 0.42]} />
        <meshStandardMaterial color="#15171c" roughness={0.6} metalness={0.2} envMapIntensity={0.35} />
      </mesh>

      {/* полость за язычком */}
      <mesh position={[0, 0, USB_DEPTH - 0.01]}>
        <planeGeometry args={[USB_MOUTH_W, USB_MOUTH_H]} />
        <meshStandardMaterial color="#0a0b0e" roughness={0.95} metalness={0} />
      </mesh>

      {/* язычок с контактами */}
      <mesh position={[0, 0, USB_DEPTH * 0.42]}>
        <extrudeGeometry
          args={[tongue, { depth: USB_DEPTH * 0.62, bevelEnabled: false, curveSegments: 6 }]}
        />
        <meshStandardMaterial color="#c9a24a" metalness={0.9} roughness={0.55} envMapIntensity={0.3} />
      </mesh>
    </group>
  );
}

export default function Pcb() {
  // три холста по два мегапикселя, и по одному из них идёт попиксельный
  // проход: строим один раз на страницу
  const maps = shared('pcbMaps', makePcbMaps);
  const geo = shared('pcbSheet', () => {
    const shape = roundedRectShape(PCB_W, PCB_D, Math.max(0.04, TRAY_CORNER - PCB_CLEARANCE));
    const g = new THREE.ExtrudeGeometry(shape, {
      depth: T,
      bevelEnabled: false,
      curveSegments: 8,
    });
    g.rotateX(-Math.PI / 2);
    // центрируем по своей толщине: BASE_Y в стеке - это ЦЕНТР слоя,
    // и остальные листы собраны по той же договорённости
    g.translate(0, -T / 2, 0);

    // ExtrudeGeometry кладёт UV в мировых единицах формы, а не в 0..1,
    // и текстура с разводкой попала бы на плату одним пикселем.
    // пересчитываем тем же отображением, каким генератор карт переводит
    // клавиши в пиксели
    const pos = g.attributes.position;
    const uv = new Float32Array(pos.count * 2);
    for (let i = 0; i < pos.count; i++) {
      uv[i * 2] = pos.getX(i) / PCB_W + 0.5;
      uv[i * 2 + 1] = 0.5 - pos.getZ(i) / PCB_D;
    }
    g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
    return g;
  });

  const normalScale = useMemo(() => new THREE.Vector2(0.6, 0.6), []);

  return (
    <group>
      <mesh geometry={geo} receiveShadow>
        {/* roughness и metalness приходят картой: у паяльной маски они одни,
            у золотых пятачков другие, а единые на всю плату давали светлую
            пластину вместо чёрного текстолита с золотом. множители на 1 -
            карта задаёт абсолютные значения */}
        <meshStandardMaterial
          map={maps.map}
          normalMap={maps.normalMap}
          normalScale={normalScale}
          roughnessMap={maps.ormMap}
          metalnessMap={maps.ormMap}
          roughness={1}
          metalness={1}
          envMapIntensity={0.45}
        />
      </mesh>
      <UsbPort />
    </group>
  );
}
