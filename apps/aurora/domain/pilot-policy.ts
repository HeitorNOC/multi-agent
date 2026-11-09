import { createHash } from "node:crypto";
import { authorize, validatePlan as validateBasePlan } from "./policy.ts";

export { authorize };
export const GOAL = "";

const directivePrefix = "Analisar a diretiva executiva vinculada a esta tarefa. SHA-256 ";

export function validatePlan(value: unknown, goal = "") {
  const plan = validateBasePlan(value);
  if (goal.startsWith(directivePrefix)) {
    for (const team of plan.teams) {
      const queries: unknown = team.queries;
      if (
        !Array.isArray(queries) ||
        queries.length < 2 ||
        queries.length > 4 ||
        queries.some(
          (query) => typeof query !== "string" || query.trim().length < 8 ||
            query.length > 120 || /[\u0000-\u001f\u007f]/.test(query),
        ) ||
        new Set(queries.map((query) => query.trim().toLowerCase())).size !== queries.length
      ) throw Error("Cada diretoria da diretiva exige de duas a quatro consultas distintas");
    }
  }
  return { ...plan, max_model_calls: plan.max_model_calls + 1 };
}

export function chooseGoal(
  body: { goal?: unknown; directive?: unknown } | null,
  directive?: string,
) {
  if (body?.directive !== undefined) {
    if (!directive || body.directive !== directive || body.goal !== undefined)
      throw Error("Diretiva indisponível ou pedido incompatível");
    return directivePrefix + directive;
  }
  const goal = typeof body?.goal === "string" ? body.goal.trim() : "";
  if (
    goal.length < 8 ||
    goal.length > 600 ||
    goal.startsWith(directivePrefix) ||
    /[\u0000-\u001f\u007f]/.test(goal)
  ) {
    throw Error("Informe uma tarefa de 8 a 600 caracteres, em uma linha");
  }
  return goal;
}

export function reviewable(job: string, report: unknown) {
  const payload = {
    operation: "pilot-advisory-review",
    recipient: "registro-local-piloto",
    content:
      "Registrar a revisão humana dos trechos e da conclusão consultiva.",
  };
  const bound = { job, report, payload };
  return {
    ...bound,
    hash: createHash("sha256").update(JSON.stringify(bound)).digest("hex"),
    requires_approval: true,
  };
}
