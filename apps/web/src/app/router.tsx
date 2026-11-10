import { createBrowserRouter, Link } from "react-router";
import { EmptyState } from "@/components/common";
import { ComingSoon, UPCOMING } from "@/features/coming-soon";
import { CommandCenterPage } from "@/features/command-center/command-center-page";
import { ConversationPage } from "@/features/conversation/conversation-page";
import { GovernancePage } from "@/features/governance/governance-page";
import { JobDetailPage } from "@/features/jobs/job-detail-page";
import { JobsPage } from "@/features/jobs/jobs-page";
import { KnowledgePage } from "@/features/knowledge/knowledge-page";
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
      ...Object.keys(UPCOMING).map((area) => ({ path: area, element: <ComingSoon area={area} /> })),
      { path: "*", element: <NotFound /> },
    ],
  },
]);
