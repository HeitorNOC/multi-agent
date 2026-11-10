import assert from "node:assert/strict";
import { test } from "node:test";
import {
  describeAgents,
  type CatalogAgent,
} from "../../apps/aurora/web/agent-activity.ts";

const catalog: CatalogAgent[] = [
  { id: "analyst", title: "Analista", kind: "specialist" },
  { id: "director", title: "Diretora", kind: "director" },
  { id: "other", title: "Outro", kind: "specialist" },
];
const plan = { capabilities: ["analyst", "director"] };
const event = (seq: number, ms: number, node: string, capability?: string) => ({
  seq,
  node,
  at: new Date(ms).toISOString(),
  detail: { capability },
});
const history = (id: string, ms: number, goal = "incident") => ({
  id,
  goal,
  worker_active: false,
  events: [
    event(1, 100, "specialist_started", "analyst"),
    event(2, 100 + ms, "specialist_completed", "analyst"),
  ],
});

test("shows stage and a median estimate only with comparable completed runs", () => {
  const active = {
    id: "current",
    goal: "incident",
    worker_active: true,
    plan,
    events: [
      event(1, 1000, "worker_started"),
      event(2, 2000, "specialist_started", "analyst"),
      event(3, 3500, "inference_requested", "analyst"),
    ],
  };
  const past = [
    history("a", 8000),
    history("b", 12000),
    history("unrelated", 90000, "campaign"),
  ];
  assert.equal(
    describeAgents(catalog, past, active, 5000).get("analyst")?.estimate,
    null,
  );
  past.push(history("c", 15000));
  const view = describeAgents(catalog, past, active, 5000);
  assert.deepEqual(view.get("analyst"), {
    status: "running",
    action: "Aguardando resposta do modelo",
    milestones: 1,
    elapsedMs: 3000,
    estimate: { remainingMs: 9000, samples: 3 },
  });
  assert.equal(view.get("director")?.status, "selected");
  assert.equal(view.get("other")?.status, "available");
});

test("an event replayed after restart does not reactivate the earlier attempt", () => {
  const active = {
    id: "current",
    goal: "incident",
    worker_active: true,
    plan,
    events: [
      event(1, 4000, "worker_started"),
      event(2, 1000, "specialist_started", "analyst"),
      event(3, 2000, "retrieval_completed", "analyst"),
      event(4, 3500, "director_completed", "director"),
    ],
  };
  const view = describeAgents(catalog, [], active, 5000);
  assert.equal(view.get("analyst")?.status, "paused");
  assert.equal(view.get("analyst")?.elapsedMs, 1000);
  assert.equal(view.get("analyst")?.estimate, null);
  assert.equal(view.get("director")?.status, "done");
  assert.equal(view.get("director")?.elapsedMs, null);
});

test("engineering events complete assigned agents and preserve the reserve", () => {
  const agents: CatalogAgent[] = [
    { id: "technology_director", title: "Tecnologia", kind: "director" },
    ...["tech_lead", "backend_engineer", "qa_engineer", "platform_engineer"].map((id) =>
      ({ id, title: id, kind: "specialist" as const })),
  ];
  const roster = ["tech_lead", "backend_engineer", "qa_engineer", "platform_engineer"];
  const engineering = {
    id: "engineering", goal: "webhook", worker_active: false,
    events: [
      { ...event(1, 1000, "engineering_chief"), detail: { roster } },
      { ...event(2, 2000, "engineering_assign"), detail: { assignments: roster.slice(0, 3).map((agent) => ({ agent, task: agent })) } },
      { ...event(3, 3000, "engineering_director"), detail: { decision: { action: "human_review" } } },
      event(4, 4000, "human_approved"),
      event(5, 4500, "effect_receipt"),
    ],
  };
  const activity = describeAgents(agents, [], engineering, 5000);
  for (const id of ["technology_director", ...roster.slice(0, 3)]) {
    assert.equal(activity.get(id)?.status, "done");
    assert.equal(activity.get(id)?.milestones, 3);
  }
  assert.equal(activity.get("platform_engineer")?.status, "available");
  assert.match(activity.get("platform_engineer")!.action, /reserva/);
});
