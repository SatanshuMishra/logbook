# New material — becomes thread criteria, never folded into a unit

Work established during planning that the approved SPEC does not cover. Each item is carried as its
own completion criterion on thread `01M130AYZYVWAGDKGHJX9AXPFG`, with its own decision record where
one is needed. Nothing here is absorbed into a unit's acceptance ceiling.

The register exists because "acceptance is a ceiling" is only honest if the overflow lands somewhere
durable. A discovery with no home is a discovery that gets quietly folded in.

## N1 — The third store race, on the ordinary success path

A record committed to the ledger ref and durably written by its own writer is erased when another
process swaps `records/` for an older snapshot, and `markMaterialised` then stamps the store at the
whole new ref so `syncWorkingCopy` short-circuits forever and never repairs the hole. Reproduced at
46 of 60 iterations under 24 concurrent writers, with the stamp equal to the ref in every failing
case. Filed as `F0a`; ruled above the ceiling by `OR18` ruling 4.

**Not** either race the SPEC accepted: `01M13F4HW3YQWJSF7T4GM47GP8` names a post-CAS `mkdirSync`
producing `ENOTEMPTY`, and `01M13F4HW3552M57R3SZ4B5V5P` names the CAS *retry* path adopting the
winner's ref. This needs no retry by any process.

Sites: `src/store/write-path.ts:149-160`, `src/store/records.ts:171`, `src/store/read-path.ts:204`,
`src/store/read-path.ts:110-151`.

## N2 — `main` has no required status checks

`gh api repos/:owner/:repo/branches/main/protection` returns `404 Branch not protected`; both
`/rulesets` and `/rules/branches/main` return `[]`. Positive answers, not access failures. The CI on
push that `U0` adds therefore observes and blocks nothing. Filed as `F0b`. Adding protection is a
repository-administration act no unit performs.

## N3 — `receipts.yml` pins mutable action tags while `rebuild.yml` pins shas

Filed as `F0c`. A supply-chain inconsistency between two workflow files in one repository; the
stricter of the two is already the local convention.

## N4 — `LG5` is not fully discharged while the write path escapes before storing

`escapeStored` is called on caller-supplied text before the value is committed in ten modules, and
the renderer escapes again at read time, so the write-time pass buys no rendering safety the
read-time pass does not already provide. Fully discharging `LG5` means the stored bytes equal the
supplied bytes, which means moving escaping off the write path — ten modules, spanning units `U4`,
`U8` and `U9`. `B43` asks for the inverse, not the relocation. Filed as `F10b`; ruled by `OR22`.

Sites: `src/domain/spine.ts:188-207`, `src/domain/criteria.ts:144,190`,
`src/server/tools/open_thread.ts:99,104`, `record_decision.ts:156-178`, `park_thread.ts:247`,
`update_thread.ts:254`, `log_session_event.ts:84,89`, `close_thread.ts:92`, `bind_branch.ts:78`,
`resolve_conflict.ts:343-382`.

## N5 — The encoding is not injective, and the README says so

`escapeStored` is idempotent and therefore provably not injective; 263 code points can collide with
their own escaped form. Filed as `F10a`; ruled by `OR22`. The near-term obligation is on `U3` — the
README publishes `LG5` with its exception. The durable obligation is `N4`.

**Read this correctly, because the obvious misreading is the opposite of the truth.** No individual
transform is lossy. Measured against the shipped encoder on Node `v26.4.0` / Unicode 17.0: 263
emitted code points, 1315 samples, **0 irreversible** — `\n` becomes `U+000A` and becomes `\n` again.
`D12` reads as though the line-break rewrite destroys structure; it does not. `D12`'s real defect is
its second clause, that no inverse existed anywhere in the codebase, and `U10` closes that by writing
one. What remains broken is the SCHEME, not any transform in it: two distinct inputs can share one
stored form, so the inverse is correct on every value it is given and still cannot recover which of
the two was written. `B43`'s refusal clause therefore has an empty subject and `U10` authors no
refusal.

## N6 — `receipts.config.json` leaves the gates the standard requires explicit at their defaults

Measured during gate zero: no gate is explicitly set to `block` anywhere in the file. `G11` (deleted,
skipped or focused tests) and `G14` (the mutation referee) sit at their `warn` defaults; `G13` and
its coverage command are absent entirely, so it does not run; `claim.require_receipt_for` is absent,
so a feature pull request with no issue link is never asked for a receipt; `verify.receipt_runs` is
absent and therefore 1, against a suite with a live 5% flake. Two internal disagreements:
`gates.G8.integration_branch` is `"integration"` while `build.integration_branch` is `"main"`, and
`"$schema"` names `receipts.config.schema.json`, which does not exist.

This ladder deletes a great deal of code (`B12`, `B16`, `B18`, `B33`), which is exactly the surface
`G11` guards. Above every unit's ceiling; carried here.

## N7 — Removing the display caps pushes real briefings past the whole-briefing budget

Measured by `U5` while planning: after the display-time item caps are deleted, a near-maximal thread
record renders to **26,834 characters / 55,130 bytes**, and **227 of 733 swept records** render past
the budget. The budget and its clip search are deliberately untouched by `B16`, so those briefings
are clipped rather than truncated silently — the marker, the count and the address all render, which
is `LG8` and `LG9` holding.

That is correct behaviour, not a defect, and `U5` handles it inside its ceiling. What is NEW is the
question nobody has answered: **whether the budget is still the right number once nothing is hidden
behind it.** Caps and budget were two filters in series; removing one changes what the other is for.
Deciding that needs a measurement of how much of a clipped briefing a reader actually loses, which
does not exist.

Related and unresolved: `U1` measured the largest live thread record at 39,079 **bytes**, but a byte
size is not a render, and `P7` forbade `U5` from rendering the live store to find out. So whether
today's largest real record fits is genuinely unknown.

## N8 — One read of `Criterion.ordinal` survives the ladder, and nothing owns it

`S3` forbids reading `Criterion.ordinal` for anything but a display label or a display stable-sort.
`U5`'s tree-wide census (`OR29`) found ten reads and three forbidden ones. Two are in `deriveScope`
at `src/server/tools/record_decision.ts:57` and are deleted by `B12` in `U9`, which is also obliged
to widen the blocking assertion once they are gone.

**The third survives: `src/domain/criterion-backfill.ts:11`**, which infers a criterion's attachment
from its ordinal. It is not dead code — `scripts/backfill-criterion-id.mjs:5,22` imports and calls it,
a fact an `src/`-only sweep missed and `F5d` corrects. No unit in this ladder owns the file.

So the question is ownership, not technique: does a maintenance script that infers attachment from
position still have a job once attachment is declared (`B1`, `B11`), and if it does, what should it
read instead? Deleting it blind would break a caller; leaving it leaves `S3` permanently
part-asserted with a standing excuse.

## N9 — Two tools still write `last_session` by hand after it becomes derived

`DG6` says store by hand only what cannot be derived from records already written. `B14` and `B23`
stop `park_thread` accepting the field and derive it from the thread's own session log entries
instead. But `U8` established that two other paths still write it: `update_thread`
(`src/server/tools/update_thread.ts:54-58,237,243-246`) and `resolve_conflict` (`:399-400`). Filed as
`F8a`.

`update_thread`'s acceptance is load-bearing for now — the legacy-fallback receipt depends on it, so
removing it in this ladder would remove the ability to prove the fallback works. `resolve_conflict`'s
is a repair path.

So the question is not "delete them" but: once the derivation is shipped and proven, what should
either path do with a hand-written value that now competes with a derived one? Two sources for one
rendered field is exactly the drift `DG6` exists to prevent, and the ladder ends with two.

Related, and filed alongside: `F8b` the thread resource still shows the legacy field; `F8c` a session
entry carries no session id, which is why the previous session has to be inferred at all; `F8d` a
quarantined entry is dropped uncounted, which `LG8` would ordinarily forbid.

## N10 — `S4`'s wording overstates what the system does, and the SPEC cannot be edited to fix it

`S4` reads "Every write tool succeeds when no pointer exists and when a foreign session holds one."
`park_thread` refuses in the foreign-pointer case when an `outcome` is supplied
(`src/server/tools/park_thread.ts:370`), and a shipped test pins that refusal — deliberately, because
silently parking over another session's pointer would lose that session's outcome text.

So the invariant as worded is false of a system that is behaving correctly. `U9` discharges the true
reading (`OR33`), and the residue is editorial: a future SPEC revision states `S4` with its argument
qualifier, so that the written invariant and the enforced one are the same statement. Filed as `F9a`.

Nothing is broken today. What is unresolved is that a reader of the SPEC would conclude something
about `park_thread` that is not so.

## N11 — An absent decision scope renders as empty brackets

`src/server/resource-render.ts:50-51` renders every spine key decision with `[${scope}]`, and
`KeyDecision.scope` carries no `.min(1)`, so an absent scope stores as the empty string and renders
`[]`. `B12` requires an omitted scope to be "stored absent and reported absent"; the tool response
does report `scope: null`, but this surface shows an empty bracket pair rather than omitting it.
Filed as `F9b`. Above both `U9`'s and `U6`'s ceilings.

## N12 — Nothing enforces that a published optional argument does anything

`A6`'s census drives each optional argument omitted and supplied, and diffs the results, which
catches a value the caller never supplied appearing anyway — the SPEC's actual clause. It does not
catch the opposite: an argument published in the schema whose write is missing. Measured by `U9`
against its own census: reverting `B11`'s `criterion_id` write reddened no census assertion, and only
a dedicated behavioural test caught it. Filed as `F9d`.

Today every such argument happens to have its own behavioural test. Nothing requires the next one to.
Widening `A6` here would be promoting a finding into a verification mandate, so it is carried as work
rather than invented as a rule.
