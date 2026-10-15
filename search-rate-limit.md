# search-rate-limit: Per-IP rate limiting for the public search endpoint
Status: abandoned: abandoned in the old ledger
Updated: 2026-10-15T19:18:59.811Z
Next ids: c5 D2 R2 S1

## Goal

The public search endpoint holds one budget per address that survives a restart and does not multiply behind more than one instance. Config and the 429 path are done; the Redis bucket is written but racy, and restart safety is blocked behind it.

## Done when

- [x] c1 A burst above the limit from one address is rejected with 429 and a Retry-After header naming whole seconds. evidence: npm test -- test/ratelimit/burst.test.ts exit 0, 7 pass 0 fail. Retry-After asserted as whole seconds against a skewed client clock.
- [ ] c2 Two distinct addresses never share a budget.
- [ ] c3 A restart never lets a currently-blocked address through early.
- [x] c4 The limit and the window are configuration validated at startup, never constants. evidence: npm test -- test/config/ratelimit-config.test.ts exit 0, 11 pass 0 fail. Startup refuses a non-integer and any value below 1, and the refusal names the variable.

## Where things stand

Criteria 1 and 4 are done and verified: the 429 path with whole-second Retry-After (burst test 7 pass, 0 fail) and startup config validation (config test 11 pass, 0 fail). The storage decision is locked to a Redis token bucket. Task 2's bucket is written but racy, and its concurrency harness is red.

## Next step

Replace the three-round-trip read-modify-write in the token bucket with a single Lua script so the whole update is one atomic Redis call, then run the concurrency harness in loadtest.md and watch it go red to green. Only once that is green, write the restart test for criterion 3; over a racy bucket it cannot tell a restart failure from a concurrency one.

## Decisions in force

- D1 The budget lives in Redis as a token bucket, not in process memory: Redis token bucket keyed by address. It survives a restart because the bucket is not in the process, and it holds one budget per address across every instance. Sticky routing was rejected because it makes the limit correct only while routing is healthy, and a rebalance silently doubles the effective limit with nothing failing loudly.

## Open risks

- R1 The token bucket read-modify-write is three Redis round trips, so two simultaneous requests from one address can both observe the last token and both consume it. The limit is exceeded under concurrency and the burst test does not catch it because it fires sequentially. Bears on c2.

## Settled, do not reopen

## Where the details live

- the spec, invariants I1-I4 and rulings H1-H2: /private/tmp/claude-501/-Users-satanshumishra-Documents-DevLabs-logbook/94ea6323-e3a2-4b72-8600-1b4d2f8604a2/scratchpad/ratelimit/SPEC.md
- the implementation plan, tasks 1-4: /private/tmp/claude-501/-Users-satanshumishra-Documents-DevLabs-logbook/94ea6323-e3a2-4b72-8600-1b4d2f8604a2/scratchpad/ratelimit/PLAN.md
- concurrency harness, currently red: /private/tmp/claude-501/-Users-satanshumishra-Documents-DevLabs-logbook/94ea6323-e3a2-4b72-8600-1b4d2f8604a2/scratchpad/ratelimit/loadtest.md
- Old ledger record: thread 01M1TS2R00D433GDNSG8CPQTTA in refs/logbook/archive/ledger
