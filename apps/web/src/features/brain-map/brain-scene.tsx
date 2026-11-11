/**
 * A cena 3D do mapa (three.js via React Three Fiber), no estilo das referências: fundo quase preto
 * e quente, pontos pequenos e luminosos, ligações curvas e finas, rótulos em creme.
 *
 * Arrastar gira, rolar aproxima, clicar abre. Escolher um nó (clique ou "Ir para…") leva a câmera
 * até ele; "Recentrar" volta à vista inteira. Gira devagar sozinha até alguém mexer (nunca, se o
 * sistema pedir menos movimento). Carregada só quando o mapa abre.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { Html, Line, OrbitControls } from "@react-three/drei";
import { Vector3, type Mesh, type PerspectiveCamera } from "three";
import type { OrbitControls as OrbitControlsImpl } from "three-stdlib";
import { curve, type MapEdge, type MapNode, type NodeState } from "./layout";

/** Mesma cor do fundo da seção: a névoa apaga o lado de trás do mapa em direção a ela. */
const BACKGROUND = "#0b0a09";

const COLOR: Record<NodeState, string> = {
  current: "#a7bdb8",
  history: "#9d8cf0",
  idle: "#a8a29e",
  running: "#fb923c",
  waiting: "#facc15",
  done: "#4ade80",
};
const AREA_COLOR = "#5eead4";
const CORE_COLOR = "#f4ecd8";
/** Com muitos itens, só áreas e o núcleo mostram rótulo sempre; o resto, ao passar o mouse. */
const ALWAYS_LABEL_LIMIT = 36;

export interface SceneProps {
  nodes: MapNode[];
  edges: MapEdge[];
  selected: string | null;
  /** Nó para onde a câmera vai (`null`: a vista inteira). */
  focus: string | null;
  /** Muda a cada "Recentrar": volta à vista inteira mesmo sem foco. */
  recenter: number;
  onSelect: (node: MapNode) => void;
}

const nodeRadius = (n: MapNode) => (n.kind === "core" ? 0.9 : n.kind === "area" ? 0.55 * n.size : 0.22);

export default function BrainScene({ nodes, edges, selected, focus, recenter, onSelect }: SceneProps) {
  const reduced = typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
  const [touched, setTouched] = useState(false);
  // Com o mouse sobre o mapa, a rotação pausa: fica fácil clicar num ponto.
  const [pointing, setPointing] = useState(false);
  const byId = useMemo(() => new Map(nodes.map((n) => [n.id, n])), [nodes]);
  const items = nodes.filter((n) => n.kind === "source" || n.kind === "agent").length;
  // Raio do conjunto: a câmera e a névoa se ajustam a ele.
  const radius = useMemo(() => Math.max(4, ...nodes.map((n) => Math.hypot(...n.position) + nodeRadius(n))), [nodes]);
  const lines = useMemo(
    () =>
      edges.flatMap((e) => {
        const a = byId.get(e.from);
        const b = byId.get(e.to);
        return a && b ? [{ key: `${e.from}>${e.to}`, from: e.from, to: e.to, strong: !!e.strong, points: curve(a.position, b.position, `${e.from}>${e.to}`) }] : [];
      }),
    [edges, byId],
  );
  const labeled = nodes.filter((n) => n.kind === "area" || n.kind === "core");
  return (
    <Canvas
      camera={{ position: [0, radius, radius * 1.7], fov: 45, near: 0.1, far: 400 }}
      dpr={[1, 2]}
      gl={{ antialias: true, alpha: true }}
      onPointerEnter={() => setPointing(true)}
      onPointerLeave={() => setPointing(false)}
    >
      {/* O primeiro `Html` da cena nasce sempre vazio (drei + React 19): este, invisível, absorve isso. */}
      <Html position={[0, 0, 0]} style={{ display: "none" }}>
        <span />
      </Html>
      <CameraRig radius={radius} focus={focus ? (byId.get(focus) ?? null) : null} recenter={recenter} />
      <ambientLight intensity={0.5} />
      <pointLight position={[0, 0, 0]} intensity={30} color="#fdba74" distance={radius * 1.5} />
      <pointLight position={[radius, radius, radius]} intensity={40} color="#f4ecd8" />
      {lines.map((l) => {
        const lit = selected !== null && (selected === l.from || selected === l.to);
        const toCore = l.from === "core" || l.to === "core";
        return (
          <Line
            key={l.key}
            points={l.points}
            color={lit ? "#f4ecd8" : toCore ? "#5eead4" : l.strong ? "#fdba74" : "#a8a29e"}
            transparent
            opacity={lit ? 0.85 : toCore ? 0.35 : l.strong ? 0.6 : 0.22}
            lineWidth={lit ? 1.6 : 1}
          />
        );
      })}
      {nodes.map((n) => (
        <Node key={n.id} node={n} selected={selected === n.id} alwaysLabel={items <= ALWAYS_LABEL_LIMIT} onSelect={onSelect} />
      ))}
      {/* Rótulos fixos (núcleo e áreas) ficam aqui, no topo da cena, todos pelo mesmo `Label`. */}
      {labeled.map((a) => (
        <Label key={a.id} node={a} strong />
      ))}
      <OrbitControls
        enablePan={false}
        minDistance={3}
        maxDistance={radius * 6}
        autoRotate={!reduced && !touched && !pointing && focus === null}
        autoRotateSpeed={0.4}
        enableDamping
        dampingFactor={0.08}
        onStart={() => setTouched(true)}
        makeDefault
      />
    </Canvas>
  );
}

/**
 * Leva a câmera (e o ponto para onde ela gira) até o nó em foco, ou à vista inteira, num
 * movimento curto. A distância da vista inteira faz o mapa caber na tela, inclusive no celular.
 */
function CameraRig({ radius, focus, recenter }: { radius: number; focus: MapNode | null; recenter: number }) {
  const { camera, size, controls } = useThree();
  const home = useMemo(() => {
    const cam = camera as PerspectiveCamera;
    const aspect = size.width / Math.max(1, size.height);
    const vertical = (cam.fov * Math.PI) / 360;
    const half = Math.min(vertical, Math.atan(Math.tan(vertical) * aspect));
    // O mapa é um disco visto de cima em ângulo: cabe com folga a uma distância menor que a esfera.
    return (radius / Math.sin(half)) * 0.8;
  }, [camera, size.width, size.height, radius]);
  // Começa um pouco mais longe e chega perto (entrada curta, sem ficar no escuro).
  const placed = useRef(false);
  useEffect(() => {
    if (placed.current) return;
    placed.current = true;
    camera.position.set(0, 0.55, 0.84).setLength(home * 1.25);
  }, [camera, home]);
  const goal = useRef<{ target: Vector3; distance: number } | null>(null);
  useEffect(() => {
    goal.current = focus
      ? { target: new Vector3(...focus.position), distance: focus.kind === "area" ? Math.max(5, radius * 0.6) : 4 }
      : { target: new Vector3(0, 0, 0), distance: home };
  }, [focus, recenter, home, radius]);
  useFrame(() => {
    const c = controls as unknown as OrbitControlsImpl | null;
    const g = goal.current;
    if (!c || !g) return;
    c.target.lerp(g.target, 0.08);
    const offset = camera.position.clone().sub(c.target);
    const next = offset.length() + (g.distance - offset.length()) * 0.08;
    camera.position.copy(c.target).add(offset.setLength(next));
    c.update();
    if (c.target.distanceTo(g.target) < 0.01 && Math.abs(next - g.distance) < 0.02) goal.current = null;
  });
  // A névoa acompanha a distância da vista: o lado de trás do mapa fica mais apagado (profundidade).
  return <fog attach="fog" args={[BACKGROUND, home * 0.9, home + radius * 2.2]} />;
}

function Label({ node, strong }: { node: MapNode; strong?: boolean }) {
  const r = nodeRadius(node);
  // Núcleo e área: rótulo abaixo do nó; itens: acima (os dois não se encontram).
  const below = node.kind === "area" || node.kind === "core";
  const position: [number, number, number] = [node.position[0], node.position[1] + (below ? -r - 0.45 : r + 0.4), node.position[2]];
  const core = node.kind === "core";
  return (
    <Html center position={position} distanceFactor={22} style={{ pointerEvents: "none" }} zIndexRange={[60, 0]}>
      <div className="whitespace-nowrap text-center leading-tight [text-shadow:0_1px_6px_rgba(0,0,0,0.9)]">
        <span className={core ? "text-[15px] font-semibold text-[#f4ecd8]" : strong ? "text-[13px] font-semibold text-[#f4ecd8]" : "text-xs text-stone-200"}>{node.label}</span>
        {node.sublabel && !core && <span className="block text-[10px] text-stone-400">{node.sublabel}</span>}
      </div>
    </Html>
  );
}

function Node({ node, selected, alwaysLabel, onSelect }: { node: MapNode; selected: boolean; alwaysLabel: boolean; onSelect: (n: MapNode) => void }) {
  const ref = useRef<Mesh>(null);
  const [hover, setHover] = useState(false);
  const radius = nodeRadius(node);
  const color = node.kind === "core" ? CORE_COLOR : node.kind === "area" ? AREA_COLOR : COLOR[node.state];
  const pulsing = node.state === "running" || node.state === "waiting";
  useFrame(({ clock }) => {
    if (!ref.current) return;
    const k = pulsing ? 1 + Math.sin(clock.elapsedTime * 4) * 0.15 : node.kind === "core" ? 1 + Math.sin(clock.elapsedTime * 1.2) * 0.04 : 1;
    ref.current.scale.setScalar(k * (hover || selected ? 1.35 : 1));
  });
  const clickable = node.kind !== "core";
  return (
    <group position={node.position}>
      {/* Área de clique invisível, bem maior que o ponto: fácil de acertar com o mouse ou o dedo. */}
      <mesh
        // Transparente (não escondido): objetos escondidos ficam fora do teste de clique.
        onPointerOver={(e) => {
          e.stopPropagation();
          setHover(true);
          document.body.style.cursor = clickable ? "pointer" : "default";
        }}
        onPointerOut={() => {
          setHover(false);
          document.body.style.cursor = "default";
        }}
        onClick={(e) => {
          e.stopPropagation();
          onSelect(node);
        }}
      >
        <sphereGeometry args={[Math.max(radius * 2.4, 0.7), 12, 12]} />
        <meshBasicMaterial transparent opacity={0} depthWrite={false} />
      </mesh>
      <mesh ref={ref} raycast={() => null}>
        <sphereGeometry args={[radius, node.kind === "core" ? 40 : 20, node.kind === "core" ? 40 : 20]} />
        <meshStandardMaterial color={color} emissive={color} emissiveIntensity={selected || hover ? 1.1 : node.kind === "core" ? 0.9 : 0.6} roughness={0.5} />
      </mesh>
      {/* Halo suave: o "brilho" dos pontos das referências. */}
      <mesh raycast={() => null}>
        <sphereGeometry args={[radius * (node.kind === "core" ? 1.9 : 1.8), 16, 16]} />
        <meshBasicMaterial color={color} transparent opacity={selected || hover ? 0.16 : node.kind === "core" ? 0.1 : 0.07} depthWrite={false} />
      </mesh>
      {/* Núcleo e áreas têm rótulo próprio, na cena (ver `BrainScene`). */}
      {(node.kind === "source" || node.kind === "agent") && (alwaysLabel || hover || selected) && (
        <Html center distanceFactor={22} position={[0, radius + 0.4, 0]} style={{ pointerEvents: "none" }} zIndexRange={[80, 0]}>
          <div className="whitespace-nowrap text-center leading-tight [text-shadow:0_1px_6px_rgba(0,0,0,0.9)]">
            <span className="text-xs text-stone-200">{node.label}</span>
            {(hover || selected) && node.sublabel && <span className="block text-[10px] text-stone-400">{node.sublabel}</span>}
          </div>
        </Html>
      )}
    </group>
  );
}
