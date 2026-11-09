/**
 * Chief of Staff: decide o que fazer com cada mensagem do gestor.
 *
 * É uma interface para que a implementação possa mudar sem tocar no resto: hoje há uma
 * versão determinística por regras (sem chamar modelo); depois entra uma versão que usa o
 * `ModelProvider` local (CLI do Codex ou do Claude) com o mesmo contrato.
 *
 * O Chief of Staff só DECIDE. Quem grava a conversa e abre o trabalho é o serviço de
 * conversas, dentro de transações do ledger.
 */
import type { ConversationMessage, JobStatus } from "../ledger/journey-ledger.ts";

export interface ChiefTurn {
  /** Texto da mensagem atual do gestor. */
  text: string;
  /** Mensagens anteriores da conversa, em ordem (inclui a atual). */
  history: ConversationMessage[];
  /** Último trabalho aberto nesta conversa, se houver. */
  lastJob: { id: string; status: JobStatus } | null;
}

export type ChiefDecision =
  | { kind: "reply"; text: string }
  /** Abrir um trabalho; `text` é a resposta mostrada ao gestor junto com o trabalho. */
  | { kind: "open_job"; text: string };

export interface ChiefOfStaff {
  decide(turn: ChiefTurn): Promise<ChiefDecision>;
}

export const STATUS_LABEL: Record<JobStatus, string> = {
  created: "criado",
  queued: "na fila",
  running: "em execução",
  awaiting_approval: "aguardando sua aprovação",
  completed: "concluído",
  failed: "com falha",
  interrupted: "interrompido",
  recovery_required: "aguardando revisão na central de recuperação",
  closed_unknown: "encerrado sem resultado confirmado",
  rejected: "rejeitado",
};

/** Minúsculas e sem acentos, para comparar intenções de forma tolerante. */
const normalize = (text: string) =>
  text.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

const STATUS_INTENT = /\b(status|andamento|situacao|progresso|como (esta|anda|vai))\b/;
const WORK_INTENT = /\b(analis\w*|vendas?|estoques?|relatorios?|propost\w*|campanha\w*|acao comercial)\b/;

/**
 * Versão determinística: reconhece pedidos de status e pedidos que cabem no trabalho que a
 * instalação sabe executar. Fora disso, explica o que está disponível em vez de inventar.
 */
export class RuleBasedChiefOfStaff implements ChiefOfStaff {
  private readonly offer: string;

  /** @param offer descrição do trabalho que a instalação sabe abrir. */
  constructor(offer: string) {
    this.offer = offer;
  }

  async decide({ text, lastJob }: ChiefTurn): Promise<ChiefDecision> {
    const intent = normalize(text);
    if (STATUS_INTENT.test(intent))
      return {
        kind: "reply",
        text: lastJob
          ? `O trabalho ${lastJob.id.slice(0, 8)} está ${STATUS_LABEL[lastJob.status]}.`
          : "Ainda não abri nenhum trabalho nesta conversa.",
      };
    if (WORK_INTENT.test(intent))
      return {
        kind: "open_job",
        text:
          `Entendido. Abri um trabalho para: ${this.offer} ` +
          "Vou planejar com os especialistas e aviso aqui quando houver um parecer para você aprovar.",
      };
    return {
      kind: "reply",
      text:
        `Nesta instalação eu consigo: ${this.offer} ` +
        'Peça, por exemplo, "analise as vendas e o estoque". Outros pedidos ainda não estão disponíveis.',
    };
  }
}
