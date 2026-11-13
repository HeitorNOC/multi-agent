/** Rótulos dos estados de trabalho mostrados na interface. */
export const statusText: Record<string, string> = {
  queued: "Na fila",
  running: "Em execução",
  awaiting_approval: "Aguardando sua decisão",
  completed: "Concluído",
  failed: "Falha preservada",
  recovery_required: "Revisão de inferência pendente",
  closed_unknown: "Encerrado sem resultado confirmado",
  interrupted: "Interrompido",
  rejected: "Rejeitado",
  created: "Admitido",
};
