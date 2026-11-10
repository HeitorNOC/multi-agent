/** Perguntar ao Cérebro: só fontes que a pessoa pode ler, com citação até o original ou abstenção. */
import type { ActorId } from "../../../shared/ids.ts";
import { stream } from "../../../platform/events/event-log.ts";
import { originalUrl } from "../domain/search-index.ts";
import { canRead } from "../domain/source.ts";
import type { AnswerBody, AnswerTrace } from "./answerers.ts";
import type { KnowledgeDeps } from "./sources.ts";

const PASSAGES = 5;
const QUERIES = stream.knowledge("queries");

export async function askKnowledge(deps: KnowledgeDeps, actor: ActorId, question: string) {
  const { wanted, found } = await deps.search.search(question, (p) => canRead(p, actor), PASSAGES);
  let result: AnswerBody;
  let trace: AnswerTrace = { engine: "extractive" };
  if (!wanted.length) result = { kind: "abstain", text: "Reformule a pergunta com termos específicos do assunto." };
  else if (!found.length)
    result = { kind: "abstain", text: "Não encontrei nas fontes vigentes que você pode ler evidência suficiente para responder." };
  else {
    const answer = await deps.answerer.answer({ question, passages: found });
    ({ trace, ...result } = answer);
  }
  const cited = result.kind === "answer" ? found.filter((p) => (result as { cited: number[] }).cited.includes(p.n)) : [];
  await deps.uow.run((s) =>
    s.events.append(QUERIES, {
      kind: "knowledge_query",
      detail: { actor, abstained: result.kind === "abstain", cited: cited.map((p) => p.id), ...trace },
    }),
  );
  return {
    abstained: result.kind === "abstain",
    answer: result.text,
    citations: cited.map((p) => ({
      n: p.n,
      source: p.sourceId,
      title: p.title,
      version: p.version,
      valid_from: p.validFrom,
      excerpt: p.text.length > 600 ? `${p.text.slice(0, 597)}…` : p.text,
      url: originalUrl(p.sourceId, p.version),
    })),
    decision: { engine: trace.engine, ...(trace.provider ? { provider: trace.provider } : {}), ...(trace.fallback ? { fallback: trace.fallback } : {}) },
  };
}
