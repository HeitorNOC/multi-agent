import React, { useEffect, useState } from "react";
async function api(path: string, body?: any) {
  const response = await fetch(
    "/api/recovery/" + path,
    body === undefined
      ? {}
      : {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(body),
        },
  );
  const value = await response.json();
  if (!response.ok) throw Error(value.error || "Operação indisponível");
  return value;
}
const statusName: any = {
  receipt_unavailable: "Recibo confirmado indisponível ou divergente",
  review_required: "Revisão necessária",
  waiting_for_prior_operation: "Aguarda outra recuperação",
  inference_active: "Inferência ainda ativa",
  provider_unavailable: "Provedor indisponível",
  evidence_unavailable_or_changed: "Evidência indisponível ou alterada",
};
const outcome: any = {
  reconciled_read: "Leitura conciliada por recibo",
  reconciled_effect: "Efeito conciliado sem reenvio",
  closed_unknown: "Encerrado como desconhecido",
};
export default function RecoveryCenter() {
  const [session, setSession] = useState<any>(null),
    [credential, setCredential] = useState(""),
    [queue, setQueue] = useState<any>(null),
    [inspection, setInspection] = useState<any>(null),
    [reason, setReason] = useState(""),
    [commands, setCommands] = useState<any[]>([]),
    [error, setError] = useState(""),
    [notice, setNotice] = useState(""),
    [busy, setBusy] = useState(false);
  async function refresh() {
    const s = await api("session");
    setSession(s);
    if (s.authenticated) {
      const [q, c] = await Promise.all([api("cases"), api("commands")]);
      setQueue(q);
      setCommands(c.commands);
    }
  }
  useEffect(() => {
    refresh().catch((e) => setError(e.message));
  }, []);
  useEffect(() => {
    if (!session?.authenticated) return;
    const timer = setInterval(
      () =>
        refresh().catch((e) => {
          setError(e.message);
          setQueue(null);
        }),
      5000,
    );
    return () => clearInterval(timer);
  }, [session?.authenticated]);
  async function act(fn: () => Promise<void>) {
    setBusy(true);
    setError("");
    setNotice("");
    try {
      await fn();
      await refresh();
    } catch (e) {
      setError((e as Error).message);
      try {
        const c = await api("commands");
        setCommands(c.commands);
      } catch {}
    } finally {
      setBusy(false);
    }
  }
  if (!session || session.enabled === false) return null;
  const unknown =
      ["business_inference_close", "business_create"].includes(
        inspection?.operation_kind,
      ) || inspection?.mode === "inference_unknown",
    first = inspection?.votes?.[0]?.actor;
  const canConfirm =
    inspection &&
    (inspection.confirmation_actor
      ? inspection.confirmation_actor === session.actor
      : first && first !== session.actor);
  const binding = () => ({
    request_id: crypto.randomUUID(),
    case_id: inspection.case_id,
    operation_id: inspection.operation_id,
    evidence_sha: inspection.evidence_sha,
  });
  return (
    <section
      className="panel recovery-center"
      aria-label="Central humana de recuperação"
      id="job-recovery"
      tabIndex={-1}
    >
      <div className="eyebrow">
        INTERVENÇÃO HUMANA · PROTOCOLO EMPRESARIAL CONECTADO
      </div>
      <h2>Precisa de você</h2>
      <p className="muted">
        Inspecione a evidência, registre uma revisão e peça a confirmação de
        outra identidade. Recuperar uma leitura não aprova uma ação externa.
      </p>
      {error && (
        <p role="alert" className="error">
          {error}
        </p>
      )}
      {notice && (
        <p role="status" className="receipt">
          {notice}
        </p>
      )}
      {!session.authenticated ? (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            act(async () => {
              await api("session", { credential });
              setCredential("");
              setInspection(null);
            });
          }}
        >
          <label>
            Credencial local de revisão
            <input
              type="password"
              autoComplete="off"
              value={credential}
              onChange={(e) => setCredential(e.target.value)}
              required
            />
          </label>
          <button className="primary" disabled={busy}>
            Entrar para revisar
          </button>
          <p className="small">
            Credenciais de desenvolvimento ficam no arquivo privado da
            instalação. A identidade é verificada no servidor; não é escolhida
            em um seletor.
          </p>
        </form>
      ) : (
        <>
          <div className="recovery-toolbar">
            <span>
              {session.label} · {session.actor}
            </span>
            <button
              className="secondary"
              disabled={busy}
              onClick={() =>
                act(async () => {
                  await api("logout", {});
                  setInspection(null);
                  setQueue(null);
                  setCommands([]);
                })
              }
            >
              Sair desta revisão
            </button>
          </div>
          <p className="muted">
            {queue
              ? queue.authority_current
                ? "Histórico verificado e atual."
                : "Há uma operação pendente ou uma divergência; a recuperação só avança com evidência válida."
              : "Consultando o protocolo…"}
          </p>
          {queue?.blocked && (
            <p role="alert" className="error">
              Histórico local divergente: a lista está bloqueada. Isso não
              significa ausência de pendências.
            </p>
          )}
          {!queue?.blocked && queue?.cases.length === 0 && (
            <p>
              Nenhuma pendência de recuperação visível para esta identidade.
            </p>
          )}
          {queue?.cases.map((item: any) => (
            <article className="recovery-case" key={item.case_id}>
              <strong>
                {item.kind === "business_read_commit"
                  ? "Leitura interrompida"
                  : ["inference_unknown", "model_slot_unknown"].includes(
                        item.kind,
                      )
                    ? "Inferência sem resultado confirmado"
                    : "Operação pendente"}
              </strong>
              <p>{statusName[item.status] || item.status}</p>
              <code>Trabalho: {item.job_id}</code>
              {item.model_slot && <code>Slot: {item.model_slot}</code>}
              <button
                className="secondary"
                disabled={busy || !item.actionable}
                onClick={() =>
                  act(async () => {
                    const data = await api("inspect", {
                      case_id: item.case_id,
                    });
                    setInspection(data);
                    setReason("");
                  })
                }
              >
                Inspecionar evidência
              </button>
            </article>
          ))}
          {inspection && (
            <div className="recovery-inspection">
              <h3>Revisão vinculada à evidência</h3>
              <p>
                {unknown
                  ? "Encerrar como desconhecido, sem inventar resposta, sem devolver a reserva e sem repetir a inferência. Para trabalhar novamente, será necessária outra intenção explícita."
                  : inspection.operation_kind === "business_read_commit"
                    ? "Conciliar a leitura com o recibo verificado e impedir o executor antigo de continuar. Nenhuma inferência será regenerada."
                    : "Conciliar a operação segundo o procedimento validado e a evidência atual."}
              </p>
              <code>Operação: {inspection.operation_id}</code>
              <code>Evidência: {inspection.evidence_sha}</code>
              <p className="muted">
                Revisões registradas:{" "}
                {inspection.votes.length
                  ? inspection.votes.map((v: any) => v.actor).join(", ")
                  : "nenhuma"}
              </p>
              {inspection.evidence_summary && (
                <details open>
                  <summary>Evidência conferida pelo protocolo</summary>
                  <p className="small">
                    Estado no provedor:{" "}
                    {inspection.evidence_summary.provider_state ||
                      "não informado"}{" "}
                    · Leitura já persistida:{" "}
                    {inspection.evidence_summary.read_already_committed === null
                      ? "não se aplica"
                      : inspection.evidence_summary.read_already_committed
                        ? "sim"
                        : "não"}
                  </p>
                  {inspection.evidence_summary.model_slot && (
                    <code>Slot: {inspection.evidence_summary.model_slot}</code>
                  )}
                  <code>
                    Input:{" "}
                    {inspection.evidence_summary.input_sha || "não se aplica"}
                  </code>
                  {inspection.evidence_summary.verified_receipt_sha && (
                    <code>
                      Recibo consultado:{" "}
                      {inspection.evidence_summary.verified_receipt_sha}
                    </code>
                  )}
                  {inspection.evidence_summary.sources.map((ref: any) => (
                    <div key={ref.source}>
                      <p className="small">
                        Fonte: {ref.source}
                        {ref.version !== null ? " · v" + ref.version : ""}
                      </p>
                      {ref.content_sha && <code>{ref.content_sha}</code>}
                    </div>
                  ))}
                  {inspection.evidence_summary.reserved_units !== null && (
                    <p className="small">
                      Reserva: {inspection.evidence_summary.reserved_units}{" "}
                      unidades do protocolo · Contabilizado:{" "}
                      {inspection.evidence_summary.spent_units ??
                        "indeterminado"}
                      . Não é custo monetário medido.
                    </p>
                  )}
                </details>
              )}
              {first && (
                <p>Justificativa registrada: {inspection.votes[0].reason}</p>
              )}
              {!first ? (
                <>
                  <label>
                    Justificativa da primeira revisão
                    <textarea
                      value={reason}
                      onChange={(e) => setReason(e.target.value)}
                      minLength={20}
                      maxLength={500}
                    />
                  </label>
                  <button
                    className="primary"
                    disabled={busy || reason.length < 20 || !queue}
                    onClick={() =>
                      act(async () => {
                        await api("propose", { ...binding(), reason });
                        setNotice(
                          "Primeira revisão registrada. Outra identidade deve inspecionar e confirmar.",
                        );
                        setInspection(
                          await api("inspect", { case_id: inspection.case_id }),
                        );
                      })
                    }
                  >
                    Registrar primeira revisão
                  </button>
                </>
              ) : (
                <>
                  <p className="small">
                    {inspection.confirmation_actor
                      ? "Após interrupção, a confirmação pertence ao segundo revisor original."
                      : "A primeira identidade não pode confirmar sua própria revisão."}
                  </p>
                  <button
                    className="primary"
                    disabled={busy || !canConfirm || !queue}
                    onClick={() =>
                      act(async () => {
                        const result = await api("confirm", binding());
                        setNotice(
                          [
                            "closed_inference_unknown",
                            "closed_unknown",
                          ].includes(result.result.kind)
                            ? "Encerramento desconhecido registrado; reserva preservada."
                            : "Recuperação confirmada pelo protocolo.",
                        );
                        setInspection(null);
                      })
                    }
                  >
                    {unknown
                      ? "Confirmar encerramento desconhecido"
                      : "Confirmar recuperação por evidência"}
                  </button>
                </>
              )}
            </div>
          )}
          {commands.some((c) =>
            ["unknown", "dispatching"].includes(c.status),
          ) && (
            <div className="recovery-inspection">
              <h3>Envios sem confirmação</h3>
              <p className="small">
                Consultar novamente reutiliza o envio original e verifica a
                autoridade. Não repete a inferência nem envia um efeito externo.
              </p>
              {commands
                .filter((c) => ["unknown", "dispatching"].includes(c.status))
                .map((command) => (
                  <div key={command.id}>
                    <code>{command.id}</code>
                    <button
                      className="secondary"
                      disabled={busy}
                      onClick={() =>
                        act(async () => {
                          await api("retry", { request_id: command.id });
                          setInspection(null);
                          setNotice("Envio conciliado com o protocolo.");
                        })
                      }
                    >
                      Consultar envio original
                    </button>
                  </div>
                ))}
            </div>
          )}
          {!!queue?.history.length && (
            <details>
              <summary>Histórico de recuperações</summary>
              {queue.history.map((item: any) => (
                <div className="recovery-history" key={item.operation_id}>
                  <b>{outcome[item.outcome] || item.outcome}</b>
                  <code>{item.job_id}</code>
                  <p className="small">
                    Revisores: {item.reviewers.join(", ")} · Reserva mantida
                  </p>
                </div>
              ))}
            </details>
          )}
        </>
      )}
    </section>
  );
}
