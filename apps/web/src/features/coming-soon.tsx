/** Áreas das próximas fases do roteiro: dizem o que vão fazer, sem simular dados. */
import { Construction } from "lucide-react";
import { EmptyState, PageHeader } from "@/components/common";

export const UPCOMING: Record<string, { title: string; phase: string; text: string }> = {
  agentes: {
    title: "Agentes",
    phase: "F2",
    text: "Catálogo de especialistas por área, “No seu time”, conhecer cada agente e criar o seu. O Chief of Staff passa a escalar só quem está no seu time.",
  },
  organograma: { title: "Organograma", phase: "F2", text: "Quem responde a quem e quem aprova o quê, com acesso direto à estação de cada agente." },
  entregas: { title: "Entregas", phase: "F3", text: "Artefatos produzidos pelos agentes, com revisão, aceite, rejeição com reabertura e histórico." },
  rotinas: { title: "Rotinas", phase: "F4", text: "Trabalhos agendados com histórico de execuções, sem duplicar depois de um reinício." },
  integracoes: { title: "Integrações", phase: "F5", text: "Catálogo de conectores por categoria; ações externas só com autorização." },
  configuracoes: { title: "Configurações", phase: "F2", text: "Empresa, provedor do modelo (CLI local) e armazenamento." },
};

export function ComingSoon({ area }: { area: keyof typeof UPCOMING }) {
  const info = UPCOMING[area]!;
  return (
    <div className="space-y-6">
      <PageHeader title={info.title} />
      <EmptyState icon={<Construction />} title={`Chega na fase ${info.phase}`}>
        {info.text}
      </EmptyState>
    </div>
  );
}
