import React, { useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import "./aurora.css";
import { BrainMap } from "./BrainMap.tsx";
import { AgentList } from "./AgentViews.tsx";
import { DelegationFlow } from "./DelegationFlow.tsx";
import { agentStatusLabel, describeAgents, engineeringBranches, type CatalogAgent } from "./agent-activity.ts";
import { PerformancePanel } from "./PerformancePanel.tsx";
import { OperationsOverview } from "./OperationsOverview.tsx";
import { PilotEvidence, PilotSignIn, type PilotReport } from "./PilotPanel.tsx";
import { DecisionReport, type Report } from "./DecisionReport.tsx";
import RecoveryCenter from "./RecoveryCenter.tsx";
import { ConversationPanel } from "./ConversationPanel.tsx";
import { statusText } from "./job-status.ts";
import "./recovery.css";
async function request(path: string, body?: unknown, key?: string) {
  const r = await fetch(
    path,
    body === undefined
      ? undefined
      : {
          method: "POST",
          headers: {
            "content-type": "application/json",
            ...(key ? { "Idempotency-Key": key } : {}),
          },
          body: JSON.stringify(body),
        },
  );
  const v = await r.json();
  if (!r.ok)
    throw Object.assign(Error(v.error), { pilot: v.pilot, status: r.status });
  return v;
}
function App() {
  const [loadedTrace, setTrace] = useState<any>(null);
  const admissions = useRef(new Map<string, string>());
  const [data, setData] = useState<any>(null);
  const [chosen, setChosen] = useState("");
  const [scenario, setScenario] = useState("campaign");
  const [pilotLogin, setPilotLogin] = useState(false);
  const [pilotClosed, setPilotClosed] = useState(false);
  const [goal, setGoal] = useState("");
  const [inspect, setInspect] = useState("brain");
  const [source, setSource] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [agentView, setAgentView] = useState<"map" | "flow" | "list">("map");
  async function refresh() {
    try {
      setData(await request("/api/state"));
      setPilotLogin(false);
    } catch (e) {
      if ((e as { pilot?: boolean }).pilot) {
        setData(null);
        clearPilotView();
        setPilotLogin(true);
        if ((e as { status?: number }).status === 401) return;
      }
      setError((e as Error).message);
    }
  }
  useEffect(() => {
    if (pilotClosed) return;
    refresh();
    const t = setInterval(refresh, 1300);
    return () => clearInterval(t);
  }, [pilotClosed]);
  async function closePilot() {
    setBusy(true);
    setError("");
    try {
      await request("/api/pilot/stop", {});
      setData(null);
      clearPilotView();
      setPilotClosed(true);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  function clearPilotView() {
    setGoal("");
    setTrace(null);
    admissions.current.clear();
  }
  async function act(path: string, body: unknown = {}, key?: string) {
    setBusy(true);
    setError("");
    try {
      const v = await request(path, body, key);
      if (v.id) setChosen(v.id);
      await refresh();
      return true;
    } catch (e) {
      setError((e as Error).message);
      return false;
    } finally {
      setBusy(false);
    }
  }
  async function submit() {
    const pilot = data?.runtime?.pilot;
    const task = pilot ? goal.trim() : scenario;
    const key = admissions.current.get(task) || crypto.randomUUID();
    admissions.current.set(task, key);
    if (await act("/api/jobs", pilot ? { goal: task } : { scenario }, key))
      admissions.current.delete(task);
  }
  const runtime = data?.runtime,
    baseCatalog: (CatalogAgent & { children: string[]; focus?: string; sources?: string[] })[] = runtime?.catalog || [],
    jobs = data?.jobs || [],
    job = jobs.find((j: any) => j.id === chosen) || jobs[0],
    events = job?.events || [];
  const pilot = runtime?.pilot === true;
  const operator = !pilot || data?.actor?.role === "operator";
  const engineeringReport = job?.review?.report?.kind === "engineering" ? job.review.report : undefined;
  const repositoryDelivery = engineeringReport?.repository;
  const importingRepository = !pilot && scenario === "engineering_que_review";
  const engineeringRoster = events.findLast((event: any) => event.node === "engineering_chief")?.detail.roster;
  const engineeringAssignments = events.findLast((event: any) => event.node === "engineering_assign")?.detail.assignments ?? [];
  const engineeringChecks = events.filter((event: any) => event.node === "engineering_qa");
  const branches = engineeringBranches(events);
  const engineeringAgents = [...new Set<string>([
    ...engineeringAssignments.map((item: { agent: string }) => item.agent),
    ...(branches.get("technology_director") ?? []),
  ])];
  const catalog = baseCatalog.map((agent) =>
    agent.id === "backend_engineer" && branches.has("technology_director")
      ? { ...agent, title: "Especialista Backend 1" }
      : agent,
  );
  for (const [parent, agents] of branches) {
    for (const id of agents) {
      if (catalog.some((agent) => agent.id === id)) continue;
      const title = id === "backend_engineer_2"
        ? "Especialista Backend 2"
        : "Desenvolvedor Backend " + id.slice(-1).toUpperCase();
      catalog.push({ id, title, kind: "specialist", parent, children: [] });
    }
  }
  const children = new Map(branches);
  children.delete("technology_director");
  for (const [parent, agents] of branches) {
    const index = catalog.findIndex((agent) => agent.id === parent);
    if (index !== -1) catalog[index] = {
      ...catalog[index], children: [...new Set([...catalog[index].children, ...agents])],
    };
  }
  const plan = job?.plan ?? (engineeringAgents.length ? {
    capabilities: ["technology_director", ...engineeringAgents, ...[...children.values()].flat()],
    reason: "A Diretora de Tecnologia distribuiu as subtarefas do webhook.",
    teams: [{ lead: "technology_director", specialists: engineeringAgents, reason: "Implementar e verificar a ingestão." }],
  } : undefined);
  const selected = plan?.capabilities ?? [];
  const report: Report | undefined = pilot || engineeringReport ? undefined : job?.review?.report;
  const pilotReport: PilotReport | undefined = pilot
    ? job?.review?.report
    : undefined;
  useEffect(() => {
    let current = true;
    if (!job) {
      setTrace(null);
      return;
    }
    request("/api/jobs/" + job.id + "/trace")
      .then((value) => {
        if (current) setTrace(value);
      })
      .catch(() => {
        if (current) setTrace(null);
      });
    return () => {
      current = false;
    };
  }, [job?.id, events.length]);
  const trace = loadedTrace?.job_id === job?.id ? loadedTrace : null;
  const meta = (id: string) => catalog.find((agent: any) => agent.id === id);
  const agentActivity = describeAgents(catalog, jobs, job, Date.now());
  const currentAttempt = events.findLast(
    (event: any) => event.node === "worker_started",
  );
  const chiefAction = job?.status === "completed"
    ? "Revisão humana registrada"
    : job?.review
    ? "Parecer integrado entregue"
    : job?.worker_active
      ? events.some(
          (event: any) =>
            event.node === "synthesis" &&
            currentAttempt &&
            event.seq > currentAttempt.seq &&
            Date.parse(event.at) >= Date.parse(currentAttempt.at),
        )
        ? "Síntese integrada em andamento"
        : plan
          ? "Equipes designadas"
          : "Compondo a equipe"
      : job
        ? (statusText[job.status] ?? "Aguardando execução")
        : "Aguardando um trabalho";
  const inspectAgent = (id: string) => {
    setInspect(id);
    setSource("");
  };
  const viewProps = {
    catalog,
    activity: agentActivity,
    teams: plan?.teams ?? [],
    children,
    chiefAction,
    inspect,
    onInspect: inspectAgent,
  };
  const ready = runtime?.phase === "ready",
    working = jobs.some((j: any) => j.worker_active),
    usage = runtime?.usage;
  const queue = data?.queue,
    queueFull = queue
      ? queue.pending >= queue.capacity ||
        queue.new_pending >= queue.new_capacity
      : working;
  const agent = meta(inspect),
    reason = plan?.not_selected?.find((a: any) => a.id === inspect)?.reason,
    roleEvent = events.findLast(
      (e: any) =>
        ["specialist_completed", "director_completed"].includes(e.node) &&
        e.detail.capability === inspect,
    ),
    selectedTeam = plan?.teams?.find(
      (t: any) => t.lead === inspect || t.specialists.includes(inspect) ||
        t.specialists.some((id: string) => children.get(id)?.includes(inspect)),
    );
  const inspectedActivity = agentActivity.get(inspect);
  const docs = [...(runtime?.sources || []), ...(runtime?.history || [])],
    doc = docs.find((d: any) => d.source + ":" + d.version === source);
  const scenarioInfo = (goal: string) =>
    runtime?.scenarios?.find((s: any) => s.goal === goal);
  function openWork(id: string, destination: "job" | "recovery") {
    setChosen(id);
    inspectAgent("brain");
    requestAnimationFrame(() => {
      const section = document.getElementById(
        destination === "recovery" ? "job-recovery" : "job-decision",
      );
      section?.focus({ preventScroll: true });
      section?.scrollIntoView({ block: "start" });
    });
  }
  if (pilotClosed)
    return (
      <main>
        <h1>Encerramento do piloto solicitado</h1>
        <p>O Aurora está removendo o estado temporário desta sessão.</p>
      </main>
    );
  if (pilotLogin)
    return (
      <PilotSignIn
        error={error}
        busy={busy}
        onSignIn={(credentials) => {
          void act("/api/pilot/login", credentials);
        }}
      />
    );
  return (
    <div className="app">
      <header>
        <div className="brand">
          <span className="brand-icon">✦</span>
          <div>
            AURORA<span>INTELIGÊNCIA EMPRESARIAL</span>
          </div>
        </div>
        <div className="top-status">
          <i className={ready ? "live" : ""} />
          {ready ? "Cérebro conectado" : "Preparando conhecimento"}
          <b>{pilot ? "PILOTO CONSULTIVO" : "SIMULAÇÃO LOCAL"}</b>
          {pilot && (
            <button
              className="secondary"
              onClick={() => {
                clearPilotView();
                void act("/api/pilot/logout", {});
              }}
            >
              Sair
            </button>
          )}
          {pilot && operator && (
            <button
              className="secondary"
              disabled={busy || !!queue?.running || !!queue?.pending}
              onClick={closePilot}
            >
              Encerrar e apagar sessão
            </button>
          )}
        </div>
      </header>
      <div className="notice">
        {pilot
          ? "Acervo autorizado para consulta. Aprovações registram a revisão local."
          : "Empresa, documentos e operações fictícios. Modelos e motores reais. Execução externa desativada."}
      </div>
      {!pilot && (
        <div className="company-bar">
          <b>Grupo Aurora</b>
          <span>18.400 colaboradores</span>
          <span>7 países</span>
          <span>12 centros de distribuição</span>
          <span>4 unidades de negócio</span>
          <em>Retrato do cenário, não carga medida</em>
        </div>
      )}
      <main>
        <div className="intro">
          <div>
            <div className="eyebrow">UM CÉREBRO · CAPACIDADES SOB DEMANDA</div>
            <h1>A equipe certa para cada decisão.</h1>
            <p>
              O Chief of Staff seleciona diretorias. Os especialistas escolhidos
              investigam e os diretores consolidam.
            </p>
          </div>
          <div className="intro-number">
            <strong>{selected.length}</strong>
            <span>
              acionados de {catalog.length || 21}
              <br />
              agentes disponíveis
            </span>
          </div>
        </div>
        {runtime && (
          <OperationsOverview
            jobs={jobs}
            queue={queue}
            operator={operator}
            title={(item) =>
              pilot ? item.goal : (scenarioInfo(item.goal)?.title ?? "Trabalho")
            }
            agentName={(id) => meta(id)?.title}
            onOpen={openWork}
          />
        )}
        {runtime && (
          <ConversationPanel
            readOnly={!operator}
            onOpenJob={(id) => openWork(id, "job")}
          />
        )}
        {operator && <RecoveryCenter />}
        {error && (
          <div role="alert" className="error">
            {error}
          </div>
        )}
        {!ready && (
          <div className="progress">
            {runtime?.message || "Conectando à instalação…"}{" "}
            {!pilot && (
              <span>
                {runtime?.sources?.length || 0}/16 documentos vigentes
              </span>
            )}
          </div>
        )}
        <div className="workspace">
          <div className="main-column">
            <section className="request-card">
              {pilot ? (
                <label className="pilot-task">
                  Tarefa consultiva
                  <input
                    value={goal}
                    maxLength={600}
                    disabled={!operator}
                    onChange={(event) => setGoal(event.target.value)}
                  />
                  <small>
                    Inclua apenas contexto autorizado para processamento no
                    Codex.
                  </small>
                </label>
              ) : (
                <>
                  <div className="eyebrow">ESCOLHA UM PEDIDO</div>
                  <div className="scenario-tabs">
                    {runtime?.scenarios?.map((s: any) => (
                      <button
                        key={s.id}
                        className={scenario === s.id ? "active" : ""}
                        onClick={() => setScenario(s.id)}
                      >
                        <b>{s.title}</b>
                        <small>{s.label}</small>
                      </button>
                    ))}
                  </div>
                  <p>
                    {
                      runtime?.scenarios?.find((s: any) => s.id === scenario)
                        ?.goal
                    }
                  </p>
                </>
              )}
              <div className="request-footer">
                <span>
                  {queue
                    ? queue.pending +
                      " de " +
                      queue.capacity +
                      " na fila · " +
                      (queue.resume_reserve
                        ? queue.resume_reserve +
                          " vagas protegidas para aprovações e retomadas. "
                        : "") +
                      queue.running +
                      " de " +
                      (queue.max_workers ?? 1) +
                      " em execução."
                    : "O catálogo está disponível; a equipe será proposta pelo modelo."}
                </span>
                <button
                  className="primary"
                  disabled={
                    (!ready && !importingRepository) ||
                    !operator ||
                    (pilot && goal.trim().length < 8) ||
                    busy ||
                    (!importingRepository && queueFull) ||
                    (!pilot && !importingRepository && usage?.max_calls - usage?.calls < 10)
                  }
                  onClick={submit}
                >
                  {importingRepository ? "Abrir entrega para revisão" : "Pedir ao Chief"} <span>↗</span>
                </button>
              </div>
            </section>
            <div
              className="agent-view-controls"
              role="group"
              aria-label="Visualizações da execução"
            >
              <button
                className="secondary"
                aria-pressed={agentView === "map"}
                onClick={() => setAgentView("map")}
              >
                Cérebro 3D
              </button>
              <button
                className="secondary"
                aria-pressed={agentView === "flow"}
                onClick={() => setAgentView("flow")}
              >
                Delegação
              </button>
              <button
                className="secondary"
                aria-pressed={agentView === "list"}
                onClick={() => setAgentView("list")}
              >
                Lista operacional
              </button>
            </div>
            {agentView === "map" && (
              <BrainMap
                catalog={catalog}
                documents={docs}
                source={source}
                selected={selected}
                inspect={inspect}
                sourceCount={runtime?.sources?.length || 0}
                activity={agentActivity}
                onInspect={inspectAgent}
                onSelectAgent={inspectAgent}
                onOpenSource={(id) => {
                  setInspect("brain");
                  setSource(id);
                }}
              />
            )}
            {agentView === "flow" && <DelegationFlow {...viewProps} />}
            {agentView === "list" && <AgentList {...viewProps} />}
            <PerformancePanel
              host={data?.performance}
              queue={queue}
              events={events}
              trace={trace?.events ?? []}
              usage={usage}
            />
            {job && (
              <section className="panel" id="job-decision" tabIndex={-1}>
                <div className="panel-title">
                  <div>
                    <div className="eyebrow">
                      {scenarioInfo(job.goal)?.title || "TRABALHO"}
                    </div>
                    <h2>Decisão do Chief of Staff</h2>
                  </div>
                  <span className={"status " + job.status}>
                    {statusText[job.status]}
                  </span>
                </div>
                {plan ? (
                  <>
                    <p className="plan-reason">{plan.reason}</p>
                    <div className="teams">
                      {plan.teams.map((t: any) => (
                        <button key={t.lead} onClick={() => setInspect(t.lead)}>
                          <b>{meta(t.lead)?.title}</b>
                          <span>
                            {t.specialists
                              .map((id: string) => meta(id)?.title)
                              .join(" + ")}
                          </span>
                          <small>{t.reason}</small>
                        </button>
                      ))}
                    </div>
                  </>
                ) : engineeringRoster ? null : (
                  <p className="muted">
                    {job.status === "queued"
                      ? "O pedido aguarda sua vez na fila."
                      : "A equipe ainda não foi definida."}
                  </p>
                )}
                {job.error && <div className="error">{job.error}</div>}
                {job.review?.payload?.operation !== "engineering-repository-review" && !job.worker_active &&
                  !["rejected", "created", "closed_unknown", "queued"].includes(
                    job.status,
                  ) && (
                    <button
                      className="secondary"
                      disabled={busy}
                      onClick={() => act("/api/jobs/" + job.id + "/resume")}
                    >
                      {job.status === "completed"
                        ? "Verificar retomada sem repetir"
                        : "Retomar em novo processo"}
                    </button>
                  )}
              </section>
            )}
            {report && (
              <DecisionReport
                report={report}
                onOpenSource={(id) => {
                  const document = runtime.sources.find(
                    (source: any) => source.source === id,
                  );
                  setSource(id + ":" + document.version);
                  setInspect("brain");
                }}
              />
            )}
            {engineeringRoster && (
              <section className="panel" aria-label="Delegação de engenharia">
                <h2>Delegação de engenharia</h2>
                {repositoryDelivery && <p>Repositório <strong>{repositoryDelivery.name}</strong> · Revisão <code>{repositoryDelivery.revision}</code></p>}
                <p>O Chief autorizou o grupo. A Diretora de Tecnologia distribuiu as subtarefas.</p>
                <ul>
                  {engineeringRoster.map((id: string) => {
                    const assignment = engineeringAssignments.find((item: any) => item.agent === id);
                    return <li key={id}><strong>{meta(id)?.title ?? id}</strong> · {assignment ? `Acionado — ${assignment.task}` : "Autorizado · disponível"}</li>;
                  })}
                </ul>
                {engineeringChecks.map((event: any) => (
                  <details key={event.seq}>
                    <summary>Testes da tentativa {event.detail.attempt} · {event.detail.tests.passed ? "Passaram" : "Falharam"}</summary>
                    <pre style={{ whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}>{event.detail.tests.log}</pre>
                  </details>
                ))}
                {events.filter((event: any) => event.node === "engineering_director").map((event: any) => (
                  <p key={event.seq}>
                    {event.detail.decision.action === "human_review" ? "Encaminhado para revisão humana" : "Devolvido para correção"}
                    {" · "}{event.detail.decision.reason}
                  </p>
                ))}
                {engineeringReport && (
                  <>
                    {typeof engineeringReport.qa.evidence === "string" && <p>QA · {engineeringReport.qa.evidence}</p>}
                    {typeof engineeringReport.technical_review.evidence === "string" && <p>Tech Lead · {engineeringReport.technical_review.evidence}</p>}
                    <details>
                      <summary>Diff da entrega</summary>
                      <pre style={{ whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}>{engineeringReport.diff}</pre>
                    </details>
                  </>
                )}
              </section>
            )}
            {pilotReport && <PilotEvidence report={pilotReport} />}
            {job?.review && (
              <section className="panel approval">
                <div className="eyebrow">REVISÃO DA DECISÃO</div>
                <h2>
                  {engineeringReport ? "Revisar entrega de engenharia" : pilot
                    ? "Registrar revisão do parecer"
                    : "Registrar proposta no comitê local"}
                </h2>
                <p className="action-content">{job.review.payload.content}</p>
                <p className="muted">
                  {engineeringReport ? "Registro local de revisão humana" : pilot
                    ? "Registro consultivo local"
                    : "Destino: comite-aurora-local · operação simulada · nenhum efeito externo"}
                </p>
                <details>
                  <summary>Conteúdo vinculado à aprovação</summary>
                  <code>{job.review.hash}</code>
                </details>
                {operator &&
                  job.status === "awaiting_approval" &&
                  !job.worker_active && (
                    <div className="buttons">
                      <button
                        className="primary"
                        disabled={busy}
                        onClick={() =>
                          act("/api/jobs/" + job.id + "/approve", {
                            hash: job.review.hash,
                          })
                        }
                      >
                        {pilot || engineeringReport
                          ? "Registrar aprovação"
                          : "Aprovar registro simulado"}
                      </button>
                      <button
                        className="secondary"
                        disabled={busy}
                        onClick={() =>
                          act("/api/jobs/" + job.id + "/reject", {
                            hash: job.review.hash,
                          })
                        }
                      >
                        Rejeitar
                      </button>
                    </div>
                  )}
                {job.receipt && (
                  <p className="receipt">
                    ✓{" "}
                    {pilot || engineeringReport
                      ? "Revisão registrada"
                      : "Recibo simulado registrado"}
                    : {job.receipt.id}
                  </p>
                )}
              </section>
            )}
          </div>
          <aside>
            <section className="panel">
              <div className="eyebrow">INSPEÇÃO DO NÓ</div>
              <h2>{agent?.title || "Cérebro empresarial"}</h2>
              {agent ? (
                <>
                  <p>{agent.focus}</p>
                  {inspectedActivity && (
                    <span className={`agent-state ${inspectedActivity.status}`}>
                      {agentStatusLabel[inspectedActivity.status]}
                    </span>
                  )}
                  <h3>Motivo</h3>
                  <p className="insight">
                    {reason ||
                      selectedTeam?.reason ||
                      "O Chief ainda não compôs a equipe deste pedido."}
                  </p>
                  <h3>Fontes da capacidade</h3>
                  <div className="source-list">
                    {(agent.sources ?? []).map((id: string) => {
                      const d = runtime?.sources?.find(
                        (d: any) => d.source === id,
                      );
                      return (
                        <button
                          disabled={!d}
                          key={id}
                          onClick={() => setSource(id + ":" + d?.version)}
                        >
                          {d?.title || id}
                          <small>
                            ↗ {id} · v{d?.version || "—"}
                          </small>
                        </button>
                      );
                    })}
                  </div>
                  {roleEvent && (
                    <details>
                      <summary>Retorno original deste agente</summary>
                      <pre>
                        {JSON.stringify(roleEvent.detail.output, null, 2)}
                      </pre>
                    </details>
                  )}
                </>
              ) : (
                <>
                  <p>
                    Um catálogo central de fontes versionadas e capacidades. O
                    Chief escolhe quem participa; nós disponíveis não geram
                    chamadas de modelo.
                  </p>
                  <div className="brain-counts">
                    <span>
                      <b>{runtime?.sources?.length || 0}</b>vigentes
                    </span>
                    <span>
                      <b>7</b>áreas
                    </span>
                    <span>
                      <b>{catalog.length || 21}</b>agentes
                    </span>
                  </div>
                  <div className="source-list">
                    {docs.map((d: any) => (
                      <button
                        key={d.source + ":" + d.version}
                        className={!d.current ? "historical" : ""}
                        onClick={() => setSource(d.source + ":" + d.version)}
                      >
                        {d.title}
                        <small>
                          {d.area} · v{d.version} ·{" "}
                          {d.current ? "vigente" : "histórico / não indexado"}
                        </small>
                      </button>
                    ))}
                  </div>
                </>
              )}
              {doc && (
                <div className="source-original">
                  <h3>
                    {pilot ? "Fonte" : "Original"} · {doc.source} v{doc.version}
                  </h3>
                  <span className="muted">
                    {pilot
                      ? `${doc.current ? "Vigente" : "Histórico"} · ${doc.classification === "model-approved" ? "Trechos autorizados" : "Somente local"}`
                      : doc.current
                        ? "Fonte vigente da simulação"
                        : "Original histórico substituído; fora da recuperação vigente"}
                  </span>
                  <p>{pilot ? doc.origin : doc.content}</p>
                  {doc.sha256 && <code>{doc.sha256}</code>}
                </div>
              )}
            </section>
            <section className="panel">
              <div className="panel-title">
                <h2>Trabalhos desta sessão</h2>
                <span className="muted">{jobs.length}</span>
              </div>
              {jobs.length === 0 ? (
                <p className="muted">
                  {pilot
                    ? "Envie uma tarefa para começar."
                    : "Escolha um cenário para começar."}
                </p>
              ) : (
                jobs.map((j: any) => (
                  <button
                    className={"job " + (j.id === job?.id ? "chosen" : "")}
                    key={j.id}
                    onClick={() => {
                      setChosen(j.id);
                      setInspect("brain");
                      setSource("");
                    }}
                  >
                    <b>
                      {pilot
                        ? j.goal
                        : scenarioInfo(j.goal)?.title || "Trabalho"}
                    </b>
                    <small>
                      {statusText[j.status]} ·{" "}
                      {j.plan?.capabilities?.length || 0} agentes
                    </small>
                  </button>
                ))
              )}
            </section>
            <section className="panel">
              <h2>Uso observado</h2>
              <div className="usage">
                <strong>{usage?.calls || 0}</strong>
                <span> / {usage?.max_calls || 48} chamadas</span>
              </div>
              <p className="muted">
                {pilot
                  ? "Chamadas com uso registrado. A sessão aplica o teto de reservas separadamente."
                  : "Inclui ingestão, agentes selecionados e sínteses. Disponibilidade no catálogo não consome inferência."}
              </p>
              <dl>
                <div>
                  <dt>Entrada</dt>
                  <dd>{(usage?.input_tokens || 0).toLocaleString("pt-BR")}</dd>
                </div>
                <div>
                  <dt>Em cache</dt>
                  <dd>
                    {(usage?.cached_input_tokens || 0).toLocaleString("pt-BR")}
                  </dd>
                </div>
                <div>
                  <dt>Saída</dt>
                  <dd>{(usage?.output_tokens || 0).toLocaleString("pt-BR")}</dd>
                </div>
              </dl>
              <p className="small">{usage?.money}</p>
            </section>
            {trace && (
              <section className="panel evidence-trail">
                <div className="eyebrow">
                  FONTES → ESPECIALISTAS → DIRETORES → SÍNTESE
                </div>
                <h2>Trilha de evidências</h2>
                <p className="muted">
                  Acompanhe quais fontes cada etapa recebeu e quais resultados
                  foram preservados. Este painel consulta o registro da
                  execução.
                </p>
                <p className="insight">
                  {
                    trace.events.filter(
                      (e: any) => e.kind === "canonical_evidence_verified",
                    ).length
                  }{" "}
                  leituras canônicas verificadas ·{" "}
                  {
                    trace.events.filter(
                      (e: any) => e.kind === "inference_completed",
                    ).length
                  }{" "}
                  resultados registrados
                </p>
                <div className="timeline">
                  {trace.events
                    .filter((e: any) =>
                      [
                        "retrieval_completed",
                        "canonical_evidence_verified",
                        "inference_completed",
                        "checkpoint_saved",
                      ].includes(e.kind),
                    )
                    .map((e: any) => (
                      <details key={e.event_id}>
                        <summary>
                          {meta(e.capability_id)?.title ||
                            e.model_slot ||
                            "Checkpoint"}
                          <small>
                            {e.kind === "canonical_evidence_verified"
                              ? "Original conferido"
                              : e.kind === "retrieval_completed"
                                ? "Contexto recuperado"
                                : e.kind === "inference_completed"
                                  ? e.fact_ids.length + " fatos registrados"
                                  : "Estado salvo"}
                          </small>
                        </summary>
                        {e.evidence.map((ref: any) => (
                          <button
                            className="source-ref"
                            key={ref.source_id}
                            onClick={() => {
                              setInspect("brain");
                              setSource(
                                ref.source_id + ":" + ref.source_version,
                              );
                            }}
                          >
                            {ref.source_id} · v{ref.source_version}
                            <small>
                              {ref.canonical_fragment_id
                                ? "Original e contexto vinculados"
                                : "Fragmento recuperado vinculado"}
                            </small>
                          </button>
                        ))}
                        <code>Evento: {e.event_id}</code>
                        {e.output_artifact_id && (
                          <code>Registro: {e.output_artifact_id}</code>
                        )}
                      </details>
                    ))}
                </div>
                <details>
                  <summary className="muted">Identificação da trilha</summary>
                  <code>{trace.trace_id}</code>
                  <p className="small">
                    Prompts e documentos não são copiados para esta projeção.
                    Artefatos detalhados permanecem no ambiente local de teste.
                  </p>
                </details>
              </section>
            )}
            <section className="panel">
              <h2>Atividade verificada</h2>
              <div className="timeline">
                {events
                  .slice()
                  .reverse()
                  .map((e: any) => (
                    <details key={e.seq}>
                      <summary>
                        {meta(e.detail.capability)?.title ||
                          (
                            {
                              chief_of_staff: "Chief de Staff",
                              synthesis: "Síntese integrada",
                              plan: "Equipe admitida",
                              review_ready: "Parecer disponível",
                              checkpoint_loaded: "Checkpoint consultado",
                              checkpoint_saved: "Checkpoint salvo",
                              admission: "Pedido registrado",
                              worker_started: "Processo iniciado",
                              worker_stopped: "Processo encerrado",
                            } as any
                          )[e.node] ||
                          e.node}
                        <small>
                          {e.detail.capability
                            ? e.node.includes("completed")
                              ? "concluiu"
                              : "iniciou"
                            : new Date(e.at).toLocaleTimeString("pt-BR")}
                        </small>
                      </summary>
                      <pre>{JSON.stringify(e.detail, null, 2)}</pre>
                    </details>
                  ))}
              </div>
            </section>
          </aside>
        </div>
        <footer>
          {pilot
            ? "Piloto local · LangGraph e evidência extrativa"
            : "Complexidade de domínio ampliada · capacidade de produção e carga empresarial não homologadas · LangGraph + LightRAG reutilizados"}
        </footer>
      </main>
    </div>
  );
}
createRoot(document.getElementById("root")!).render(<App />);
