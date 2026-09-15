import { makeCutoutSheet } from '../geometry';
import { TRAY_WIDTH, TRAY_DEPTH, TRAY_CORNER } from '../caseGeometry';
import { THICKNESS } from '../stack';
import { SW } from '../switchGeometry';
import { shared } from '../shared';
import { REAL_GLASS } from '../../stage/quality';

const MM = 1 / 19.05;

// демпфирующая прокладка между платой и пластиной. вырез под каждый свитч
// не украшение: корпус проходит сквозь неё насквозь и стоит подошвой
// на плате, а лист без вырезов приподнял бы всю клавиатуру на свою толщину

// чуть шире корпуса свитча: пена мягкая, но втискивать её незачем
const HOLE = SW.body * MM + 0.03;

export default function Foam() {
  // как и пластина, общая заготовка и живёт до конца страницы
  const geo = shared('foam', () =>
    makeCutoutSheet(
      // по лотку: габарит один на все внутренности
      TRAY_WIDTH - 0.06,
      TRAY_DEPTH - 0.06,
      TRAY_CORNER,
      THICKNESS.foam,
      HOLE,
      false,
      // силикон режут штампом, и угол всегда сходит на радиус: по острым
      // вырез читался пластиком, а не мягкой прокладкой
      1.2 * MM,
    ),
  );

  return (
    <mesh geometry={geo} castShadow receiveShadow>
      {/* прозрачный силикон, и ключевое здесь attenuation: она красит то,
          что видно СКВОЗЬ материал, и делает его похожим на желе, а не на
          крашеный лист. цвет самой поверхности почти белый - у прозрачных
          тел диффузного цвета нет вовсе, он весь в поглощении по толщине.
          матовый чёрный лист в стопке не отличался ни от платы, ни от дна
          корпуса, и слой пропадал.

          блеск срезан: с clearcoat 0.8 и полным окружением прокладка
          бликовала ярче пластины и перетягивала кадр на себя, хотя это
          самая незаметная деталь сборки.

          отдельного прохода рендера она не стоит - проход уже идёт ради
          колпаков свитчей, лист лишь добавляется в его список.

          на лёгком уровне преломления нет, см. quality.ts. при этой толщине
          и этом поглощении просвет гаснет практически в ноль: настоящий
          лист на экране и так тёмный с мягким бликом, его и рисуем
          непрозрачным */}
      {REAL_GLASS ? (
        <meshPhysicalMaterial
          color="#eaf0ff"
          transmission={1}
          ior={1.41}
          thickness={THICKNESS.foam * 6}
          roughness={0.28}
          metalness={0}
          envMapIntensity={0.35}
          attenuationColor="#1b3f8f"
          attenuationDistance={0.09}
          specularIntensity={0.35}
        />
      ) : (
        <meshPhysicalMaterial
          color="#03050b"
          ior={1.41}
          roughness={0.28}
          metalness={0}
          envMapIntensity={0.35}
          specularIntensity={0.35}
        />
      )}
    </mesh>
  );
}
