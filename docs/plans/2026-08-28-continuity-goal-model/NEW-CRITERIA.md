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
