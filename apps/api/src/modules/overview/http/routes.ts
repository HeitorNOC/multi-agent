/** Rota do Command Center. */
import type { HttpModule } from "../../../platform/http/app.ts";
import { agentActivity } from "../application/agent-activity.ts";
import { overview, type OverviewDeps } from "../application/overview.ts";

export function overviewHttp(deps: OverviewDeps): HttpModule {
  return (app) => {
    app.get("/api/overview", async () => overview(deps));
    // Lista operacional dos agentes: status, atividade, marcos e tempo de cada um.
    app.get("/api/agents/activity", async () => agentActivity(deps));
  };
}
