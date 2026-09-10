# Cap and budget architecture

Date: 2026-09-09
Status: specified, not implemented
Thread: 01M21N6HRVE8TK710EX6SY4065

## Who this is for

A reader who has never seen this codebase. Every term is defined at first use. Every number is
either cited to a file and line, cited to a source, or marked as measured in this thread with the
command that produced it.

## The two things this document calls by different names

A **write-time cap** is a maximum enforced when a record is stored. Exceeding it refuses the whole
call; nothing is written.

A **render-time limit** is a maximum applied when a record is read back and turned into the
preflight briefing, the summary a fresh coding session reads to resume work.

They are separate systems, built eighteen days apart, for different problems. Conflating them is
the root of most of what follows.

## The problem

### 1. Almost no number has a recorded reason

Of roughly 92 enforced limits in the product, 6 have a written derivation of their magnitude, 17
have a written reason the limit exists but not why it is that size, and roughly 60 have nothing
recorded anywhere. Within `src/schema/caps.ts` specifically, 25 of 42 have nothing.

No value in `src/schema/caps.ts` has ever changed since it was introduced. Exactly one commit in
the entire repository history names a cap constant, and states only that it exists. The commit that
created the file has no body; its pull request gives durability, not size, as its reason.

### 2. The limits are not centralised, and copies drift silently

`src/schema/caps.ts` holds 42 of them. At least 33 more named limits live in other files, including
every render budget, both retry budgets, both page sizes, and two genuine schema caps stranded in
`src/server/tools/resolve_conflict.ts:32-33`. Separate sweeps returned different totals for the
population, which is itself evidence that no one can enumerate it.

Twenty-two sites restate a number defined elsewhere. Sixteen of those drift silently: no test turns
red when the constant moves and the copy does not. The worst carries the enforcing constant and its
hand-typed twin on the same line, at `src/server/tools/log_session_event.ts:17`.

### 3. The census cannot prove any value

`test/unit/caps-census.test.ts` reads a limit out of the generated schema and then asserts the
refusal message contains that number. The message is itself built by echoing the same schema
keywords. It compares the schema against itself, and would pass unchanged if every limit in the
tree were wrong.

Its population is `Object.keys(caps)`, so a limit defined outside that file satisfies the census by
being invisible to it. That circularity is the mechanism by which the other limits accumulated.

### 4. The per-field caps do not bound what they appear to bound

Two hundred criteria at their own field caps permit roughly 520,000 bytes against a whole-record cap
of 65,536. Two hundred key decisions at their caps permit roughly 92,000 bytes, over the record cap
on their own.

The per-field caps therefore cannot be protecting the record. The record cap does that alone, and it
is the only cap anyone ever measured.

### 5. The briefing shortens every item by the same amount

When the briefing does not fit, one shrink ceiling is applied to every shortenable item at once and
a binary search finds the largest that fits. Measured on this thread: fourteen session entries, every
one rendered at exactly 519 characters, each announcing a topic and cut mid-sentence before its
finding.

The research says this is the wrong operation. Length costs a reader accuracy even when every added
token is relevant, falling from 0.92 to 0.68 as input grows from 250 to 3,000 tokens with task
difficulty held constant ([aclanthology.org](https://aclanthology.org/2024.acl-long.818/)). But the
only measured wins from trimming an agent's context come from removing content that is *redundant*,
not content that is *late* ([arxiv.org](https://arxiv.org/abs/2509.23586)).

### 6. Escaping destroys prose and breaks a hook

Every line break in stored text is rewritten as the six-character token `U+000A`. A two-paragraph
session summary arrives as one unbroken wall. This costs six characters per line break and removes
the structure a reader would use to skim.

It also makes a shipped gate unpayable. A hook requires the briefing to be echoed back verbatim,
comparing by exact substring. Any reader who renders those tokens back into real line breaks, which
is what reading prose means, fails the comparison permanently.

### 7. Two documented behaviours are false

`docs/rules/continuity-ledger.md:186-194` states that every size cap refuses and nothing is
shortened, and that the whole-record refusal names no field and no number. Eight shortening call
sites ship, and `src/server/tool-support.ts:123` names both the field and the number.

The same text is installed as a global rule loaded into every session on this machine, from a
different repository.

## The governing principle

### A write-time cap is a hard refusal only if it passes one of four tests

1. **The number is not ours.** It records an external fact: a git branch-name length, a hash length,
   a transport ceiling. These never need tuning because they were never chosen.
2. **Breaching breaks rather than costs.** A record too large to write or parse is a broken record.
   Binary failure, not a quality trade-off.
3. **Compression is the point.** The cap exists to force the writer to decide something, and the
   shortness is the value rather than a side effect.
4. **Nothing else bounds it.** No aggregate limit sits above the field, so absent this cap the thing
   is unbounded.

A limit that passes none of these is not a cap. It is an arbitrary number wearing a cap's clothes.

### A render-time limit is a guarantee, never a ceiling

A field declares the minimum share of the briefing it is promised. The budget allocates above those
floors. Nothing declares a maximum.

**Intent, stated so it cannot be misread:** a ceiling decides what you are allowed to say. A floor
decides what you are promised to get back. A tool shipped to projects it cannot observe has no
business doing the first, except where one of the four tests applies.

### Why an aggregate bound is fairer than per-field bounds

One budget over a whole record self-allocates. A project with long risks and few goals gets a
different split from the reverse, automatically, with nobody choosing. Twenty-five per-field caps
impose one fixed allocation on every project that will ever use the tool.

The benefit of a shared pool is called statistical multiplexing gain; the waste from fixed
per-field allocation is called internal fragmentation. The known cost of a shared pool is
starvation, where one greedy field consumes the budget. The resolution, arrived at independently by
Linux control groups and by Kubernetes, is per-item floors plus one aggregate ceiling
([docs.kernel.org](https://docs.kernel.org/admin-guide/cgroup-v2.html)).

### Why the numbers are declared as policy rather than dressed as derivations

Some limits are genuinely derived: PostgreSQL's row limit follows from its page size, and TCP's
segment size is the datagram size minus forty. Most famous ones are not. DynamoDB's 400KB is stated
with no physical justification; MySQL's 65,535 is enforced "regardless of storage engine, even
though the storage engine may be capable of supporting larger rows"
([dev.mysql.com](https://dev.mysql.com/doc/refman/8.0/en/column-count-limit.html)).

Pretending a chosen number is derived is what makes it un-reviewable later. Every number this spec
keeps is recorded as measured, derived, external, or chosen.

### The one number that is not ours to choose

Claude Code, which reads every briefing this tool produces, warns at 10,000 tokens of tool output
and limits at 25,000 ([code.claude.com](https://code.claude.com/docs/en/mcp)). That is the
environment's constraint. Every briefing measured in this thread costs between roughly 500 and
3,000 tokens, comfortably under the warning.

## The changes

Each change has a stable identifier so the implementation plan can reference it.

---

### C1 — Stop rewriting line breaks as `U+000A` in briefing prose

**What specifically.** In the briefing render path, a line break in a stored prose field renders as
a real line break. The escaping that exists to keep stored text from forging Markdown structure
stays; only the newline case changes.

**Intent.** A session summary should read as the paragraphs its author wrote. Today it arrives as
one wall of text studded with escape tokens, and a reader cannot skim it.

**Reasoning.** Two harms, both measured. Each line break costs six characters of a budget the tool
is otherwise fighting to preserve. And the tokens make the verbatim-echo gate unpayable by any
reader who renders them as prose, which is the defect that blocked work three times in the thread
that produced this spec.

**Risk to control.** Escaping exists to stop a stored value forging a heading or a list marker. The
change must permit a line break without permitting a line break followed by structure that would
forge one. This is the one change here that needs a security-shaped test rather than a behaviour
test.

**Ships alone.** Yes. Nothing depends on it, and C10 depends on it.

---

### C2 — Write the stop-gate's completion marker after the check, not before

**What specifically.** The gate that requires the briefing to be echoed records "this session has
been checked" at `src/hooklib/stop-gate.ts:62`, which executes before the early return at `:64` that
fires when there is no briefing to check. Move the write after the check.

**Intent.** A session where the hook fires before a briefing exists should remain unchecked, not
mark itself satisfied having examined nothing.

**Reasoning.** Measured in this thread. The first hook fire landed at 23:37:28.518; the briefing was
produced at 23:37:39.700, eleven seconds later. The marker was written against an empty transcript,
the real echo was never examined for nineteen hours, and a session fork then invalidated the marker
and ran the check for the first time.

**What it amends.** `test/hooks/stop-gate-store-shape.test.ts:39-43` asserts the marker IS written
on a silent verdict. It pins the defect rather than catching it, and must be inverted.

**Ships alone.** Yes.

---

### C3 — Stop silently truncating the stop-hook's own message

**What specifically.** `hooks/lib/io.ts:49` clips the hook's block reason at 10,000 characters using
a helper that appends no marker. Either raise the limit above the briefing budget, or append the
same shortening marker every other surface uses.

**Intent.** A message that demands a text be reproduced exactly must not itself be silently cut.

**Reasoning.** Measured: today's largest live briefing produces a block of 9,695 characters against
that 10,000 limit. Three hundred and five characters of headroom. Crossing it hands the reader a
truncated text and demands exact reproduction, which nothing can satisfy. C10 lengthens briefings,
so C3 ships before it.

**Coverage gap that made this possible.** No test covers this path. Every stop-gate fixture points
at a transcript file that does not exist, at `test/support/stop-gate-fixture.ts:135`,
`test/hooks/stop-gate-store-shape.test.ts:30` and `test/hooks/handoff.test.ts:47`. The fix ships
with a test that writes a real transcript.

**Ships alone.** Yes.

---

### C4 — Delete the dead text copy of the briefing, and update the copy count

**What specifically.** `resume_thread` returns the briefing twice: as plain text and inside the
structured reply. Remove the text copy, and in the same change set
`BRIEFING_COPIES_IN_RESUME_PAYLOAD` at `src/render/briefing.ts:23` from 2 to 1.

**Intent.** Stop paying twice for a copy nothing reads.

**Reasoning.** Measured three ways. Reading real session transcripts shows the client discards the
server's text block and stores only the serialised structured object. Running the full suite with
the text copy emptied gives 979 of 984 passing, with all four real failures in one prompt-injection
test file and none of them asserting that the text block carries the briefing; two fail on their own
control precondition and say so in their own message. The targeted set of payload, resume, briefing
and hook tests is 160 of 160 green.

**The structured copy is mandatory and must not be touched.** The tool declares an output schema,
the protocol requires conforming structured results, and the vendored SDK throws without it at
`node_modules/@modelcontextprotocol/sdk/dist/esm/server/mcp.js:196-206`. Removing it fails 13 tests
across three directories.

**The trap.** `test/contract/resume-payload-envelope.test.ts:119-125` asserts only that the
prediction is not too low. Removing the copy without changing the count leaves it green while the
budget over-predicts by roughly half, silently wasting the space just freed. This is why the two
edits are one change and not two.

**Expected gain, measured.** Roughly 2.7% more briefing, not half. The character and byte ceilings
were tuned to bite within 3% of each other, so removing the doubling hands the binding role to the
character ceiling.

**Ships alone.** Yes.

---

### C5 — Cap each header field at 500 characters after escaping

**What specifically.** Six fields render with no shortening lever: `thread.title`
(`src/render/briefing.ts:361`), `thread.blocked_by` (`:176-177`), `spine.active_goal` (`:373`),
`spine.landed` (`:384`), `spine.next_step` (`:388`), and `spine.last_session` (`:379`, the legacy
path). Cap each at 500 characters measured after escaping.

**Intent.** Bound what escape expansion may cost the page, without bounding what the writer may say.

**Reasoning.** Escaping can turn one stored character into six, so a field that satisfies its
500-character write cap can occupy 3,000 characters of page. Measured: the only known case where a
briefing exceeds its budget is caused entirely by this, and this change fixes it, taking the
breaching fixture from 13,846 characters to 3,146 in a single pass with nothing shortened.

**Cost today: none.** The largest header field on any live thread is 486 characters after escaping.
Plain text at the 500-character write cap escapes to exactly 500. Verified against all seven
readable threads and against a synthetic record with every header field at its cap.

**Why this is a ceiling in a spec that argues for floors.** It caps the escaped length, which is a
cost the page pays, not a limit on what the writer may say. It passes test 2: the breach is real and
binary.

**Rejected alternative, measured.** Giving the header the body's shrink lever is strictly worse: it
shrinks the goal and next step whenever the body forces a small ceiling, for a reason unconnected to
the header. The goal and next step are what tell a reader how important everything else is.

**Ships alone.** Yes.

---

### C6 — Correct the two false claims in the continuity rule document

**What specifically.** `docs/rules/continuity-ledger.md:186-194` states that every size cap refuses
and nothing is shortened, and that the whole-record refusal names no field and no number. Replace
both with what ships.

**Intent.** A rule document that describes behaviour incorrectly teaches every future session
something false.

**Reasoning.** Eight shortening call sites ship. `src/server/tool-support.ts:123` names the heaviest
field, its byte count, the observed total and the cap, and `test/store/whole-record-cap.test.ts:80-119`
asserts all three. The correction was already filed once at
`docs/plans/2026-08-28-continuity-goal-model/FILED.md:283` and never folded in.

**Second location, outside this repository.** The same text is installed as a global rule at
`.windful-ocean/.claude/rules/common/continuity-ledger.md`, loaded into every session on this
machine. That copy has also drifted on three further points. Correcting it requires a pull request
to that repository, which is separate work with its own review.

**Ships alone.** Yes, in two parts.

---

### C7 — Apply the four-test rule to the write-time caps

**What specifically.** Every write-time cap is classified against the four tests. Those that pass
keep their hard refusal, unchanged, at their current value. Those that pass none have their length
limit **removed entirely**, not raised: the field accepts any length, and the only thing that can
refuse it is the whole-record byte cap. "Relaxed" below always means removed, never raised.

**Fields that keep a forcing cap under test 3, because the shortness is the point:**

- `spine.active_goal`, `spine.next_step`, `spine.landed` — a next step that needs 900 characters is
  not yet a decision about what to do next.
- criterion `text` and `check` — one testable statement, one runnable command.
- titles, slugs, scopes, out-of-scope statements — these are labels, and a label that is a paragraph
  is not a label.

**Fields that lose their cap, because no test applies:**

- criterion `result` — this is pasted output. Capping it means pasting less evidence.
- `settled_by` — this field's own description calls it the human's words quoted verbatim. **Capping
  a verbatim quote corrupts the quote.** This is the clearest error in the current design.
- risk `text` — a finding, not a decision.
- decision `context` and `outcome` — reasoning, which is the durable value of a decision record.

**Intent.** Stop the tool making editorial decisions it has no standing to make. A cap that forces a
writer to decide is doing work. A cap on pasted evidence is destroying evidence.

**Reasoning.** The arithmetic in problem 4 shows these caps do not bound the record. Nothing else
they might be doing survives examination: they do not protect the git store, which has its own
subprocess buffer four orders of magnitude away, and they do not keep the briefing renderable, which
the render layer does with its own separate limits.

**What it amends.** `test/unit/caps.test.ts:34-60` asserts an oversized field refuses the whole call
and leaves the prior record byte-identical. Whether it breaks depends on which fields it exercises,
which must be read at implementation time and not assumed.

**Depends on.** Nothing, but it should follow C11 so each relaxation is recorded with a reason as it
happens.

---

### C8 — Bound the separately-stored records explicitly, with stated headroom

**What specifically.** Session log entries and decision records are stored as their own files, not
inside the thread record, so the 64KB record cap does not bound them at all. They keep a bound under
test 4. Raise each with stated headroom over measured reality, and record the basis as chosen policy.

**Intent.** Be honest that these are policy numbers, and set them where a real writer will not hit
them.

**Reasoning.** Measured across 25 entries: session entry bodies run a median of 2,669 characters
against a cap of 8,000, with the largest at 7,814. That is 98% of the ceiling. A real write came 186
characters from being refused.

**A caution about that measurement, which the spec records because it changes how it should be
read.** The sample is selected by the cap. Any writer who needed 12,000 characters split the entry,
trimmed it, or wrote nothing, and appears in the data as a compliant entry or not at all. The 98%
figure is not evidence the cap is nearly right. It is evidence that writers steer to it. No amount
of further sampling fixes this, because a tool cannot detect from its own telemetry that its cap was
too small.

**Therefore.** Do not tune this number by sampling. Set it with generous headroom, record it as
chosen, and let C13 eventually say whether it mattered.

**Who picks it.** This specification deliberately states no number. The implementation plan proposes
one with its arithmetic shown, a human rules on it the way the briefing budget was ruled on, and the
register records that ruling as the reason. A number chosen by an agent and recorded as chosen would
satisfy the register's format while defeating its purpose.

**Depends on.** C11, so the new number ships with its reason.

---

### C9 — Replace the render ceilings with guaranteed floors

**What specifically.** Thirteen hand-written maximum lengths at `src/render/briefing.ts:49-61`
currently cap what each field may show. Delete them as ceilings. Each renderable field instead
declares a floor: **an absolute character count, not a fraction of the budget**, below which that
field is never rendered while any other field is above its own floor.

**When the floors do not all fit.** The floors are a promise the budget may be unable to keep on a
pathological record. In that case the briefing renders every field at its floor, exceeds the budget,
and says so on the page and in the tool's reply. It does not silently ship over budget, which is
today's behaviour and is wrong. The plan states the exact wording; the requirement is that the
reader is told.

**Intent.** The briefing should promise each kind of content a floor it will never fall below,
rather than forbidding it a maximum it may never exceed.

**Reasoning.** Three of the thirteen already diverge from the storage caps they appear to mirror,
and one of those divergences is invisible to any automatic check: `LAST_SESSION_TEXT_NATURAL_MAX` is
500 and equals a constant it has no relationship to, while actually governing a field capped at
8,000. A number that can only be understood by tracing a call chain is not a design, it is an
accident that has not surfaced yet.

**A measured warning that constrains the implementation.** The search range is derived as the
maximum of these thirteen values. Raising any one of them widens the range and increases the number
of full renders. Measured: raising one to 8,000 takes the pinned fixture from 10 renders to 14
against a ceiling of 11, breaking a currently green test. Any change to this family must report its
new render count.

**Depends on.** C11, so the floors ship with recorded reasons rather than as a second generation of
unexplained numbers.

---

### C10 — The session log renders the newest entry whole and older ones as headlines

**What specifically.** Under the "Last session" heading, the newest session entry renders complete.
Every older entry renders as its first line, with its identifier. Nothing is hidden; every entry
still appears.

**What "complete" means when the budget cannot afford it, which C8 makes possible.** C8 raises the
bound on a stored session entry, so a single entry can in principle be larger than the whole
briefing budget. In that case the newest entry is shortened, with the marker, and it is the only
thing on the page that is shortened — every other field stays at or above its floor. The rule is a
priority, not a guarantee: **the newest entry is the last thing shortened, not the thing that can
never be shortened.**

**Intent.** Give the reader one complete account of what just happened, plus a scannable index of
what came before, instead of a list of fragments none of which reaches its point.

**Reasoning.** Measured on the only resumable thread. Today: fourteen entries, every one rendered at
exactly 519 characters, every one cut mid-sentence. The newest entry's third sentence dies at
"compared inlining a whole document against retrieving from it across". Rendered whole instead, that
same entry is 5,344 characters and the page still fits.

**This is an admission rule, not a size rule.** It says what qualifies for full rendering. It is
scale-free: it means the same thing on a three-day project and a three-year one, which no character
count does. Conventions that survived in this shape — changelogs, decision records, commit message
formats, Claude Code's own memory index — all bound what may enter rather than how many bytes it may
occupy.

**Precedent already in this codebase.** `src/server/resource-render.ts:22-23` already renders a
200-character first line per session entry for the sessions resource. This reuses a shipped pattern
rather than inventing one.

**Hard dependency.** C1 ships first. Until line breaks stop becoming escape tokens, an entry has
exactly one line and "first line" means the whole entry.

**What it notably does not require.** No recorded decision and no published promise needs amending.
Decision B16 deleted display-time item caps; this introduces none, because every entry still
renders. LG8 requires that anything left out be counted and addressed; nothing is left out. LG10
promises no ranking of records; entries are already rendered newest-first today, and the roster
already sorts by recency with that explicitly blessed.

**Rejected alternative, measured.** A policy that drops whole low-relevance items when the shrink
ceiling falls below a readable floor was specified, built and measured. It does not earn itself. Its
trigger never fires, because the achieved ceiling is 490 and every candidate floor is below that.
Forced to fire, it removes 48,858 characters of content to free 2,152 characters of page, delivering
one more whole item and 1,349 fewer characters. Six of the seven readable threads already render
completely unshortened, so no policy can improve them.

**A caveat recorded honestly.** The rule used to judge that measurement demanded both more delivered
characters and more whole items. Requiring more characters structurally favours the
shorten-everything policy it was meant to test, because this project's own research says characters
are not the value. The ladder lost on a flawed rule, and it also lost on its trigger, which is the
sounder of the two reasons.

---

### C11 — Build the limits register

**What specifically.** A JSON file under `docs/registers/`. One row per limit, carrying: the name,
the file and line where it is defined, its current value, its basis, its reason, and where it mirrors
another limit, the relationship between them.

**The basis field takes one of five values:** measured, derived, external, chosen, or unrecorded.

**Intent, stated precisely because it has been misread before.** This register has no runtime role
and enforces no behaviour. Its only purpose is that a future reader — a person or a fresh session —
can find out why a number is what it is without an hour of archaeology. A rationale in the source
would be a comment, which this project forbids, so it lives as data in a document.

**Reasoning.** The archaeology is the argument. Of roughly 92 limits, 6 have a written derivation of
their number. Within `src/schema/caps.ts`, 25 of 42 have nothing recorded anywhere: not a commit
body, not a pull request, not a document, not a ledger record. No value in that file has changed
since it was written, which means no value has ever been tested against reality. Exactly one commit
in the entire history names a cap constant, and says only that it exists.

That is not carelessness. It is the predictable result of having nowhere to write the reason down. A
project that forbids comments and has no register has no place for a rationale to live, so the
rationale does not get written, and the next person re-derives it or guesses. This register is that
place.

**The value is recorded and checked.** A test compares each row's value against the live constant.
Changing a cap turns it red until the reason is updated or the change reverted. This is the forcing
function that keeps a reason from drifting away from the number it explains.

**The population comes from a source scan, not from one file's export list.** Deriving it from
`Object.keys(caps)` is the circularity described in problem 3, and is how at least 33 limits
accumulated outside that file while a census claimed completeness.

**Day one.** Roughly sixty rows read `unrecorded` with no reason. That is the correct output, not a
failure: it converts an invisible gap into a visible one. Nobody works through them as a backlog. A
number earns its reason when someone touches it or hits it, and the red test hands them the row.

**Why not make the limits configurable.** Only 2 to 8 percent of configuration options are ever set
by most users, and up to 53 percent of configuration errors come from a wrong default left in place
([cseweb.ucsd.edu](http://cseweb.ucsd.edu/~tixu/papers/fse15.pdf)). A tunable limit with an
unjustified default is worse than a fixed one at the same value, because it manufactures the
appearance that someone chose it. There is also a hazard specific to this tool: two people sharing
one git-backed ledger could set different limits and write records the other's briefing cannot
render.

---

### C12 — Make a duplicated number impossible, or make it loud

**What specifically.** For each of the sites that restate a number defined elsewhere, apply one of
two treatments.

**Compute it, where the two numbers can never legitimately differ.** The slug pattern's length bound
at `src/schema/ids.ts:2` is built from the slug length constant rather than typed. The identifier
length that currently exists in five hand-written copies is imported from one place. Every number
appearing in a tool description is interpolated from its constant.

**Audit it, where they may legitimately differ.** The render floors that correspond to storage caps
carry a written relationship, and a test asserts the relationship rather than equality.

**Intent.** A number that exists in one place cannot drift. A number that must exist in two places
should fail loudly when they disagree.

**Reasoning.** Sixteen sites drift silently today. The pattern already exists in this codebase: the
shortening marker's length is computed from the marker string rather than typed as 14.

**One instance that only a person can catch.** A render constant at `src/render/briefing.ts:50` is
dead for its apparent purpose — the code that appears to use it actually imports the real constant —
yet it is still referenced elsewhere, so no reachability check finds it, and its value equals the
constant that replaced it, so no equal-value check finds it. It surfaces only when someone tries to
write an honest reason for it and cannot. That is the register earning its place.

---

### C13 — Record whether a session had to go back

**What specifically.** After a briefing is consumed, record when the session re-reads a file it has
already read, or repeats a search with unchanged arguments.

**Where it is recorded.** To the same local hook-event log this project already writes, not to the
ledger. The ledger is a record of decisions and work, read by people and by future sessions; this is
telemetry about the tool's own effectiveness and does not belong in a briefing. It is also
per-machine and disposable, which the ledger is not.

**Intent.** Answer the only question that decides whether any of these limits help: did the reader
have enough? Size is the wrong instrument for that and no amount of thread data substitutes for it.

**Reasoning.** Nothing standardised measures this. The industry's observability conventions for AI
agents define spans for tools, agents, retrieval and planning plus token counts, and no attribute for
sufficiency, completeness, repeated calls, or re-derivation. The two instruments that do measure
sufficiency each require something a prior-work summary lacks: a question to judge against, or a
ground-truth reference. Repeated reads require neither.

**Why last.** Everything before it is worth doing on its own evidence. This tells you, over time,
whether it was enough.

## What this specification deliberately does not do

Recorded so a later reader does not re-propose them.

| Not doing | Why |
|---|---|
| The budget-triggered drop ladder | Built and measured. Its trigger never fires; forced, it delivers fewer characters than doing nothing |
| Raising the session-entry render ceiling | Measured. Changes not one character, because the search settles below the existing ceiling, and it breaks a green test |
| Making any limit user-configurable | Evidence against, plus a shared-ledger hazard specific to this tool |
| Budgeting in tokens rather than characters | Characters are accurate to roughly 10 percent on today's threads and every briefing is well under the consumer's warning threshold. Revisit if identifier density rises |
| Linking the next step to a goal identifier | A real option with real value, and its own decision. It was built once and removed for reasons that a different shape would answer, which is a separate conversation |
| Reordering the briefing's sections | Two byte-exact tests pin the current order, and nothing here needs it changed |

## What this amends or breaks

| Item | Location | Effect |
|---|---|---|
| Two false behaviour claims | `docs/rules/continuity-ledger.md:186-194` | Corrected by C6 |
| The same two claims | A global rule in another repository | Corrected by C6, via a separate pull request |
| The stop-gate marker test | `test/hooks/stop-gate-store-shape.test.ts:39-43` | Inverted by C2; it currently pins the defect |
| The render pass ceiling | `test/unit/briefing.test.ts:842` | Re-pinned by C9 if the search range changes; must be reported, not assumed |
| The refuse-whole-call test | `test/unit/caps.test.ts:34-60` | Possibly amended by C7, depending on which fields it exercises. Read it, do not assume |
| The payload prediction test | `test/contract/resume-payload-envelope.test.ts:119-125` | Not broken by C4, which is the danger. It is one-directional and stays green while wrong |

**Not amended, and this is worth stating.** Decisions B16, B17, B19 and B20, and published promises
LG8 and LG10, all survive unchanged. C10 hides nothing, introduces no item cap, and reorders nothing
that was not already ordered. An earlier design would have needed three of these reopened; this one
needs none.

## Evidence

**Measured in the thread that produced this spec.** All render measurements come from a harness
proved byte-identical to the shipped renderer on all eight cases before any measurement was taken.
The live store was copied and read; it was never written. Every command is recorded in the thread's
session log.

**Numbers that will go stale.** The live store grows. Every per-thread figure here is a sample taken
at a stated time, not a constant. Notably, the open thread rendered 18,794 characters unshortened
early in the session and 58,807 by the end, because the session's own record-keeping filled it.

**External claims.** Each is cited inline above. Where the research does not settle a question, this
document says so rather than choosing. The largest such gap: nobody has compared a bounded summary
of prior work against an unbounded one. The question this whole specification answers has not been
run by anyone.

## The one finding that governs everything above

Deferring content pays only when something judges whether what it has is sufficient and escalates on
that judgment. A system that asks "is this enough?" before fetching matched full-context accuracy at
38 to 61 percent of the cost ([arxiv.org](https://arxiv.org/abs/2407.16833)). A system that simply
truncates and leaves an address takes the cost of deferral without the mechanism that makes it pay.

That is why C10 renders a complete newest entry and scannable headlines rather than a count and a
pointer, and why C13 exists at all.
