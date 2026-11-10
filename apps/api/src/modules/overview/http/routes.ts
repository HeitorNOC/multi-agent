/** Rota do Command Center. */
import type { HttpModule } from "../../../platform/http/app.ts";
import { overview, type OverviewDeps } from "../application/overview.ts";

export function overviewHttp(deps: OverviewDeps): HttpModule {
  return (app) => {
    app.get("/api/overview", async () => overview(deps));
  };
}
