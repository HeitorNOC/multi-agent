/**
 * Núcleo do Jarvis: um reator no lugar da esfera do núcleo. Anel luminoso com borda "erodida",
 * disco interno texturizado girando devagar, marcas em volta e dois anéis orbitais inclinados,
 * mais uma poeira de partículas ao redor da rede. Tudo na cor da fase (em espera, ouvindo,
 * pensando, respondendo) e pulsando com o nível da voz — no estilo quente do mapa da v2.
 *
 * O anel é um plano voltado para a câmera com um shader polar: raio e ângulo viram brilho, o que
 * dá a borda irregular por pixel em vez de uma malha deformada.
 */
import { useMemo, useRef, type RefObject } from "react";
import { useFrame } from "@react-three/fiber";
import { Billboard } from "@react-three/drei";
import { AdditiveBlending, BufferAttribute, BufferGeometry, Color, type Mesh, type Points, ShaderMaterial } from "three";

/** O que a página do Jarvis informa a cada quadro (lido por ref, sem re-render). */
export interface ReactorSignal {
  color: string;
  /** 0 a 1: voz (ouvindo ou falando). */
  level: number;
  /** Girando mais rápido enquanto pensa. */
  busy: boolean;
}

const vertex = /* glsl */ `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

const fragment = /* glsl */ `
  uniform vec3 uColor;
  uniform float uTime;
  uniform float uLevel;
  uniform float uSpin;
  varying vec2 vUv;

  float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
  float noise(vec2 p) {
    vec2 i = floor(p); vec2 f = fract(p); vec2 u = f * f * (3.0 - 2.0 * f);
    return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), u.x), mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), u.x), u.y);
  }
  float fbm(vec2 p) { float v = 0.0; float a = 0.5; for (int i = 0; i < 4; i++) { v += a * noise(p); p *= 2.03; a *= 0.5; } return v; }

  void main() {
    vec2 p = vUv - 0.5;
    float r = length(p) * 2.0;           // 0 no centro, 1 na borda do plano
    float a = atan(p.y, p.x);
    float t = uTime;
    float lvl = uLevel;

    // Anel principal, com a borda de fora comida por ruído.
    float ringR = 0.62 + lvl * 0.03;
    float erosion = fbm(vec2(a * 3.0 + t * 0.15, r * 8.0 - t * 0.3));
    float ring = exp(-pow((r - ringR) / (0.022 + lvl * 0.012), 2.0));
    float outer = exp(-pow(max(r - ringR, 0.0) / (0.09 + erosion * 0.07), 2.0)) * step(ringR, r) * (0.35 + erosion * 0.5);
    float glow = exp(-abs(r - ringR) * (9.0 - lvl * 3.0)) * 0.45;

    // Disco interno texturizado, girando.
    float aa = a + t * 0.12 * uSpin;
    float disc = smoothstep(ringR - 0.02, ringR - 0.14, r) * (0.18 + 0.32 * fbm(vec2(cos(aa), sin(aa)) * r * 9.0 + t * 0.05));
    float core = exp(-r * r * 30.0) * (0.55 + lvl * 0.8);

    // Marcas em volta (giram ao contrário) e um anel fino de fora.
    float ticks = step(0.72, fract((a - t * 0.06 * uSpin) * 72.0 / 6.2831853)) * exp(-pow((r - 0.8) / 0.012, 2.0)) * 0.55;
    float fine = exp(-pow((r - 0.9) / 0.006, 2.0)) * 0.35;

    float b = ring * (1.2 + lvl) + outer + glow + disc + ticks + fine + core;
    vec3 hot = mix(uColor, vec3(1.0, 0.97, 0.9), clamp(ring * 0.6 + core, 0.0, 1.0));
    float fade = smoothstep(1.0, 0.92, r);
    gl_FragColor = vec4(hot * b, clamp(b, 0.0, 1.0) * fade);
  }
`;

export function Reactor({ radius, signal }: { radius: number; signal: RefObject<ReactorSignal | null> }) {
  const material = useMemo(
    () =>
      new ShaderMaterial({
        vertexShader: vertex,
        fragmentShader: fragment,
        transparent: true,
        depthWrite: false,
        blending: AdditiveBlending,
        uniforms: { uColor: { value: new Color("#fdba74") }, uTime: { value: 0 }, uLevel: { value: 0 }, uSpin: { value: 1 } },
      }),
    [],
  );
  const ringA = useRef<Mesh>(null);
  const ringB = useRef<Mesh>(null);
  const heart = useRef<Mesh>(null);
  const target = useMemo(() => new Color(), []);
  useFrame(({ clock }, dt) => {
    const s = signal.current;
    const u = material.uniforms;
    u.uTime!.value = clock.elapsedTime;
    target.set(s?.color ?? "#fdba74");
    (u.uColor!.value as Color).lerp(target, Math.min(1, dt * 4));
    u.uLevel!.value += ((s?.level ?? 0) - u.uLevel!.value) * Math.min(1, dt * 10);
    u.uSpin!.value += ((s?.busy ? 4 : 1) - u.uSpin!.value) * Math.min(1, dt * 2);
    const spin = u.uSpin!.value as number;
    if (ringA.current) ringA.current.rotation.z += dt * 0.25 * spin;
    if (ringB.current) ringB.current.rotation.z -= dt * 0.18 * spin;
    if (heart.current) heart.current.scale.setScalar(1 + (u.uLevel!.value as number) * 0.25 + Math.sin(clock.elapsedTime * 1.4) * 0.03);
    for (const m of [ringA.current, ringB.current, heart.current]) {
      const mat = m?.material as { color?: Color } | undefined;
      mat?.color?.copy(u.uColor!.value as Color);
    }
  });
  // Maior que a esfera do núcleo: no Jarvis o reator é o protagonista.
  const size = radius * 6.4;
  return (
    <group>
      <Billboard>
        <mesh material={material} raycast={() => null}>
          <planeGeometry args={[size, size]} />
        </mesh>
      </Billboard>
      <mesh ref={heart} raycast={() => null}>
        <sphereGeometry args={[radius * 0.42, 32, 32]} />
        <meshBasicMaterial transparent opacity={0.55} blending={AdditiveBlending} depthWrite={false} />
      </mesh>
      <mesh ref={ringA} rotation={[1.1, 0.3, 0]} raycast={() => null}>
        <torusGeometry args={[radius * 2.5, 0.014, 8, 200]} />
        <meshBasicMaterial transparent opacity={0.35} blending={AdditiveBlending} depthWrite={false} />
      </mesh>
      <mesh ref={ringB} rotation={[-0.9, -0.6, 0.4]} raycast={() => null}>
        <torusGeometry args={[radius * 2.95, 0.009, 8, 200]} />
        <meshBasicMaterial transparent opacity={0.22} blending={AdditiveBlending} depthWrite={false} />
      </mesh>
    </group>
  );
}

/** Poeira luminosa em volta da rede (só no Jarvis). */
export function Dust({ radius, count = 900 }: { radius: number; count?: number }) {
  const ref = useRef<Points>(null);
  const geometry = useMemo(() => {
    const g = new BufferGeometry();
    const pos = new Float32Array(count * 3);
    // Determinístico (sem Math.random): a mesma poeira a cada abertura.
    let seed = 7;
    const rand = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    for (let i = 0; i < count; i++) {
      const u = rand() * 2 - 1;
      const th = rand() * Math.PI * 2;
      const rr = radius * (0.35 + Math.cbrt(rand()) * 1.25);
      const s = Math.sqrt(1 - u * u);
      pos.set([rr * s * Math.cos(th), rr * u * 0.7, rr * s * Math.sin(th)], i * 3);
    }
    g.setAttribute("position", new BufferAttribute(pos, 3));
    return g;
  }, [radius, count]);
  useFrame((_, dt) => {
    if (ref.current) ref.current.rotation.y += dt * 0.02;
  });
  return (
    <points ref={ref} geometry={geometry} raycast={() => null}>
      <pointsMaterial color="#fdba74" size={0.05} sizeAttenuation transparent opacity={0.45} depthWrite={false} blending={AdditiveBlending} />
    </points>
  );
}
