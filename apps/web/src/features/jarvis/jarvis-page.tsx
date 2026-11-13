/**
 * Jarvis: o Chief of Staff como assistente de quem dirige a empresa, logo abaixo do gestor.
 *
 * A rede de agentes em 3D ocupa a tela, com um reator no centro que muda de cor e pulsa conforme
 * ele espera, ouve, pensa e responde. Dá para falar ("Jarvis, …", o botão de voz ou a barra de
 * espaço) e ele responde em voz alta; falar por cima interrompe. Ou escrever no painel de conversa.
 * À esquerda, o painel de sistemas e o que espera você agora; embaixo, o estado e a onda da voz.
 *
 * O cérebro é a conversa com o Chief (a mesma da área Conversa): ele conhece a situação da empresa
 * (pendências, trabalhos andando, quem do time trabalha), abre trabalhos quando o pedido exige
 * especialistas, e o parecer volta para a sua aprovação. A voz é a do navegador (Chrome ou Edge);
 * nada de áudio passa pelo Aurora, só o texto transcrito.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Maximize2, MessageSquarePlus, MessagesSquare, Mic, MicOff, Minimize2, PanelRightClose, Sparkles } from "lucide-react";
import { Link, useSearchParams } from "react-router";
import { ErrorNotice, LoadingRows } from "@/components/common";
import { Button } from "@/components/ui/button";
import { companyApi, conversationsApi, newKey, overviewApi } from "@/lib/api";
import { cn } from "@/lib/utils";
import { ACTIVITY_STATUS, StatusDot, useTeamActivity } from "../agents/activity";
import { BrainMap } from "../brain-map/brain-map";
import type { ReactorSignal } from "../brain-map/reactor";
import { Thread } from "../conversation/conversation-page";
import { micMeter, silence, speak, voiceSupported, VoiceLoop, type MicMeter, type VoiceMode } from "./voice";

const CORE = { label: "Chief of Staff", sublabel: "Jarvis" };
/** Painel de conversa ao lado (telas largas); no celular ele fica embaixo, sobre o mapa. */
const PANEL = 420 + 12;
/** Painel de sistemas à esquerda (telas médias para cima). */
const HUD = 256 + 12;
const VOICE_KEY = "aurora:jarvis-voz";
/** Sem fala por este tempo, "ouvindo" volta para "em espera". */
const LISTEN_MS = 9000;

type Phase = "standby" | "listening" | "thinking" | "speaking";

/** Cores das fases, na paleta do mapa (âmbar, turquesa, laranja, creme). */
const PHASE: Record<Phase, { color: string; label: string }> = {
  standby: { color: "#fdba74", label: "Em espera" },
  listening: { color: "#5eead4", label: "Ouvindo" },
  thinking: { color: "#fb923c", label: "Processando" },
  speaking: { color: "#f4ecd8", label: "Respondendo" },
};

const SUGGESTIONS = ["Me dá o resumo do dia", "O que está esperando minha aprovação?", "Quem do time está trabalhando agora?"];

function useMedia(query: string) {
  const [wide, setWide] = useState(() => typeof window !== "undefined" && window.matchMedia(query).matches);
  useEffect(() => {
    const m = window.matchMedia(query);
    const sync = () => setWide(m.matches);
    m.addEventListener("change", sync);
    return () => m.removeEventListener("change", sync);
  }, [query]);
  return wide;
}

const readVoicePref = () => {
  try {
    return localStorage.getItem(VOICE_KEY) === "1";
  } catch {
    return false;
  }
};

export function JarvisPage() {
  const frame = useRef<HTMLDivElement>(null);
  const queryClient = useQueryClient();
  const [params, setParams] = useSearchParams();
  const [chat, setChat] = useState(true);
  const [full, setFull] = useState(false);
  const [phase, setPhase] = useState<Phase>("standby");
  const [voiceOn, setVoiceOn] = useState(false);
  const [caption, setCaption] = useState("");
  const [error, setError] = useState<string | null>(null);
  const wide = useMedia("(min-width: 640px)");
  const hudShown = useMedia("(min-width: 768px)");
  const inset = { left: hudShown ? HUD : 0, right: chat && wide ? PANEL : 0 };
  const supported = voiceSupported();

  // Estado lido pela voz e pelo reator a cada quadro (sem re-render).
  const phaseRef = useRef<Phase>("standby");
  const signal = useRef<ReactorSignal>({ color: PHASE.standby.color, level: 0, busy: false });
  const level = useRef(0);
  const loop = useRef<VoiceLoop | null>(null);
  const mic = useRef<MicMeter | null>(null);
  const listenTimer = useRef<number | undefined>(undefined);
  const go = useCallback((p: Phase) => {
    phaseRef.current = p;
    setPhase(p);
    window.clearTimeout(listenTimer.current);
    if (p === "listening") listenTimer.current = window.setTimeout(() => phaseRef.current === "listening" && go("standby"), LISTEN_MS);
  }, []);

  // ── Conversa ────────────────────────────────────────────────────────────
  const list = useQuery({ queryKey: ["conversations"], queryFn: conversationsApi.list });
  const latest = list.data?.conversations.filter((c) => !c.agent_id).sort((a, b) => b.updated_at.localeCompare(a.updated_at))[0];
  const conversation = params.get("conversa") ?? latest?.id ?? null;
  const create = useMutation({
    mutationFn: () => conversationsApi.create("Conversa no Jarvis"),
    onSuccess: (c) => {
      void queryClient.invalidateQueries({ queryKey: ["conversations"] });
      setParams({ conversa: c.id }, { replace: true });
    },
  });
  const voiceRef = useRef(voiceOn);
  voiceRef.current = voiceOn;

  /** Pergunta ao Chief (por voz ou sugestão) e, com a voz ligada, fala a resposta. */
  const ask = useCallback(
    async (text: string) => {
      const message = text.trim();
      if (!message) return;
      setError(null);
      setCaption(message);
      go("thinking");
      try {
        const id = conversation ?? (await create.mutateAsync()).id;
        const res = await conversationsApi.send(id, message, newKey());
        for (const key of [["conversation", id], ["conversations"], ["jobs"], ["agent-activity"], ["overview"]]) void queryClient.invalidateQueries({ queryKey: key });
        setCaption(res.reply.text);
        if (voiceRef.current) {
          if (loop.current) loop.current.speaking = res.reply.text;
          speak(res.reply.text, {
            onStart: () => go("speaking"),
            onEnd: () => {
              if (loop.current) loop.current.speaking = "";
              // Depois de responder, fica ouvindo um pouco para a continuação.
              if (phaseRef.current === "speaking") go(voiceRef.current ? "listening" : "standby");
            },
          });
        } else go("standby");
      } catch (e) {
        setError(e instanceof Error ? e.message : "Não consegui falar com o Chief of Staff agora.");
        go("standby");
      }
    },
    [conversation, create, go, queryClient],
  );
  const askRef = useRef(ask);
  askRef.current = ask;

  // ── Voz ─────────────────────────────────────────────────────────────────
  const stopVoice = useCallback(() => {
    loop.current?.stop();
    loop.current = null;
    mic.current?.stop();
    mic.current = null;
    silence();
  }, []);

  const startVoice = useCallback(async () => {
    setError(null);
    try {
      mic.current = await micMeter();
    } catch {
      setError("Sem acesso ao microfone. Libere no cadeado da barra de endereço e tente de novo.");
      return false;
    }
    const mode = (): VoiceMode => (phaseRef.current === "listening" ? "command" : phaseRef.current === "standby" ? "standby" : "busy");
    loop.current = new VoiceLoop({
      mode,
      onWake: (trailing) => (trailing.split(" ").length >= 2 ? void askRef.current(trailing) : go("listening")),
      onPartial: (t) => {
        setCaption(t);
        go("listening"); // fala nova renova o tempo de escuta
      },
      onUtterance: (t) => void askRef.current(t),
      onBargeIn: (t, stop) => {
        if (phaseRef.current !== "speaking") return;
        silence();
        if (loop.current) loop.current.speaking = "";
        if (stop) go("standby");
        else void askRef.current(t);
      },
      onError: (m) => {
        setError(m);
        setVoiceOn(false);
      },
    });
    loop.current.start();
    return true;
  }, [go]);

  const toggleVoice = useCallback(async () => {
    const next = !voiceRef.current;
    if (next && !(await startVoice())) return;
    if (!next) {
      stopVoice();
      go("standby");
    }
    setVoiceOn(next);
    try {
      localStorage.setItem(VOICE_KEY, next ? "1" : "0");
    } catch {
      /* sem armazenamento: vale só nesta visita */
    }
  }, [go, startVoice, stopVoice]);

  // Reabrir a página com a voz ligada da última vez pede o microfone de novo só depois de um toque
  // (os navegadores exigem um gesto); aqui só lembra a preferência no botão.
  const remembered = readVoicePref();

  /** Toque no reator, na barra ou espaço: falar / parar de ouvir / interromper. */
  const talk = useCallback(async () => {
    if (!voiceRef.current) {
      if (!(await startVoice())) return;
      setVoiceOn(true);
      try {
        localStorage.setItem(VOICE_KEY, "1");
      } catch {
        /* idem */
      }
    }
    const p = phaseRef.current;
    if (p === "speaking") {
      silence();
      go("listening");
    } else if (p === "listening") go("standby");
    else if (p === "standby") {
      setCaption("");
      go("listening");
    }
  }, [go, startVoice]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const typing = e.target instanceof HTMLElement && (e.target.closest("input, textarea, select, [contenteditable]") || e.target.isContentEditable);
      if (typing) return;
      if (e.code === "Space") {
        e.preventDefault();
        void talk();
      } else if (e.key === "Escape" && phaseRef.current !== "standby") {
        silence();
        go("standby");
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [go, talk]);

  useEffect(() => () => stopVoice(), [stopVoice]);

  // Nível do reator e da onda: microfone ao ouvir, uma oscilação ao falar, respiração ao pensar.
  useEffect(() => {
    let raf = 0;
    const tick = (t: number) => {
      const p = phaseRef.current;
      const v = p === "listening" ? (mic.current?.level() ?? 0) : p === "speaking" ? 0.35 + 0.3 * Math.abs(Math.sin(t / 140)) * Math.abs(Math.sin(t / 370)) : p === "thinking" ? 0.15 + 0.1 * Math.sin(t / 300) : 0;
      level.current = v;
      signal.current = { color: PHASE[p].color, level: v, busy: p === "thinking" };
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, []);

  // ── Tela cheia ──────────────────────────────────────────────────────────
  useEffect(() => {
    const sync = () => setFull(document.fullscreenElement === frame.current);
    document.addEventListener("fullscreenchange", sync);
    return () => document.removeEventListener("fullscreenchange", sync);
  }, []);
  const toggleFull = () => {
    if (document.fullscreenElement) void document.exitFullscreen();
    else void frame.current?.requestFullscreen?.().catch(() => undefined);
  };

  const status =
    phase === "standby"
      ? voiceOn
        ? "Em espera · diga “Jarvis” ou aperte espaço"
        : "Voz desligada · escreva no chat ou toque para falar"
      : phase === "listening"
        ? "Ouvindo · toque para parar"
        : phase === "thinking"
          ? "Processando"
          : "Respondendo · fale para interromper";

  return (
    <div ref={frame} className={cn("relative overflow-hidden bg-[#0b0a09]", full ? "h-dvh w-screen" : "h-[calc(100dvh-4.5rem)] rounded-xl border border-white/10")}>
      <h1 className="sr-only">Jarvis</h1>
      <BrainMap mode="agents" variant="immersive" bare core={CORE} onCore={() => void talk()} reactor={signal} sceneInset={inset}>
        <Hud phase={phase} voiceOn={voiceOn} supported={supported} onAsk={(t) => void ask(t)} />

        {/* Topo direito: tela cheia. */}
        <div className={cn("absolute top-3 z-20 flex gap-1", chat && wide ? "right-[444px]" : "right-3")}>
          <HudButton onClick={toggleFull} label={full ? "Sair da tela cheia" : "Tela cheia"}>
            {full ? <Minimize2 className="size-3.5" /> : <Maximize2 className="size-3.5" />} {full ? "Sair da tela cheia" : "Tela cheia"}
          </HudButton>
        </div>

        {/* Embaixo, no centro do espaço livre: legenda, onda, estado e controles. */}
        <div
          className="pointer-events-none absolute bottom-4 z-10 flex flex-col items-center gap-2 px-3 transition-[left,right] duration-300"
          style={inset}
        >
          {caption && (
            <p className="pointer-events-auto line-clamp-3 max-w-xl rounded-xl bg-black/55 px-3 py-1.5 text-center text-sm text-stone-200 backdrop-blur-sm" aria-live="polite">
              {caption}
            </p>
          )}
          {error && <p className="pointer-events-auto max-w-md rounded-lg border border-red-400/30 bg-red-950/60 px-3 py-1.5 text-center text-xs text-red-200">{error}</p>}
          <button
            type="button"
            onClick={() => void talk()}
            className="pointer-events-auto flex flex-col items-center gap-1 rounded-2xl px-4 py-1 focus-visible:outline-2 focus-visible:outline-amber-300"
            aria-label={phase === "listening" ? "Parar de ouvir" : phase === "speaking" ? "Interromper" : "Falar com o Jarvis"}
          >
            <Waveform level={level} color={PHASE[phase].color} />
            <span className="font-mono text-[10px] uppercase tracking-[0.25em]" style={{ color: PHASE[phase].color }}>
              {status}
            </span>
          </button>
          <div className="pointer-events-auto flex gap-1.5">
            <HudButton onClick={() => setChat((c) => !c)} label={chat ? "Esconder conversa" : "Conversar"} pressed={chat}>
              <MessagesSquare className="size-3.5" /> Chat
            </HudButton>
            <HudButton
              onClick={() => void toggleVoice()}
              label={voiceOn ? "Desligar a voz" : "Ligar a voz"}
              pressed={voiceOn}
              disabled={!supported}
              title={supported ? undefined : "Este navegador não reconhece voz. Use o Chrome ou o Edge."}
            >
              {voiceOn ? <Mic className="size-3.5" /> : <MicOff className="size-3.5" />} {voiceOn ? "Voz ligada" : remembered ? "Religar a voz" : "Voz"}
            </HudButton>
          </div>
        </div>

        {chat && (
          <ChatPanel
            id={conversation}
            pending={list.isPending}
            creating={create.isPending}
            error={list.error ?? create.error}
            onNew={() => create.mutate()}
            onClose={() => setChat(false)}
          />
        )}
      </BrainMap>
    </div>
  );
}

function HudButton({
  children,
  onClick,
  label,
  pressed,
  disabled,
  title,
}: {
  children: React.ReactNode;
  onClick: () => void;
  label: string;
  pressed?: boolean;
  disabled?: boolean;
  title?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      aria-pressed={pressed}
      disabled={disabled}
      title={title ?? label}
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full border px-3 py-1 font-mono text-[11px] uppercase tracking-wider backdrop-blur-md transition-colors disabled:opacity-40",
        pressed ? "border-amber-300/50 bg-amber-400/15 text-amber-100" : "border-white/15 bg-black/40 text-stone-300 hover:bg-white/10 hover:text-white",
      )}
    >
      {children}
    </button>
  );
}

/** Onda da voz: barras que seguem o nível (escrito direto no DOM a cada quadro). */
function Waveform({ level, color }: { level: React.RefObject<number>; color: string }) {
  const bars = useRef<(HTMLSpanElement | null)[]>([]);
  useEffect(() => {
    let raf = 0;
    const tick = (t: number) => {
      const v = level.current ?? 0;
      bars.current.forEach((el, i) => {
        if (!el) return;
        const wave = Math.abs(Math.sin(t / 180 + i * 0.7)) * 0.6 + 0.4;
        const center = 1 - Math.abs(i - 6) / 7;
        el.style.height = `${3 + (v * 26 * wave + 2) * center}px`;
      });
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [level]);
  return (
    <span aria-hidden className="flex h-8 items-center gap-[3px]">
      {Array.from({ length: 13 }, (_, i) => (
        <span key={i} ref={(el) => void (bars.current[i] = el)} className="w-[3px] rounded-full transition-[background-color]" style={{ background: color, height: 3 }} />
      ))}
    </span>
  );
}

/** Painel da esquerda: hora, sistemas e o que espera você agora. */
function Hud({ phase, voiceOn, supported, onAsk }: { phase: Phase; voiceOn: boolean; supported: boolean; onAsk: (text: string) => void }) {
  const overview = useQuery({ queryKey: ["overview"], queryFn: overviewApi.get, refetchInterval: 15_000 });
  const settings = useQuery({ queryKey: ["settings"], queryFn: companyApi.settings });
  const activity = useTeamActivity();
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const t = window.setInterval(() => setNow(new Date()), 15_000);
    return () => window.clearInterval(t);
  }, []);
  const tz = overview.data?.time_zone;
  const time = new Intl.DateTimeFormat("pt-BR", { hour: "2-digit", minute: "2-digit", timeZone: tz }).format(now);
  const date = new Intl.DateTimeFormat("pt-BR", { weekday: "long", day: "numeric", month: "long", timeZone: tz }).format(now);
  const hour = Number(new Intl.DateTimeFormat("en-GB", { hour: "numeric", hour12: false, timeZone: tz }).format(now));
  const greeting = hour < 12 ? "Bom dia" : hour < 18 ? "Boa tarde" : "Boa noite";

  const o = overview.data;
  const s = settings.data;
  const chief = activity.data?.chief;
  const working = activity.data?.agents.filter((a) => a.status === "running" || a.status === "assigned").length ?? 0;
  const systems: { label: string; value: string; ok: boolean }[] = [
    { label: "Aurora", value: overview.error ? "sem conexão" : "online", ok: !overview.error },
    { label: "Modelo", value: s ? (s.model.provider === "none" ? "desligado · respostas por regras" : `${s.model.provider}${s.model.ready ? "" : " · indisponível"}`) : "…", ok: !!s && s.model.provider !== "none" && s.model.ready },
    { label: "Voz", value: !supported ? "navegador sem suporte" : voiceOn ? "ligada" : "desligada", ok: supported && voiceOn },
    { label: "Cérebro", value: o ? `${o.company.sources} fonte(s)` : "…", ok: !!o && o.company.sources > 0 },
    { label: "Time", value: o ? `${o.company.team} agente(s) · ${working} trabalhando` : "…", ok: !!o && o.company.team > 0 },
    { label: "Integrações", value: o ? `${o.company.connections} conectada(s)` : "…", ok: !!o && o.company.connections > 0 },
    { label: "Rotinas", value: o ? (o.routines.gave_up ? `${o.routines.gave_up} desistiram (7 dias)` : `${o.routines.next.length} agendada(s)`) : "…", ok: !!o && !o.routines.gave_up },
  ];
  const pending = o
    ? [
        ...o.decide.plans.map((p) => ({ key: `p${p.id}`, label: "Aprovar plano", title: p.title, to: `/jarvis?conversa=${p.conversation_id}` })),
        ...o.decide.approvals.map((a) => ({ key: `a${a.id}`, label: "Aprovar parecer", title: a.title, to: `/trabalhos/${a.id}` })),
        ...o.decide.reviews.map((r) => ({ key: `r${r.id}`, label: "Revisar entrega", title: r.title, to: `/entregas/${r.id}` })),
        ...o.decide.recovery.map((r) => ({ key: `c${r.id}`, label: "Recuperação", title: r.title, to: "/governanca" })),
      ]
    : [];

  return (
    <aside
      aria-label="Painel do Jarvis"
      className="pointer-events-none absolute left-3 top-3 z-10 hidden max-h-[calc(100%-1.5rem)] w-64 flex-col gap-3 overflow-hidden text-stone-300 md:flex"
    >
      <section className="pointer-events-auto rounded-xl border border-white/10 bg-black/45 p-3 backdrop-blur-md">
        <p className="font-mono text-3xl font-light tabular-nums text-[#f4ecd8]">{time}</p>
        <p className="font-mono text-[10px] uppercase tracking-widest text-stone-400">{date}</p>
        <p className="mt-2 flex items-center gap-1.5 text-xs">
          <Sparkles className="size-3.5 text-amber-400" />
          <span className="text-[#f4ecd8]">{greeting}.</span> Jarvis · Chief of Staff
        </p>
        <p className="mt-1 flex items-center gap-1.5 text-[11px] text-stone-400">
          <span className="size-1.5 rounded-full" style={{ background: PHASE[phase].color }} /> {PHASE[phase].label} · {chief ? ACTIVITY_STATUS[chief.status].label.toLowerCase() : "…"}
        </p>
        {chief?.job && <p className="mt-0.5 line-clamp-2 text-[11px] text-stone-400">{chief.activity}</p>}
      </section>

      <section className="pointer-events-auto rounded-xl border border-white/10 bg-black/45 p-3 backdrop-blur-md">
        <h2 className="mb-1.5 font-mono text-[10px] uppercase tracking-[0.2em] text-amber-200/80">Sistemas</h2>
        <ul className="space-y-1">
          {systems.map((x) => (
            <li key={x.label} className="flex items-start gap-2 text-[11px]">
              <span aria-hidden className={cn("mt-[3px] flex size-3 shrink-0 items-center justify-center rounded-sm border text-[8px]", x.ok ? "border-teal-300/60 text-teal-300" : "border-stone-500 text-stone-500")}>
                {x.ok ? "✓" : ""}
              </span>
              <span className="font-mono uppercase tracking-wider text-stone-400">{x.label}</span>
              <span className="ml-auto text-right text-stone-300">{x.value}</span>
            </li>
          ))}
        </ul>
      </section>

      <section className="pointer-events-auto min-h-0 rounded-xl border border-white/10 bg-black/45 p-3 backdrop-blur-md">
        <h2 className="mb-1.5 font-mono text-[10px] uppercase tracking-[0.2em] text-amber-200/80">Para você agora</h2>
        {pending.length ? (
          <ul className="space-y-1.5 overflow-y-auto">
            {pending.slice(0, 5).map((p) => (
              <li key={p.key}>
                <Link to={p.to} className="block rounded-md px-1 py-0.5 text-[11px] hover:bg-white/5">
                  <span className="font-mono uppercase tracking-wider text-amber-300">{p.label}</span>
                  <span className="block truncate text-stone-200">{p.title}</span>
                </Link>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-[11px] text-stone-400">Nada esperando sua decisão.</p>
        )}
        <div className="mt-2 flex flex-wrap gap-1">
          {SUGGESTIONS.map((q) => (
            <button key={q} type="button" onClick={() => onAsk(q)} className="rounded-full border border-white/10 px-2 py-0.5 text-[10px] text-stone-300 hover:border-amber-300/40 hover:text-white">
              {q}
            </button>
          ))}
        </div>
      </section>
    </aside>
  );
}

function ChatPanel({
  id,
  pending,
  creating,
  error,
  onNew,
  onClose,
}: {
  id: string | null;
  pending: boolean;
  creating: boolean;
  error: unknown;
  onNew: () => void;
  onClose: () => void;
}) {
  const activity = useTeamActivity();
  const status = activity.data?.chief.status ?? "idle";
  return (
    <aside
      aria-label="Conversa com o Jarvis"
      className="absolute inset-x-3 bottom-36 top-14 z-20 flex flex-col overflow-hidden rounded-2xl border border-white/10 bg-background/85 text-foreground shadow-2xl backdrop-blur-xl sm:inset-x-auto sm:bottom-3 sm:right-3 sm:top-3 sm:w-[420px]"
    >
      <header className="flex items-center gap-2 border-b px-3 py-2">
        <div className="flex size-8 items-center justify-center rounded-full bg-sidebar-primary text-sidebar-primary-foreground">
          <Sparkles className="size-4" />
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium">Jarvis</p>
          <p className="flex items-center gap-1 text-[11px] text-muted-foreground">
            <StatusDot status={status} /> Chief of Staff · {ACTIVITY_STATUS[status].label}
          </p>
        </div>
        <Button size="icon" variant="ghost" aria-label="Nova conversa" title="Nova conversa" disabled={creating} onClick={onNew}>
          <MessageSquarePlus />
        </Button>
        <Button size="icon" variant="ghost" aria-label="Esconder conversa" title="Esconder conversa" onClick={onClose}>
          <PanelRightClose />
        </Button>
      </header>
      <ErrorNotice error={error} />
      {id ? (
        <div className="flex min-h-0 flex-1 flex-col">
          <Thread key={id} id={id} embedded />
        </div>
      ) : pending ? (
        <div className="p-3">
          <LoadingRows rows={2} />
        </div>
      ) : (
        <div className="m-auto max-w-xs space-y-3 p-6 text-center text-sm text-muted-foreground">
          <p>Fale com o Jarvis ou escreva aqui. Ele acompanha a empresa por você: o que espera sua decisão, o que o time está fazendo, e abre trabalhos quando precisar de especialistas.</p>
          <Button disabled={creating} onClick={onNew}>
            <MessageSquarePlus /> Começar a conversa
          </Button>
          <p className="text-xs">
            Histórico completo em{" "}
            <Link to="/conversa" className="underline">
              Conversa
            </Link>
            .
          </p>
        </div>
      )}
    </aside>
  );
}
