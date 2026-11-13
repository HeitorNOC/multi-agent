# Source trace at pinned commits
Generated from local source; excerpts are static evidence, not execution proof.

## [paperclip/server/src/routes/issues.ts:12948](https://github.com/paperclipai/paperclip/blob/1e3ab690b072bbf6a1c1f1d0454ea49315b2074c/server/src/routes/issues.ts#L12948)
```text
12947:       if (!isOnboardingFirstTask) {
12948:         void queueIssueAssignmentWakeup({
12949:           heartbeat,
12950:           issue,
12951:           reason: "issue_assigned",
12952:           mutation: "create",
```

## [paperclip/server/src/routes/issues.ts:9425](https://github.com/paperclipai/paperclip/blob/1e3ab690b072bbf6a1c1f1d0454ea49315b2074c/server/src/routes/issues.ts#L9425)
```text
9424: 
9425:   router.get("/issues/:id", async (req, res) => {
9426:     const timing = createIssueReadTiming();
9427:     const id = req.params.id as string;
9428:     const issue = await getAccessibleResource(
9429:       req,
```

## [paperclip/server/src/services/issue-assignment-wakeup.ts:46](https://github.com/paperclipai/paperclip/blob/1e3ab690b072bbf6a1c1f1d0454ea49315b2074c/server/src/services/issue-assignment-wakeup.ts#L46)
```text
45: }) {
46:   if (!input.issue.assigneeAgentId || input.issue.status === "backlog") return;
47: 
48:   return input.heartbeat
49:     .wakeup(input.issue.assigneeAgentId, {
50:       source: "assignment",
```

## [paperclip/server/src/services/issue-assignment-wakeup.ts:50](https://github.com/paperclipai/paperclip/blob/1e3ab690b072bbf6a1c1f1d0454ea49315b2074c/server/src/services/issue-assignment-wakeup.ts#L50)
```text
49:     .wakeup(input.issue.assigneeAgentId, {
50:       source: "assignment",
51:       triggerDetail: "system",
52:       reason: input.reason,
53:       payload: {
54:         issueId: input.issue.id,
```

## [paperclip/server/src/services/issues.ts:12150](https://github.com/paperclipai/paperclip/blob/1e3ab690b072bbf6a1c1f1d0454ea49315b2074c/server/src/services/issues.ts#L12150)
```text
12149: 
12150:     checkout: async (
12151:       id: string,
12152:       agentId: string,
12153:       expectedStatuses: string[],
12154:       checkoutRunId: string | null,
```

## [paperclip/server/src/services/issues.ts:12234](https://github.com/paperclipai/paperclip/blob/1e3ab690b072bbf6a1c1f1d0454ea49315b2074c/server/src/services/issues.ts#L12234)
```text
12233:         : isNull(issues.executionRunId);
12234:       const updated = await db.transaction(async tx => {
12235:         await notifyStatusCardIssueChange(tx, issueCompany.companyId);
12236:         await notifyIssueAttentionRetentionWork(tx, { companyId: issueCompany.companyId, issueId: id });
12237:         await notifyDeliveryWork(tx, DELIVERY_QUEUES.issueMonitors);
12238:         await notifyRunDispatch(tx, { companyId: issueCompany.companyId });
```

## [paperclip/server/src/services/issues.ts:12228](https://github.com/paperclipai/paperclip/blob/1e3ab690b072bbf6a1c1f1d0454ea49315b2074c/server/src/services/issues.ts#L12228)
```text
12227:           );
12228:       const executionLockCondition = checkoutRunId
12229:         ? or(
12230:             isNull(issues.executionRunId),
12231:             eq(issues.executionRunId, checkoutRunId),
12232:           )
```

## [paperclip/server/src/services/heartbeat/queue.ts:368](https://github.com/paperclipai/paperclip/blob/1e3ab690b072bbf6a1c1f1d0454ea49315b2074c/server/src/services/heartbeat/queue.ts#L368)
```text
367: /** Queue admission and dispatch share the service lifecycle callbacks and execution ownership. */
368: export function createHeartbeatQueue(db: Db, dependencies: HeartbeatQueueDependencies) {
369:   const {
370:     setRunStatus,
371:     setWakeupStatus,
372:     appendRunEvent,
```

## [paperclip/server/src/services/heartbeat/queue.ts:2063](https://github.com/paperclipai/paperclip/blob/1e3ab690b072bbf6a1c1f1d0454ea49315b2074c/server/src/services/heartbeat/queue.ts#L2063)
```text
2062: 
2063:   async function startNextQueuedRunForAgent(agentId: string) {
2064:     if ((await getSchedulingSuppression()).suppressed) return [];
2065:     const cutoff = await getWorktreeExecutionCutoff();
2066:     // Cancelled after the start lock is released: cancelRunInternal promotes the
2067:     // agent's next queued run, which takes this same lock.
```

## [paperclip/server/src/services/heartbeat/queue.ts:1995](https://github.com/paperclipai/paperclip/blob/1e3ab690b072bbf6a1c1f1d0454ea49315b2074c/server/src/services/heartbeat/queue.ts#L1995)
```text
1994: 
1995:   async function resumeQueuedRuns() {
1996:     await resumeDeferredExecutionReceipts();
1997:     await resumeQueuedRunsAfterDrain();
1998:   }
1999: 
```

## [paperclip/server/src/services/heartbeat/queue.ts:63](https://github.com/paperclipai/paperclip/blob/1e3ab690b072bbf6a1c1f1d0454ea49315b2074c/server/src/services/heartbeat/queue.ts#L63)
```text
62: } from "../native-runtime/native-review-participant.js";
63: import { claimQueuedNativeReviewRun } from "../native-runtime/native-review-dispatch.js";
64: import { adapterExecutionControls } from "../adapter-execution-control.js";
65: import { executionFailureRetryCount } from "../execution-recovery-attempt.js";
66: import {
67:   slackMentionAllowsRunStart,
```

## [paperclip/server/src/services/heartbeat/runtime-execution.ts:258](https://github.com/paperclipai/paperclip/blob/1e3ab690b072bbf6a1c1f1d0454ea49315b2074c/server/src/services/heartbeat/runtime-execution.ts#L258)
```text
257:       : { kind: "standard" as const };
258:   const authToken =
259:     nativeRuntimeResolution.kind === "legacy" &&
260:     adapter.supportsLocalAgentJwt
261:       ? createLocalAgentJwt(
262:           agent.id,
```

## [paperclip/server/src/services/heartbeat/runtime-execution.ts:845](https://github.com/paperclipai/paperclip/blob/1e3ab690b072bbf6a1c1f1d0454ea49315b2074c/server/src/services/heartbeat/runtime-execution.ts#L845)
```text
844:             input.effects.onLegacyAdapterEntered();
845:             return withAdapterExecutionPhase(executionPhaseContext, "adapter_execution", () => adapter.execute({
846:               getFreshSessionHandoff,
847:               agentIdentity,
848:               observability,
849:               runId: run.id,
```

## [paperclip/server/src/services/heartbeat/runtime-execution.ts:951](https://github.com/paperclipai/paperclip/blob/1e3ab690b072bbf6a1c1f1d0454ea49315b2074c/server/src/services/heartbeat/runtime-execution.ts#L951)
```text
950:       if (usageRecorder) {
951:         const captured = await measureRunPhase("execution.usage", () => usageRecorder.complete(adapterResult));
952:         adapterResult = { ...adapterResult, ...captured, usageComplete: captured.complete };
953:       } else {
954:         const accepted = await measureRunPhase("execution.usage", () => readAcceptedRunUsageCheckpoint(db, { companyId: run.companyId, runId: run.id }));
955:         adapterResult = { ...adapterResult, ...accepted, usageComplete: accepted?.complete ?? false,
```

## [paperclip/server/src/services/heartbeat/run-completion.ts:432](https://github.com/paperclipai/paperclip/blob/1e3ab690b072bbf6a1c1f1d0454ea49315b2074c/server/src/services/heartbeat/run-completion.ts#L432)
```text
431:     } else if (
432:       (adapterResult.exitCode ?? 0) === 0 &&
433:       !adapterResult.errorMessage &&
434:       !adapterResult.signal &&
435:       !processCancellation?.failed
436:     ) {
```

## [paperclip/server/src/services/heartbeat/run-completion.ts:564](https://github.com/paperclipai/paperclip/blob/1e3ab690b072bbf6a1c1f1d0454ea49315b2074c/server/src/services/heartbeat/run-completion.ts#L564)
```text
563:       ? null : resolveCacheAdjustedCostUsd(adapterResult);
564:     const usageJson: Record<string, unknown> = {
565:       accountingReceiptReady: adapterResult.usageComplete !== false,
566:       costUsdExact: adapterResult.costUsdExact ?? null,
567:       providerRequestId: adapterResult.providerRequestId ?? null,
568:       ...(normalizedUsage ?? {}),
```

## [paperclip/server/src/services/heartbeat/run-completion.ts:606](https://github.com/paperclipai/paperclip/blob/1e3ab690b072bbf6a1c1f1d0454ea49315b2074c/server/src/services/heartbeat/run-completion.ts#L606)
```text
605:       ...(adapterResult.costUsd != null
606:         ? { costUsd: adapterResult.costUsd }
607:         : {}),
608:       ...(cacheAdjustedCostUsd != null
609:         ? { cacheAdjustedCostUsd }
610:         : {}),
```

## [paperclip/server/src/services/heartbeat/recovery.ts:2640](https://github.com/paperclipai/paperclip/blob/1e3ab690b072bbf6a1c1f1d0454ea49315b2074c/server/src/services/heartbeat/recovery.ts#L2640)
```text
2639: 
2640:   async function reapOrphanedRuns(opts?: { staleThresholdMs?: number; skipNativeStatusWakeIntents?: boolean; skipScheduledRetryCancellation?: boolean; skipCapturedInstructionCommit?: boolean; skipInstructionDirectoryCleanup?: boolean; skipStoppedInstructionCollection?: boolean; skipCancelledWorkspacePreservation?: boolean; skipObsoletePolicyReviews?: boolean; skipAutomaticCompletionReviews?: boolean; skipUnsafeWorkspaceExports?: boolean; skipNativePendingEffects?: boolean; skipNativeResponsePresentation?: boolean; skipNativeReviewResponse?: boolean; skipNativeStatusReassessment?: boolean; skipRetainedNativeSessionCleanup?: boolean; skipNativeWorkspaceFinalization?: boolean; skipNativeResultCommit?: boolean; skipNativeRunProjection?: boolean; skipNativeRecoveryNotices?: boolean; skipExternalConversationSettlement?: boolean; skipExternalAgentSettlement?: boolean; skipNativeEnvironmentSettlement?: boolean }) {
2641:     if (!opts?.skipCancelledWorkspacePreservation) await preserveCancelledNativeWorkspaces(db);
2642:     const staleThresholdMs = opts?.staleThresholdMs ?? 0;
2643:     const now = new Date();
2644:     if (!opts?.skipScheduledRetryCancellation) await scheduledRetryCancellation.sweep();
```

## [paperclip/server/src/services/heartbeat/recovery.ts:2351](https://github.com/paperclipai/paperclip/blob/1e3ab690b072bbf6a1c1f1d0454ea49315b2074c/server/src/services/heartbeat/recovery.ts#L2351)
```text
2350:         nativeLocalProcess && !!run.processPid && isProcessAlive(run.processPid);
2351:       const nativeProcessGroupAlive =
2352:         nativeLocalProcess &&
2353:         !!run.processGroupId &&
2354:         isProcessGroupAlive(run.processGroupId);
2355:       const coordinatorOwnedByCurrentController =
```

## [paperclip/server/src/services/heartbeat/recovery.ts:801](https://github.com/paperclipai/paperclip/blob/1e3ab690b072bbf6a1c1f1d0454ea49315b2074c/server/src/services/heartbeat/recovery.ts#L801)
```text
800:       const processPidAlive = isProcessAlive(processPid);
801:       const processGroupAlive = isProcessGroupAlive(processGroupId);
802:       if (!processPid && !processGroupId) {
803:         classify(candidate, "lost", "missing_process_metadata", patch);
804:         continue;
805:       }
```

## [paperclip/server/src/adapters/http/execute.ts:11](https://github.com/paperclipai/paperclip/blob/1e3ab690b072bbf6a1c1f1d0454ea49315b2074c/server/src/adapters/http/execute.ts#L11)
```text
10:   const method = asString(config.method, "POST");
11:   const timeoutMs = asNumber(config.timeoutMs, 0);
12:   const headers = parseObject(config.headers) as Record<string, string>;
13:   const payloadTemplate = parseObject(config.payloadTemplate);
14:   const body = {
15:     ...payloadTemplate,
```

## [paperclip/server/src/adapters/http/execute.ts:14](https://github.com/paperclipai/paperclip/blob/1e3ab690b072bbf6a1c1f1d0454ea49315b2074c/server/src/adapters/http/execute.ts#L14)
```text
13:   const payloadTemplate = parseObject(config.payloadTemplate);
14:   const body = {
15:     ...payloadTemplate,
16:     agentId: agent.id,
17:     runId,
18:     context,
```

## [paperclip/server/src/adapters/http/execute.ts:41](https://github.com/paperclipai/paperclip/blob/1e3ab690b072bbf6a1c1f1d0454ea49315b2074c/server/src/adapters/http/execute.ts#L41)
```text
40: 
41:     if (!res.ok) {
42:       throw new Error(`HTTP invoke failed with status ${res.status}`);
43:     }
44: 
45:     return {
```

## [paperclip/server/src/adapters/http/execute.ts:46](https://github.com/paperclipai/paperclip/blob/1e3ab690b072bbf6a1c1f1d0454ea49315b2074c/server/src/adapters/http/execute.ts#L46)
```text
45:     return {
46:       exitCode: 0,
47:       signal: null,
48:       timedOut: false,
49:       summary: `HTTP ${method} ${url}`,
50:     };
```

## [paperclip/server/src/adapters/http/remote-fetch.ts:7](https://github.com/paperclipai/paperclip/blob/1e3ab690b072bbf6a1c1f1d0454ea49315b2074c/server/src/adapters/http/remote-fetch.ts#L7)
```text
6: 
7: const PRIVATE_ENDPOINT_ALLOWLIST_ENV = "PAPERCLIP_HTTP_ADAPTER_PRIVATE_ENDPOINT_ALLOWLIST";
8: 
9: export class HttpAdapterEndpointError extends Error {
10:   readonly code: string;
11: 
```

## [paperclip/server/src/adapters/http/remote-fetch.ts:74](https://github.com/paperclipai/paperclip/blob/1e3ab690b072bbf6a1c1f1d0454ea49315b2074c/server/src/adapters/http/remote-fetch.ts#L74)
```text
73:     ...options,
74:     allowPrivateNetwork: allowlist.has(endpoint.origin.toLowerCase()),
75:     error: endpointError,
76:   });
77: }
```

## [paperclip/server/src/adapters/plugin-loader.ts:163](https://github.com/paperclipai/paperclip/blob/1e3ab690b072bbf6a1c1f1d0454ea49315b2074c/server/src/adapters/plugin-loader.ts#L163)
```text
162: 
163:   const adapterModule = createServerAdapter() as ServerAdapterModule;
164:   if (!adapterModule || !adapterModule.type) {
165:     throw new Error(
166:       `createServerAdapter() from "${packageName}" returned an invalid module (missing "type").`,
167:     );
```

## [paperclip/server/src/adapters/plugin-loader.ts:185](https://github.com/paperclipai/paperclip/blob/1e3ab690b072bbf6a1c1f1d0454ea49315b2074c/server/src/adapters/plugin-loader.ts#L185)
```text
184: 
185: export async function loadExternalAdapterPackage(
186:   packageName: string,
187:   localPath?: string,
188: ): Promise<ServerAdapterModule> {
189:   assertExternalAdapterCodeAllowed();
```

## [paperclip/server/src/routes/adapters.ts:330](https://github.com/paperclipai/paperclip/blob/1e3ab690b072bbf6a1c1f1d0454ea49315b2074c/server/src/routes/adapters.ts#L330)
```text
329:    */
330:   router.post("/adapters/install", async (req, res) => {
331:     assertInstanceAdmin(req);
332:     assertExternalAdapterCodeAllowed();
333:     assertAdapterManagementVisible();
334: 
```

## [paperclip/server/src/routes/adapters.ts:243](https://github.com/paperclipai/paperclip/blob/1e3ab690b072bbf6a1c1f1d0454ea49315b2074c/server/src/routes/adapters.ts#L243)
```text
242:  */
243: function registerWithSessionManagement(adapter: ServerAdapterModule): void {
244:   registerServerAdapter(resolveExternalAdapterRegistration(adapter));
245: }
246: 
247: // ---------------------------------------------------------------------------
```

## [paperclip/server/src/middleware/auth.ts:48](https://github.com/paperclipai/paperclip/blob/1e3ab690b072bbf6a1c1f1d0454ea49315b2074c/server/src/middleware/auth.ts#L48)
```text
47: 
48: function hashToken(token: string) {
49:   return createHash("sha256").update(token).digest("hex");
50: }
51: 
52: function normalizeOptionalString(value: string | null | undefined) {
```

## [paperclip/server/src/middleware/auth.ts:23](https://github.com/paperclipai/paperclip/blob/1e3ab690b072bbf6a1c1f1d0454ea49315b2074c/server/src/middleware/auth.ts#L23)
```text
22: } from "../services/issue-prefix.js";
23: import { verifyLocalAgentJwt } from "../agent-auth-jwt.js";
24: import { agentRunWritesRevoked } from "../agent-run-cancellation.js";
25: import { loadAgentRunAuthentication } from "./agent-run-authentication.js";
26: import { isUuidLike, normalizeAgentApiKeyScope, type DeploymentMode } from "@paperclipai/shared";
27: import type { BetterAuthSessionResult } from "../auth/better-auth.js";
```

## [paperclip/server/src/middleware/auth.ts:24](https://github.com/paperclipai/paperclip/blob/1e3ab690b072bbf6a1c1f1d0454ea49315b2074c/server/src/middleware/auth.ts#L24)
```text
23: import { verifyLocalAgentJwt } from "../agent-auth-jwt.js";
24: import { agentRunWritesRevoked } from "../agent-run-cancellation.js";
25: import { loadAgentRunAuthentication } from "./agent-run-authentication.js";
26: import { isUuidLike, normalizeAgentApiKeyScope, type DeploymentMode } from "@paperclipai/shared";
27: import type { BetterAuthSessionResult } from "../auth/better-auth.js";
28: import { logger } from "./logger.js";
```

## [paperclip/server/src/services/authorization.ts:2270](https://github.com/paperclipai/paperclip/blob/1e3ab690b072bbf6a1c1f1d0454ea49315b2074c/server/src/services/authorization.ts#L2270)
```text
2269:     }
2270:     if (input.actor.companyId !== companyId) {
2271:       return deny({
2272:         action: input.action,
2273:         reason: "deny_company_boundary",
2274:         explanation: "Agent key cannot access another company.",
```

## [paperclip/server/src/services/authorization.ts:2288](https://github.com/paperclipai/paperclip/blob/1e3ab690b072bbf6a1c1f1d0454ea49315b2074c/server/src/services/authorization.ts#L2288)
```text
2287:     if (isConnectionManagementAction(input.action) &&
2288:         (input.actor.keyScope?.kind === "skill_test" || input.actor.keyScope?.kind === "task_bridge")) {
2289:       return deny({ action: input.action, reason: "deny_scope", explanation: "Scoped test and task bridge credentials cannot administer connections." });
2290:     }
2291: 
2292:     if (input.actor.keyScope?.kind === "skill_test") {
```

## [paperclip/server/src/services/budgets.ts:206](https://github.com/paperclipai/paperclip/blob/1e3ab690b072bbf6a1c1f1d0454ea49315b2074c/server/src/services/budgets.ts#L206)
```text
205: 
206: function observedBlocks(policy: PolicyRow, observed: Awaited<ReturnType<typeof computeObservedSpend>>) {
207:   if (!policy.isActive || !policy.hardStopEnabled || policy.amount <= 0) return false;
208:   return compareCents(observed.totalExact, policy.amount) >= 0 || (observed.pendingRunCount - observed.recoveringRunCount) > 0 || unpricedUsageBlocks(policy, observed);
209: }
210: export async function policyBlocks(db: Db, policy: PolicyRow) {
```

## [paperclip/server/src/services/budgets.ts:210](https://github.com/paperclipai/paperclip/blob/1e3ab690b072bbf6a1c1f1d0454ea49315b2074c/server/src/services/budgets.ts#L210)
```text
209: }
210: export async function policyBlocks(db: Db, policy: PolicyRow) {
211:   if (!policy.isActive || !policy.hardStopEnabled || policy.amount <= 0) return false;
212:   return observedBlocks(policy, await computeObservedSpend(db, policy));
213: }
214: 
```

## [paperclip/server/src/services/budgets.ts:239](https://github.com/paperclipai/paperclip/blob/1e3ab690b072bbf6a1c1f1d0454ea49315b2074c/server/src/services/budgets.ts#L239)
```text
238:       if (capacity > 0 || (compareCents(reservation.amountCents, 0) === 0 && capacity >= 0))
239:         return "Available budget is reserved by unfinished runs";
240:     }
241:     return null;
242:   });
243: }
```

## [paperclip/packages/db/src/schema/companies.ts:19](https://github.com/paperclipai/paperclip/blob/1e3ab690b072bbf6a1c1f1d0454ea49315b2074c/packages/db/src/schema/companies.ts#L19)
```text
18:     defaultResponsibleUserId: text("default_responsible_user_id"),
19:     requireBoardApprovalForNewAgents: boolean("require_board_approval_for_new_agents")
20:       .notNull()
21:       .default(false),
22:     interactionResolverGovernance: jsonb("interaction_resolver_governance")
23:       .$type<InteractionResolverGovernance>()
```

## [paperclip/packages/db/src/schema/companies.ts:21](https://github.com/paperclipai/paperclip/blob/1e3ab690b072bbf6a1c1f1d0454ea49315b2074c/packages/db/src/schema/companies.ts#L21)
```text
20:       .notNull()
21:       .default(false),
22:     interactionResolverGovernance: jsonb("interaction_resolver_governance")
23:       .$type<InteractionResolverGovernance>()
24:       .notNull()
25:       .default({}),
```

## [paperclip/packages/db/src/schema/agents.ts:34](https://github.com/paperclipai/paperclip/blob/1e3ab690b072bbf6a1c1f1d0454ea49315b2074c/packages/db/src/schema/agents.ts#L34)
```text
33:     lifecycleOperation: jsonb("lifecycle_operation").$type<AgentLifecycleOperation>(),
34:     reportsTo: uuid("reports_to").references((): AnyPgColumn => agents.id),
35:     capabilities: text("capabilities"),
36:     adapterType: text("adapter_type").notNull().default("process"),
37:     adapterConfig: jsonb("adapter_config").$type<Record<string, unknown>>().notNull().default({}),
38:     runtimeConfig: jsonb("runtime_config").$type<Record<string, unknown>>().notNull().default({}),
```

## [paperclip/server/src/routes/agents.ts:4785](https://github.com/paperclipai/paperclip/blob/1e3ab690b072bbf6a1c1f1d0454ea49315b2074c/server/src/routes/agents.ts#L4785)
```text
4784:     }
4785:     if (company.requireBoardApprovalForNewAgents && !req.body.setupId) {
4786:       throw conflict(
4787:         "Direct agent creation requires board approval. Use POST /api/companies/:companyId/agent-hires to create a pending hire approval.",
4788:       );
4789:     }
```

## [paperclip/server/src/routes/agents.ts:5996](https://github.com/paperclipai/paperclip/blob/1e3ab690b072bbf6a1c1f1d0454ea49315b2074c/server/src/routes/agents.ts#L5996)
```text
5995: 
5996:   router.post("/agents/:id/keys", validate(createAgentKeySchema), async (req, res) => {
5997:     assertBoard(req);
5998:     const id = req.params.id as string;
5999:     const agent = await getAccessibleAgent(req, res, id);
6000:     if (!agent) {
```

## [paperclip/server/src/routes/agents.ts:6344](https://github.com/paperclipai/paperclip/blob/1e3ab690b072bbf6a1c1f1d0454ea49315b2074c/server/src/routes/agents.ts#L6344)
```text
6343: 
6344:   router.post("/agents/:id/heartbeat/invoke", async (req, res) => {
6345:     // Legacy endpoint. Hardcodes `source: "on_demand"` (the prior behavior
6346:     // before the wakeup/invoke convergence). Reads scope fields directly off
6347:     // the body without `validate(wakeAgentSchema)` because callers — including
6348:     // the e2e suite — post an empty body, and the schema rejects undefined
```

## [paperclip/packages/adapter-utils/src/types.ts:102](https://github.com/paperclipai/paperclip/blob/1e3ab690b072bbf6a1c1f1d0454ea49315b2074c/packages/adapter-utils/src/types.ts#L102)
```text
101: 
102: export interface AdapterExecutionResult {
103:   /** Positive evidence for retrying bootstrap; absent evidence never authorizes replay. */
104:   executionRecovery?: { kind: "bootstrap"; providerWorkStarted: false } | {
105:     kind: "interrupted";
106:     providerStopped: true;
```

## [paperclip/packages/adapter-utils/src/types.ts:46](https://github.com/paperclipai/paperclip/blob/1e3ab690b072bbf6a1c1f1d0454ea49315b2074c/packages/adapter-utils/src/types.ts#L46)
```text
45:   usage?: UsageSummary;
46:   usageByModel?: Array<{ model: string; usage: UsageSummary; costUsd: number }>;
47:   usageBasis?: "per_run" | "session_cumulative" | null;
48:   provider?: string | null;
49:   biller?: string | null;
50:   model?: string | null;
```

## [paperclip/packages/adapter-utils/src/types.ts:245](https://github.com/paperclipai/paperclip/blob/1e3ab690b072bbf6a1c1f1d0454ea49315b2074c/packages/adapter-utils/src/types.ts#L245)
```text
244:   /** Run-scoped operator cancellation; adapters must settle before returning. */
245:   signal?: AbortSignal;
246:   /** Opt in to signal-based cancellation before starting provider work. */
247:   onCancellationReady?: () => Promise<void>;
248:   /** Host-owned stop of this run's sandbox during setup or direct CLI execution. Resolves only after
249:    * provider termination is verified; never accepts an agent-selected lease. */
```

## [paperclip/packages/adapter-utils/src/types.ts:287](https://github.com/paperclipai/paperclip/blob/1e3ab690b072bbf6a1c1f1d0454ea49315b2074c/packages/adapter-utils/src/types.ts#L287)
```text
286:   onSpawn?: (meta: { pid: number; processGroupId: number | null; startedAt: string }) => Promise<void>;
287:   authToken?: string;
288:   /**
289:    * The injected OpenTelemetry startup trace context (tracer + root
290:    * parent-context helper). The server passes the real, endpoint-gated
291:    * implementation; when absent, the ACPX engine uses a no-op, so the whole
```

## [paperclip/packages/shared/src/telemetry/config.ts:71](https://github.com/paperclipai/paperclip/blob/1e3ab690b072bbf6a1c1f1d0454ea49315b2074c/packages/shared/src/telemetry/config.ts#L71)
```text
70: 
71:   if (process.env.PAPERCLIP_TELEMETRY_DISABLED === "1") {
72:     return { enabled: false, ...caps };
73:   }
74:   if (process.env.DO_NOT_TRACK === "1") {
75:     return { enabled: false, ...caps };
```

## [paperclip/server/src/index.ts:634](https://github.com/paperclipai/paperclip/blob/1e3ab690b072bbf6a1c1f1d0454ea49315b2074c/server/src/index.ts#L634)
```text
633:           user: "paperclip",
634:           password: "paperclip",
635:           port,
636:           persistent: true,
637:           initdbFlags: ["--encoding=UTF8", "--locale=C", "--lc-messages=C"],
638:           onLog: appendEmbeddedPostgresLog,
```

## [paperclip/server/src/index.ts:506](https://github.com/paperclipai/paperclip/blob/1e3ab690b072bbf6a1c1f1d0454ea49315b2074c/server/src/index.ts#L506)
```text
505:     | { mode: "external-postgres"; connectionString: string }
506:     | { mode: "embedded-postgres"; dataDir: string; port: number };
507:   if ("deploymentMode" in startupConfig) assertCloudDatabaseContract(startupConfig);
508:   if (startupConfig.databaseUrl) {
509:     const migrationUrl = startupConfig.databaseMigrationUrl ?? startupConfig.databaseUrl;
510:     migrationSummary = await ensureMigrations(migrationUrl, "PostgreSQL");
```

## [lightrag/lightrag/lightrag.py:4901](https://github.com/HKUDS/LightRAG/blob/aaebfe1bb8d55deb6a4304d357a3bf4c92fcd40a/lightrag/lightrag.py#L4901)
```text
4900: 
4901:     async def aquery_data(
4902:         self,
4903:         query: str,
4904:         param: QueryParam = QueryParam(),
4905:     ) -> dict[str, Any]:
```

## [lightrag/lightrag/lightrag.py:4340](https://github.com/HKUDS/LightRAG/blob/aaebfe1bb8d55deb6a4304d357a3bf4c92fcd40a/lightrag/lightrag.py#L4340)
```text
4339: 
4340:     async def ainsert_custom_kg(
4341:         self,
4342:         custom_kg: dict[str, Any],
4343:         full_doc_id: str = None,
4344:     ) -> None:
```

## [lightrag/lightrag/lightrag.py:4354](https://github.com/HKUDS/LightRAG/blob/aaebfe1bb8d55deb6a4304d357a3bf4c92fcd40a/lightrag/lightrag.py#L4354)
```text
4353:         .. warning:: (direct-writer audit)
4354:            This path is OUTSIDE the document-level recovery guarantee. It has
4355:            no durable operation journal and does not prewrite
4356:            ``full_entities`` / ``full_relations`` recovery anchors, so a
4357:            crash or partial failure mid-call can leave graph/vector/tracking
4358:            contributions that per-document purge, retry, and scan rollback
```

## [lightrag/lightrag/base.py:90](https://github.com/HKUDS/LightRAG/blob/aaebfe1bb8d55deb6a4304d357a3bf4c92fcd40a/lightrag/base.py#L90)
```text
89: @dataclass
90: class QueryParam:
91:     """Configuration parameters for query execution in LightRAG."""
92: 
93:     mode: Literal["local", "global", "hybrid", "naive", "mix", "bypass"] = "mix"
94:     """Specifies the retrieval mode:
```

## [langgraph/libs/checkpoint-sqlite/langgraph/checkpoint/sqlite/aio.py:42](https://github.com/langchain-ai/langgraph/blob/3c916d750575b22c464790e9774494d810ccd322/libs/checkpoint-sqlite/langgraph/checkpoint/sqlite/aio.py#L42)
```text
41: 
42: class AsyncSqliteSaver(BaseCheckpointSaver[str]):
43:     """An asynchronous checkpoint saver that stores checkpoints in a SQLite database.
44: 
45:     This class provides an asynchronous interface for saving and retrieving checkpoints
46:     using a SQLite database. It's designed for use in asynchronous environments and
```
