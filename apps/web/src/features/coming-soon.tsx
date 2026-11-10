/** Áreas das próximas fases do roteiro: dizem o que vão fazer, sem simular dados. */
import { Construction } from "lucide-react";
import { EmptyState, PageHeader } from "@/components/common";

export const UPCOMING: Record<string, { title: string; phase: string; text: string }> = {
  integracoes: { title: "Integrações", phase: "F5", text: "Catálogo de conectores por categoria; ações externas só com autorização." },
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
