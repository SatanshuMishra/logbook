# M3 — Server skeleton

**Depends on:** M1. Runs in parallel with M2.

**Ships:** the stdio server on the current SDK line, the server instructions string, registration, structured output, annotations, the error contract, and the real-spawn test harness every later unit uses.

**Read first:** SPEC §7.1, §7.2, §7.3, §7.6, §10.1, §10.2, §10.3, §11.4, §12.1, §12.4.

---

## Premise checks

- [ ] **P1. M1 is merged and green on `main`.**
- [ ] **P2. The SDK registers a tool with a zod input and output schema.** Write a throwaway five-line server, `registerTool('t', { description, inputSchema: z.object({a: z.string()}), outputSchema: z.object({b: z.string()}), annotations: { readOnlyHint: true } }, handler)`, and confirm it type-checks against `@modelcontextprotocol/sdk@1.30.0`. If `inputSchema` no longer accepts a `z.ZodObject`, re-plan the registration layer before writing tools.
- [ ] **P3. Declaring an output schema and returning no `structuredContent` throws.** Confirm it against the installed SDK. §7.3 states this as a trap; if it is no longer true, the guard test in Task 3 is re-scoped rather than deleted.
- [ ] **P4. `z.toJSONSchema` output is accepted as a tool schema.** The registration path must carry `.describe()` text through to the published property description; confirm by listing tools from a spawned server and reading one property's `description`.
- [ ] **P5. A root-level `oneOf`, `anyOf` or `allOf` is producible by accident.** Confirm that `z.union([...])` at the top level of an input schema emits a root `anyOf`. If it does, Task 2's guard is required; §7.1 records that this shape has caused a 400 that broke entire sessions.

---

## Acceptance — the ceiling

| # | Criterion | Proven by |
|---|---|---|
| A1 | A spawned binary completes the handshake and lists its tools | `server.spawn-handshake` passes |
| A2 | A deliberate stdout write in server code fails the suite | `server.stray-stdout-breaks-transport` passes |
| A3 | Server instructions and every tool description are under 2 KB | `contract.instructions-within-budget` passes |
| A4 | No input schema carries a root-level `oneOf`, `anyOf` or `allOf` | `contract.no-root-union` passes as a census |
| A5 | A validation failure returns a tool error, never a protocol error | `error.validation-is-in-band` passes |
| A6 | No refusal discloses an absolute filesystem path | `error.discloses-no-path` passes as a census |
| A7 | The spawn harness is reusable by every later unit | `rebuild/test/support/spawn-client.ts` exists and M4 consumes it unchanged |

**Red on the parent commit:** `server.spawn-handshake`.

**Inertness mutation:** in `rebuild/src/server/errors.ts`, delete the path-stripping step in `toolRefusal`. `error.discloses-no-path` must turn red.

---

## Files

**Create:** `rebuild/bin/logbook-server.ts`; `rebuild/src/server/main.ts`, `instructions.ts`, `errors.ts`, `register.ts`; `rebuild/test/support/spawn-client.ts`, `schema-arbitrary.ts`; `rebuild/test/spawn/handshake.test.ts`, `stdout.test.ts`; `rebuild/test/contract/budget.test.ts`, `no-root-union.test.ts`, `no-path.test.ts`.

**Modify:** `package.json` — add `rebuild/test/spawn/` to `rebuild:test`.

---

## Task 1: The entry point and the spawn harness

**Files:** `rebuild/bin/logbook-server.ts`, `rebuild/src/server/main.ts`, `rebuild/test/support/spawn-client.ts`, `rebuild/test/spawn/handshake.test.ts`

**Produces:**

```ts
export type SpawnedServer = {
  client: Client
  close: () => Promise<void>
  stderr: () => string
}
export const spawnServer: (opts: { env?: Record<string, string>; projectRoot: string }) => Promise<SpawnedServer>
```

- [ ] **Step 1: Write the failing handshake test**

`rebuild/test/spawn/handshake.test.ts`, name `server.spawn-handshake`: spawn the **built** binary over real stdio using the SDK's own `StdioClientTransport`, complete `initialize`, call `tools/list`, and assert the result is a list. Assert separately that `stderr()` contains no JSON-RPC framing, which would mean a reply went to the wrong stream.

**Why real spawn and not the in-memory transport** (§11.4): the in-memory linked transport speaks an older protocol era than the server ships against, and it passes objects by reference, so it is structurally blind to stray stdout. For a stdio server, a real spawn is the only honest in-band entry point.

- [ ] **Step 2: Run it and confirm it fails**

Expected: FAIL, the binary does not exist.

- [ ] **Step 3: Write `main.ts` and the entry point**

`main.ts` constructs `McpServer` with `{ name: 'logbook', version }`, `{ instructions, capabilities: { tools: { listChanged: true }, resources: { listChanged: true }, prompts: {}, completions: {} } }`, connects a `StdioServerTransport`, and returns. No tool is registered here — `register.ts` owns that, and M4 onward fill it.

`rebuild/bin/logbook-server.ts` carries the shebang `#!/usr/bin/env node`, builds `productionRuntime()`, and calls `main`. **A shebang is a functional directive, not a comment.**

The process installs an `uncaughtException` and `unhandledRejection` handler that logs to stderr and exits non-zero. **A crash reports that it crashed** (§10.3); it never exits 0.

- [ ] **Step 4: Write the spawn harness**

`spawnServer` builds first (`npm run rebuild:build` is a prerequisite the harness asserts, failing with a clear message if `rebuild/dist/bin/logbook-server.js` is absent), then spawns it with an environment that is **an explicit allowlist**, not `process.env`. A server that depends on an inherited variable works in process and dies when spawned (§11.4); the harness is what surfaces that.

- [ ] **Step 5: Run to green and commit**

```bash
npm run rebuild:build && node --test rebuild/test/spawn/handshake.test.ts
git add rebuild/bin rebuild/src/server/main.ts rebuild/test/support/spawn-client.ts rebuild/test/spawn/handshake.test.ts
git commit -m "feat(rebuild): serve logbook over stdio and spawn it in tests"
```

---

## Task 2: Registration, annotations and structured output

**Files:** `rebuild/src/server/register.ts`, `rebuild/test/contract/no-root-union.test.ts`

**Produces:**

```ts
export type ToolSpec<I, O> = {
  name: string
  title: string
  description: string
  input: z.ZodObject<z.ZodRawShape>
  output: z.ZodObject<z.ZodRawShape>
  annotations: { readOnlyHint: boolean; destructiveHint: boolean; idempotentHint: boolean; openWorldHint: false }
  handler: (rt: Runtime, ctx: ToolContext, input: I) => Promise<ToolReply<O>>
}
export type ToolReply<O> = { ok: true; text: string; structured: O } | { ok: false; refusal: Refusal }
export const registerTool: <I, O>(server: McpServer, rt: Runtime, spec: ToolSpec<I, O>) => void
export const ALL_TOOLS: ToolSpec<never, never>[]
```

`ALL_TOOLS` is the single array every later unit appends to, and it is what the description census, the budget census and the root-union census all iterate. One list, three gates.

- [ ] **Step 1: Write the failing census `contract.no-root-union`**

For every entry in `ALL_TOOLS`, compute `z.toJSONSchema(spec.input)` and assert the root node has no `oneOf`, `anyOf` or `allOf` key. Anything at the root that is neither `type: 'object'` nor one of the three forbidden keys halts the census.

Where a real constraint is a union, §7.1 records the client's own repair: **flatten the schema and write the constraint into the description in prose.** That is the strongest available endorsement of prose over schema, and it is the pattern every tool follows.

- [ ] **Step 2: Implement `registerTool`**

It maps a `ToolSpec` onto the SDK's `server.registerTool`, and wraps the handler so that:

- a `ToolReply` with `ok: true` returns `{ content: [{ type: 'text', text }], structuredContent: structured }` — **both**, because there is no general auto-fallback that fills in the text block (§7.3);
- a `ToolReply` with `ok: false` returns `toolRefusal(refusal)`, which sets `isError: true`. Validation is skipped for an error result, so an error never has to satisfy the success schema;
- a thrown exception is caught at this one boundary, logged to stderr with its stack, and returned as a tool error. This is the **only** catch in the server, and it swallows nothing: the diagnostic is emitted before the reply.

Every write tool's reply reports **what changed**, not what the record now is (§7.3). A call that retires two risks returns their ids. That is what makes deletion, no-op and success distinguishable, and it is what collapsed one measured return from 6,269 bytes.

- [ ] **Step 3: Run to green and commit**

```bash
git add rebuild/src/server/register.ts rebuild/test/contract/no-root-union.test.ts
git commit -m "feat(rebuild): register tools with structured output and behavioural annotations"
```

---

## Task 3: The error contract

**Files:** `rebuild/src/server/errors.ts`, `rebuild/test/contract/no-path.test.ts`, `rebuild/test/spawn/errors.test.ts`

- [ ] **Step 1: Write the failing tests**

```
error.validation-is-in-band   call a registered probe tool with an input that violates its schema;
                              assert the CALL RESOLVES with isError true and a payload naming the
                              field, NOT that the promise rejects
error.discloses-no-path       a census: force a refusal from every code path in errors.ts that can
                              produce one, and assert no message matches an absolute path pattern
                              for either platform separator
error.output-schema-guard     a probe tool that declares an output schema and returns no
                              structuredContent produces a visible failure, not a silent success
```

`error.validation-is-in-band` is the anti-pattern §11.3 names directly: tool failures resolve **in band** as an error result and do not reject, so an assertion on a rejected promise passes only when something else broke.

- [ ] **Step 2: Implement**

`toolRefusal(r)` renders the four parts of §10.2 in order — which field, what is accepted, a valid example, whether a retry can succeed — from the `Refusal` M1's `declare` already produced. **Nothing here is hand-written.**

Path non-disclosure is structural: the store directory travels on a **non-emitted** property of an internal error object, and `toolRefusal` reads only the emitted properties. One call site covers every refusal (§10.4), rather than each refusal remembering to redact.

- [ ] **Step 3: Run to green and commit**

```bash
git add rebuild/src/server/errors.ts rebuild/test/contract/no-path.test.ts rebuild/test/spawn/errors.test.ts
git commit -m "feat(rebuild): refuse in band with a schema-generated message and no path"
```

---

## Task 4: Server instructions

**Files:** `rebuild/src/server/instructions.ts`, `rebuild/test/contract/budget.test.ts`

The `instructions` string is the only text never deferred by tool search — 2 KB of always-resident real estate, and the current build sends none (§7.6). This is the text, complete:

```
Logbook remembers a project across sessions. It records what was being worked on, what was
decided and why, and what the next step is, and it stores that history in the project's own
git repository so a whole team shares one record.

Resuming is one call and parking is one call. resume_thread reconciles, marks the thread as
being worked, and returns the finished briefing. park_thread writes the session log, refreshes
the running summary, and releases the thread. Neither needs a preparatory call.

Identifiers are ULIDs: 26 characters, Crockford base32, for example
01M0NDPM0ACCR9CD68PMHYWGGD. Do not compose one. Take a thread id from list_threads or from the
logbook://roster resource, and a decision id from the tool result that created it.

Reads are also available without a tool call. logbook://index lists every readable address.

A refusal from this server is structured and worth reading. It names the field that was wrong,
what that field accepts, a valid example, and whether a retry can succeed. Read it and correct
the argument rather than retrying the same call.
```

- [ ] **Step 1: Write the failing budget census `contract.instructions-within-budget`**

Assert `Buffer.byteLength(INSTRUCTIONS, 'utf8') < 2048`. Then, for every entry in `ALL_TOOLS`, assert `Buffer.byteLength(spec.description, 'utf8') < 2048`. Both are truncated at 2 KB by the client and truncation takes the tail (§7.1), so the budget is a hard property, not a style note.

- [ ] **Step 2: Add the lead-sentence assertion**

For every tool, assert the description's first sentence is at most 200 bytes. The most important sentence goes first precisely because the tail is what disappears.

- [ ] **Step 3: Run to green and commit**

```bash
git add rebuild/src/server/instructions.ts rebuild/test/contract/budget.test.ts
git commit -m "feat(rebuild): send always-resident server instructions under the 2 kb budget"
```

---

## Task 5: The stray-stdout proof

**Files:** `rebuild/test/spawn/stdout.test.ts`

- [ ] **Step 1: Write `server.stray-stdout-breaks-transport`**

Spawn the built binary with an environment variable the server reads only in test builds — no. Do it without a production affordance: spawn a **wrapper** script that imports the built server module and writes one byte to stdout before connecting the transport. Assert the client's handshake fails with a parse error.

This is what proves the guard is real rather than aspirational. The M1 census catches stdout writes in this project's source; only a spawn catches one from a dependency, and only this test proves the failure is loud rather than silent.

- [ ] **Step 2: Run to green, run the inertness mutation, commit**

Delete the path-stripping step in `toolRefusal`; confirm `error.discloses-no-path` turns red; restore.

- [ ] **Step 3: Open the pull request**

```bash
node .claude/lib/git/pr.mjs pr-create \
  --repo SatanshuMishra/logbook --head feat/logbook-m3-server-skeleton --base main \
  --title "feat(server): serve logbook over stdio with a structured error contract" \
  --what "The server now introduces itself with always-resident instructions that say how to resume and park in one call." \
  --what "A rejected argument comes back naming the field, what it accepts, a working example, and whether retrying can help." \
  --why "The server sent no instructions at all, and a rejection named a limit without saying which value broke it or offering one that works." \
  --verified "spawned handshake and tool listing - passing" \
  --verified "instructions and description byte budgets - all under 2048" \
  --not-verified "how the client renders structured content to the model - unverified, see spec section 14 item 7"
```
