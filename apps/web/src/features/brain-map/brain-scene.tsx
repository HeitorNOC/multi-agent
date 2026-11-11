/**
 * A cena 3D do mapa (three.js via React Three Fiber). Arrastar gira, rolar aproxima, clicar abre.
 * Gira devagar sozinha até alguém mexer (e nunca, se o sistema pedir menos movimento).
 *
 * Carregada só quando o mapa é aberto (o resto do app não paga o peso do 3D).
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { Html, Line, OrbitControls } from "@react-three/drei";
import type { Mesh } from "three";
import type { MapEdge, MapNode, NodeState } from "./layout";

const COLOR: Record<NodeState, string> = {
  current: "#5eead4",
  history: "#a78bfa",
  idle: "#7dd3fc",
  running: "#fb923c",
  waiting: "#facc15",
  done: "#4ade80",
};
/** Com muitos itens, só áreas e o núcleo mostram rótulo sempre; o resto, ao passar o mouse. */
const ALWAYS_LABEL_LIMIT = 36;

export interface SceneProps {
  nodes: MapNode[];
  edges: MapEdge[];
  selected: string | null;
  onSelect: (node: MapNode) => void;
}

export default function BrainScene({ nodes, edges, selected, onSelect }: SceneProps) {
  const reduced = typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
  const [touched, setTouched] = useState(false);
  // Com o mouse sobre o mapa, a rotação pausa: fica fácil clicar num ponto.
  const [pointing, setPointing] = useState(false);
  const byId = useMemo(() => new Map(nodes.map((n) => [n.id, n])), [nodes]);
  const items = nodes.filter((n) => n.kind === "source" || n.kind === "agent").length;
  return (
    <Canvas camera={{ position: [0, 15, 25], fov: 42 }} dpr={[1, 2]}
      gl={{ antialias: true, alpha: true }}
      onPointerEnter={() => setPointing(true)}
      onPointerLeave={() => setPointing(false)}
    >
      <FitCamera />
      <ambientLight intensity={0.6} />
      <pointLight position={[0, 0, 0]} intensity={40} color="#60a5fa" distance={30} />
      <pointLight position={[10, 12, 10]} intensity={60} />
      {edges.map((e) => {
        const a = byId.get(e.from);
        const b = byId.get(e.to);
        if (!a || !b) return null;
        const lit = selected !== null && (selected === e.from || selected === e.to);
        return (
          <Line
            key={`${e.from}>${e.to}`}
            points={[a.position, b.position]}
            color={e.strong || lit ? "#7dd3fc" : "#38bdf8"}
            transparent
            opacity={e.strong || lit ? 0.9 : 0.28}
            lineWidth={e.strong || lit ? 2 : 1}
          />
        );
      })}
      {nodes.map((n) => (
        <Node key={n.id} node={n} selected={selected === n.id} alwaysLabel={n.kind === "core" || n.kind === "area" || items <= ALWAYS_LABEL_LIMIT} onSelect={onSelect} />
      ))}
      <OrbitControls
        enablePan={false}
        minDistance={6}
        maxDistance={80}
        autoRotate={!reduced && !touched && !pointing}
        autoRotateSpeed={0.5}
        onStart={() => setTouched(true)}
        makeDefault
      />
    </Canvas>
  );
}

/** Tela estreita (celular): a câmera se afasta para o anel de áreas caber de lado a lado. */
function FitCamera() {
  const { camera, size } = useThree();
  useEffect(() => {
    const aspect = size.width / Math.max(1, size.height);
    const k = aspect < 1.2 ? 1.2 / Math.max(aspect, 0.45) : 1;
    camera.position.setLength(Math.hypot(0, 15, 25) * k);
    camera.updateProjectionMatrix();
  }, [camera, size.width, size.height]);
  return null;
}

function Node({ node, selected, alwaysLabel, onSelect }: { node: MapNode; selected: boolean; alwaysLabel: boolean; onSelect: (n: MapNode) => void }) {
  const ref = useRef<Mesh>(null);
  const [hover, setHover] = useState(false);
  const color = COLOR[node.state];
  const radius = node.kind === "core" ? 1.15 : node.kind === "area" ? 0.5 * node.size : 0.26;
  const pulsing = node.state === "running" || node.state === "waiting";
  useFrame(({ clock }) => {
    if (!ref.current) return;
    const k = pulsing ? 1 + Math.sin(clock.elapsedTime * 4) * 0.12 : node.kind === "core" ? 1 + Math.sin(clock.elapsedTime * 1.2) * 0.03 : 1;
    ref.current.scale.setScalar(k * (hover || selected ? 1.25 : 1));
  });
  const clickable = node.kind === "source" || node.kind === "agent";
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
          if (clickable) onSelect(node);
        }}
      >
        <sphereGeometry args={[node.kind === "core" ? radius : Math.max(radius * 2.6, 0.75), 12, 12]} />
        <meshBasicMaterial transparent opacity={0} depthWrite={false} />
      </mesh>
      <mesh ref={ref} raycast={() => null}>
        <sphereGeometry args={[radius, node.kind === "core" ? 48 : 24, node.kind === "core" ? 48 : 24]} />
        {node.kind === "core" ? (
          <meshStandardMaterial color="#1d4ed8" emissive="#3b82f6" emissiveIntensity={1.2} roughness={0.3} metalness={0.4} />
        ) : (
          <meshStandardMaterial color={color} emissive={color} emissiveIntensity={selected || hover ? 0.9 : node.kind === "area" ? 0.35 : 0.5} roughness={0.4} />
        )}
      </mesh>
      {node.kind === "core" && (
        <mesh>
          <sphereGeometry args={[1.7, 32, 32]} />
          <meshBasicMaterial color="#60a5fa" transparent opacity={0.08} />
        </mesh>
      )}
      {/* O rótulo do núcleo é desenhado pela página, no centro (o núcleo nunca sai do centro). */}
      {node.kind !== "core" && (alwaysLabel || hover || selected) && (
        <Html
          center
          distanceFactor={20}
          // Área: rótulo abaixo do nó; itens: acima (os dois não se encontram).
          position={[0, node.kind === "area" ? -radius - 0.45 : radius + 0.4, 0]}
          style={{ pointerEvents: "none" }}
          zIndexRange={[80, 0]}
        >
          <div className="whitespace-nowrap text-center text-xs leading-tight text-slate-100">
            <span className={node.kind === "area" ? "font-semibold" : undefined}>{node.label}</span>
            {node.sublabel && <span className="block text-[10px] text-slate-300">{node.sublabel}</span>}
          </div>
        </Html>
      )}
    </group>
  );
}
