/**
 * Estação: o gestor conversa direto com um agente do time. O agente responde no papel dele
 * (persona e orientações da empresa), usando só as fontes do Cérebro que pode ler — as abertas a
 * toda a empresa e as restritas em que foi incluído como leitor — e que a pessoa que pergunta
 * também pode ler, sempre citando. Sem evidência,
 * ele se abstém. Com modelo configurado, o modelo redige; senão, a resposta é extraída dos trechos.
 */
import { conflict, ensure } from "../../../shared/errors.ts";
import type { AnswerTrace, KnowledgeAnswerer } from "../../knowledge/application/answerers.ts";
import type { KnowledgeSearch } from "../../knowledge/application/knowledge-search.ts";
import type { Passage } from "../../knowledge/domain/search-index.ts";
import { terms } from "../../knowledge/domain/text.ts";
import type { CatalogAgent, TeamDirectory } from "../../open-work/domain/catalog.ts";
import { roleNotes } from "../../open-work/domain/tasks.ts";
import type { ActorId } from "../../../shared/ids.ts";
import type { MessageCitation } from "../domain/conversation.ts";

const PASSAGES = 5;

export interface StationReply {
  text: string;
  citations: MessageCitation[];
  trace: AnswerTrace & { agent: string };
}

export interface StationResponder {
  /** O agente, se estiver no time; recusa se não estiver. */
  member(agentId: string): Promise<CatalogAgent>;
  /** Resposta à pessoa `asker`: só usa fontes que o agente e ela podem ler. */
  /** `attachments`: fontes que a pessoa anexou nesta mensagem; chegam ao agente primeiro. */
  reply(agentId: string, question: string, asker: ActorId, attachments?: readonly string[]): Promise<StationReply>;
}

/** Trechos de anexos da mensagem entregues ao agente, além dos da busca. */
const ATTACHED = 3;

export function stationResponder(deps: { team: TeamDirectory; search: KnowledgeSearch; answerer: KnowledgeAnswerer }): StationResponder {
  async function member(agentId: string) {
    const agent = (await deps.team.members()).find((a) => a.id === agentId);
    ensure(agent, () => conflict("agent_not_in_team", "Este agente não está no seu time"));
    return agent;
  }
  return {
    member,
    async reply(agentId, question, asker, attachments = []) {
      const agent = await member(agentId);
      const query = `${question}\n${agent.focus}`;
      // Os anexos são da própria pessoa (ela os enviou nesta mensagem); vêm antes da busca.
      const attached = attachments.length ? await deps.search.passagesOfSources(attachments, [agent.id], ATTACHED, query) : [];
      const seen = new Set(attached.map((p) => p.id));
      const searched = await deps.search.forAgents(query, PASSAGES, [agent.id], { onBehalfOf: asker, preferArea: agent.domain });
      const found = [...attached, ...searched.filter((p) => !seen.has(p.id))].slice(0, PASSAGES);
      if (!found.length)
        return {
          text: "Não encontrei nas fontes do Cérebro que posso ler evidência para responder. Se houver um documento sobre isso, envie ao Cérebro (ou me dê acesso a ele) e pergunte de novo.",
          citations: [],
          trace: { engine: "extractive", agent: agent.id },
        };
      // Os termos da pergunta presentes em cada trecho: o respondedor extrativo usa para escolher as frases.
      const wanted = new Set(terms(question));
      const passages: Passage[] = found.map((p, i) => ({ ...p, n: i + 1, matched: [...new Set(terms(p.text))].filter((t) => wanted.has(t)), score: 0 }));
      const role = `Você é ${agent.title}, especialista em: ${agent.focus}. Responda ao gestor no seu papel.${roleNotes(agent)}`;
      const answer = await deps.answerer.answer({ question, passages, role });
      const cited = answer.kind === "answer" ? passages.filter((p) => answer.cited.includes(p.n)) : [];
      return {
        text: answer.text,
        citations: cited.map((p) => ({ n: p.n, source: p.sourceId, title: p.title, version: p.version, valid_from: p.validFrom, url: found[p.n - 1]!.url })),
        trace: { ...answer.trace, agent: agent.id },
      };
    },
  };
}
