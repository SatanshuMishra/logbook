# budget-caps-architecture: Budget caps: explore the current architecture
Status: done
Updated: 2026-10-15T19:18:59.811Z
Next ids: c5 D2 R1 S1

## Goal

Understand how budget caps work across Logbook and whether they are the right shape. This spans at least the caps on stored records and session entries, the separate rendering budget the preflight briefing spends across risks, out of scope and its other sections, and how those two kinds of limit interact. Exploratory: completion criteria are owed once the shape of the problem is known.

## Done when

- [x] c1 The cap and budget architecture is broken down end to end: every enforced limit named with its value, its enforcement site, what a person is writing when they hit it, and whether its number has a recorded reason. The write-time caps and the render budget are treated as two separate families, and what each was actually built for is stated rather than assumed. evidence: This thread's session log carries the breakdown across seven entries. Inventory: 42 constants in src/schema/caps.ts with value, enforcement site and what a writer is typing when they hit each; at least 33 further named limits outside that file. Enforcement traced to path and line throughout. Archaeology: 6 of roughly 92 limits have a recorded derivation of their number, 17 a reason the limit exists but not its size, roughly 60 nothing; within caps.ts 25 of 42 have nothing. Origin recorded from docs/specs/2026-08-26-briefing-scoping-repair.md:7-23 as a 113,073-character briefing of which 78.7 percent was inlined decision bodies, and separately that the write-time caps were introduced for durability rather than size. The two families are treated separately throughout. Not observed: three sweeps disagreed on the total population, and that disagreement is recorded rather than resolved.
- [x] c2 Industry practice and the research literature are searched for what is actually known about bounding context for a machine reader, and every finding that supports or contradicts the current design is recorded, including the negatives where the evidence does not settle a question. evidence: Two research passes are recorded in this thread's session log, each external claim carrying a verifiable source URL inline and each labelled by epistemic status as measured, vendor claim, common practice or opinion. Findings that contradict the current design are recorded, including that the measured wins from trimming agent context come from removing redundant rather than late content, and that deferral pays only when a sufficiency judgment gates it. Findings that support it are recorded too, including that length costs accuracy even when every added token is relevant. Negatives are recorded rather than omitted, the largest being that nobody has compared a bounded prior-work summary against an unbounded one, which is the exact question this thread asks. Not observed: no cited source was independently replicated; each is reported at the confidence its own method supports.
- [x] c3 A specification states each recommended change, the problem it solves, the evidence behind it, and every existing ruling, published promise or test it amends or breaks. Where a recommendation contradicts a recorded decision, the specification argues against that decision's stated reason rather than only its wording. evidence: docs/specs/2026-09-09-cap-and-budget-architecture.md exists on branch docs/cap-and-budget-architecture-spec at commit b3b3794 (amended), 618 lines. Structural check run: 13 changes each carrying a stable identifier, an Intent block and a Reasoning block; the awk pass over C-sections lists none lacking either. Both required tables are present: What this amends or breaks, naming six items with their locations and effects, and What this specification deliberately does not do, naming six rejected options with their reasons. Placeholder scan for TBD, TODO, FIXME and XXX returns zero. Self-review found and fixed five ambiguities inline, including a genuine conflict where C8 raises the stored session-entry bound while C10 renders the newest entry whole, which together could exceed the budget; C10 now states that the newest entry is the last thing shortened rather than the thing that can never be shortened. Not observed: a human has not yet reviewed the spec for accuracy or completeness.
- [x] c4 An implementation plan decomposes the specification into minimum shippable products, each of which leaves the application working on merge and is independently revertible, ordered so that a fix nothing depends on ships before a change that others build on. evidence: docs/plans/2026-09-09-cap-and-budget-architecture.md exists at commit 65aa966, 851 lines. Structural check run: 10 shippable units, 10 stating what ships, 10 stating what proves it, 10 stating why merging that unit alone does not break the application, 10 opening their pull request through the centralized pr-create tool. Placeholder scan for TBD, TODO and FIXME returns zero. Self-review found and fixed three gaps inline: MSP 8 and MSP 10 had no pull-request block where the other eight did, and no unit carried an explicit proof statement at unit level. Spec coverage verified by hand: every change C1 through C13 maps to a named task and no task implements anything the spec does not state. One deliberate stop is recorded rather than hidden, at task 7.2, where the plan computes a proposal and halts for a human ruling instead of choosing a cap value itself. Not observed: no task has been executed, so no claim here is about working code.

## Where things stand

Converted from the old ledger.

## Next step

Nothing further is owed on this thread; all four criteria are met and recorded. Implementation moves to a successor thread carrying the plan. The first action there is MSP 1, task 1.1: read src/hooklib/stop-gate.ts:56-72 in full, confirm the gate state is written before the early return taken when no briefing is found, then write the four-event acceptance test at test/hooks/stop-gate-latch-order.test.ts whose fourth assertion fails today.

## Decisions in force

- D1 The exploratory thread closes on four criteria: break down, research, specify, plan: Four criteria, kept on one thread. The first two are already met by this session and are recorded as such by the evidence in the session log. The third and fourth are the remaining work. Keeping them on one thread rather than splitting means the spec is written against the evidence that produced it rather than against a summary of it, which is the failure this project has already hit once when a finding was filed above the ceiling of the unit that found it and never folded back in. Each criterion is checked by an observable artifact rather than by an assertion: a session log carrying citations, source URLs on every external claim, a spec file naming the rulings it amends, and a plan file where every shippable unit states why merging it alone does not break the application.U+003C/outcome>U+000AU+003Cparameter name="scope">definition of done for the whole thread

## Open risks

## Settled, do not reopen

## Where the details live

- the cap constants and their values: src/schema/caps.ts
- the briefing renderer and its rendering budget: src/render/briefing.ts
- the census classifying every cap constant by role: test/unit/caps-census.test.ts
- the whole-record cap whose refusal names no field: src/schema/thread.ts
- Old ledger record: thread 01M21N6HRVE8TK710EX6SY4065 in refs/logbook/archive/ledger
