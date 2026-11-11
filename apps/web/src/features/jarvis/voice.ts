/**
 * Voz do Jarvis com o que o navegador já tem (Chrome e Edge): reconhecimento de fala em português
 * e síntese de voz. Nenhuma chave, nenhum serviço pago; o áudio não passa pelo Aurora.
 *
 * Um reconhecedor só, aberto enquanto a voz estiver ligada (reinicia sozinho quando o navegador o
 * encerra). Assim dá para interromper: falar enquanto ele responde corta a fala dele. O que ele
 * mesmo diz e volta pelo microfone é descartado como eco (`isEcho`).
 *
 * Modos, lidos a cada resultado:
 *   standby — só o nome importa ("Jarvis…");
 *   command — tudo é pedido; a frase completa vira `onUtterance`;
 *   busy    — ele está pensando ou falando: fala nova (que não seja eco) é interrupção.
 */
import { findWake, isEcho, isStop, sentences, speakable } from "./voice-text";

export type VoiceMode = "standby" | "command" | "busy";

export interface VoiceHandlers {
  mode: () => VoiceMode;
  /** Nome ouvido; `trailing` é o que veio junto ("Jarvis, qual o resumo"). */
  onWake: (trailing: string) => void;
  /** Transcrição parcial, para a legenda. */
  onPartial: (text: string) => void;
  /** Frase completa no modo `command`. */
  onUtterance: (text: string) => void;
  /** Fala nova enquanto ele responde (`stop`: pediu para parar). */
  onBargeIn: (text: string, stop: boolean) => void;
  onError: (message: string) => void;
}

interface RecognitionResult {
  isFinal: boolean;
  0: { transcript: string };
}
interface Recognition {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  onresult: ((e: { resultIndex: number; results: ArrayLike<RecognitionResult> }) => void) | null;
  onerror: ((e: { error: string }) => void) | null;
  onend: (() => void) | null;
  start(): void;
  stop(): void;
  abort(): void;
}

const Recognizer = (): (new () => Recognition) | undefined => {
  const w = window as unknown as { SpeechRecognition?: new () => Recognition; webkitSpeechRecognition?: new () => Recognition };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition;
};

/** O navegador reconhece fala? (Firefox e Safari antigos, não.) */
export const voiceSupported = () => typeof window !== "undefined" && !!Recognizer() && "speechSynthesis" in window;

const ERRORS: Record<string, string> = {
  "not-allowed": "O microfone está bloqueado. Libere o acesso no cadeado da barra de endereço.",
  "service-not-allowed": "O navegador não deixou usar o reconhecimento de voz.",
  "audio-capture": "Nenhum microfone encontrado.",
  network: "O reconhecimento de voz do navegador precisa de internet.",
};

export class VoiceLoop {
  private rec: Recognition | null = null;
  private running = false;
  private lastWake = 0;
  /** O que ele está falando agora (para reconhecer o eco). */
  speaking = "";

  constructor(private readonly h: VoiceHandlers) {}

  start() {
    const R = Recognizer();
    if (!R) return this.h.onError("Este navegador não reconhece voz. Use o Chrome ou o Edge, ou escreva no chat.");
    if (this.running) return;
    this.running = true;
    const rec = new R();
    rec.lang = "pt-BR";
    rec.continuous = true;
    rec.interimResults = true;
    rec.onresult = (e) => {
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const r = e.results[i]!;
        this.handle(r[0].transcript, r.isFinal);
      }
    };
    rec.onerror = (e) => {
      if (e.error === "no-speech" || e.error === "aborted") return;
      const msg = ERRORS[e.error];
      if (msg) {
        this.running = false;
        this.h.onError(msg);
      }
    };
    // O Chrome encerra o reconhecimento sozinho de tempos em tempos: reabre enquanto estiver ligado.
    rec.onend = () => {
      if (this.running) setTimeout(() => this.running && this.safeStart(), 250);
    };
    this.rec = rec;
    this.safeStart();
  }

  private safeStart() {
    try {
      this.rec?.start();
    } catch {
      /* já estava ouvindo */
    }
  }

  stop() {
    this.running = false;
    this.rec?.abort();
    this.rec = null;
  }

  private handle(text: string, final: boolean) {
    const said = text.trim();
    if (!said) return;
    const mode = this.h.mode();
    if (mode === "busy") {
      if (this.speaking && isEcho(said, this.speaking)) return;
      const stop = isStop(said);
      // Interrompe com o nome, um "para", ou uma frase completa que não é eco.
      if (stop || findWake(said).hit || (final && said.split(/\s+/).length >= 2)) this.h.onBargeIn(said, stop);
      return;
    }
    if (mode === "standby") {
      const wake = findWake(said);
      if (!wake.hit || Date.now() - this.lastWake < 1500) return;
      this.lastWake = Date.now();
      this.h.onWake(final ? wake.trailing : "");
      return;
    }
    this.h.onPartial(said);
    if (final) this.h.onUtterance(said);
  }
}

// ── Fala ────────────────────────────────────────────────────────────────────

/** Voz em português do Brasil, preferindo as mais naturais que o sistema tiver. */
function pickVoice(): SpeechSynthesisVoice | undefined {
  const voices = window.speechSynthesis.getVoices();
  const br = voices.filter((v) => v.lang.toLowerCase().startsWith("pt-br"));
  const pt = br.length ? br : voices.filter((v) => v.lang.toLowerCase().startsWith("pt"));
  const rank = (v: SpeechSynthesisVoice) => (/natural|online|neural/i.test(v.name) ? 0 : /google/i.test(v.name) ? 1 : /antonio|daniel|thalita|francisca/i.test(v.name) ? 2 : 3);
  return [...pt].sort((a, b) => rank(a) - rank(b))[0];
}

let speakToken = 0;

/** Fala o texto (em frases curtas) e chama `onEnd` ao terminar ou ser interrompido. */
export function speak(text: string, h: { onStart?: () => void; onEnd?: () => void }) {
  const synth = window.speechSynthesis;
  synth.cancel();
  const token = ++speakToken;
  const parts = sentences(speakable(text));
  if (!parts.length) return h.onEnd?.();
  const voice = pickVoice();
  let i = 0;
  const next = () => {
    if (token !== speakToken) return;
    if (i >= parts.length) return h.onEnd?.();
    const u = new SpeechSynthesisUtterance(parts[i++]!);
    u.lang = "pt-BR";
    if (voice) u.voice = voice;
    u.rate = 1.05;
    u.onend = next;
    u.onerror = () => (token === speakToken ? h.onEnd?.() : undefined);
    synth.speak(u);
  };
  h.onStart?.();
  next();
}

/** Corta a fala na hora (interrupção). */
export function silence() {
  speakToken++;
  window.speechSynthesis?.cancel();
}

// ── Nível do microfone (para o reator e a onda) ─────────────────────────────

export interface MicMeter {
  /** 0 a 1, suavizado. */
  level: () => number;
  stop: () => void;
}

export async function micMeter(): Promise<MicMeter> {
  const stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } });
  const ctx = new AudioContext();
  const analyser = ctx.createAnalyser();
  analyser.fftSize = 512;
  ctx.createMediaStreamSource(stream).connect(analyser);
  const buf = new Uint8Array(analyser.fftSize);
  let smooth = 0;
  return {
    level: () => {
      analyser.getByteTimeDomainData(buf);
      let sum = 0;
      for (const v of buf) sum += ((v - 128) / 128) ** 2;
      const rms = Math.sqrt(sum / buf.length);
      smooth = smooth * 0.75 + Math.min(1, rms * 6) * 0.25;
      return smooth;
    },
    stop: () => {
      for (const t of stream.getTracks()) t.stop();
      void ctx.close();
    },
  };
}
