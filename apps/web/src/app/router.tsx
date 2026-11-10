import { createBrowserRouter, Link } from "react-router";
import { EmptyState } from "@/components/common";
import { ComingSoon, UPCOMING } from "@/features/coming-soon";
import { CommandCenterPage } from "@/features/command-center/command-center-page";
import { ConversationPage } from "@/features/conversation/conversation-page";
import { GovernancePage } from "@/features/governance/governance-page";
import { JobDetailPage } from "@/features/jobs/job-detail-page";
import { JobsPage } from "@/features/jobs/jobs-page";
import { AgentsPage } from "@/features/agents/agents-page";
import { DeliverablePage } from "@/features/deliverables/deliverable-page";
import { DeliverablesPage } from "@/features/deliverables/deliverables-page";
import { KnowledgePage } from "@/features/knowledge/knowledge-page";
import { OrganogramPage } from "@/features/organogram/organogram-page";
import { RoutinesPage } from "@/features/routines/routines-page";
import { SettingsPage } from "@/features/settings/settings-page";
import { SetupPage } from "@/features/setup/setup-page";
import { AppLayout } from "./layout";

function NotFound() {
  return (
    <EmptyState title="Página não encontrada">
      <Link to="/" className="underline">
        Voltar ao Command Center
      </Link>
    </EmptyState>
  );
}

export const router = createBrowserRouter([
  {
    element: <AppLayout />,
    children: [
      { index: true, element: <CommandCenterPage /> },
      { path: "conversa", element: <ConversationPage /> },
      { path: "conversa/:id", element: <ConversationPage /> },
      { path: "trabalhos", element: <JobsPage /> },
      { path: "trabalhos/:id", element: <JobDetailPage /> },
      { path: "cerebro", element: <KnowledgePage /> },
      { path: "governanca", element: <GovernancePage /> },
      { path: "entregas", element: <DeliverablesPage /> },
      { path: "entregas/:id", element: <DeliverablePage /> },
      { path: "rotinas", element: <RoutinesPage /> },
      { path: "agentes", element: <AgentsPage /> },
      { path: "organograma", element: <OrganogramPage /> },
      { path: "configuracoes", element: <SettingsPage /> },
      { path: "montar", element: <SetupPage /> },
      ...Object.keys(UPCOMING).map((area) => ({ path: area, element: <ComingSoon area={area} /> })),
      { path: "*", element: <NotFound /> },
    ],
  },
]);
