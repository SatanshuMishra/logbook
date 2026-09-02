# Making `main` require its CI checks

This repository's default branch, `main`, has a continuous-integration (CI) workflow that runs
on every push to it, but nothing today stops a broken push from landing. This runbook is for a
human with repository-admin rights on `SatanshuMishra/logbook` to close that gap. No step in this
document is performed by an agent; every `gh api` command below is written for a human to paste
into a terminal after reading it.

## 1. Measured current state (2026-09-01)

Three read-only `GET` requests were run against `SatanshuMishra/logbook` on 2026-09-01, and all
three came back with a repository that has no branch protection and no rulesets at all.

```
gh api repos/SatanshuMishra/logbook/branches/main/protection
```
returned:
```
{"message":"Branch not protected", ... "status":"404"}
```

```
gh api repos/SatanshuMishra/logbook/rulesets
```
returned:
```
[]
```

```
gh api repos/SatanshuMishra/logbook/rules/branches/main
```
returned:
```
[]
```

These are positive answers describing the repository's actual configuration, not access
failures or rate limits. `main` carries no required status check today.

## 2. The check names a human must mark required

`.github/workflows/rebuild.yml` is a single workflow named `ci` with an `on: push: branches:
[main]` trigger, so it is the workflow whose jobs are candidates for "required status checks" on
`main`. GitHub reports each job to the status-checks API and UI under a check name equal to the
job id, or, for a job built from a `strategy.matrix`, the job id followed by the matrix values in
parentheses. Reading `.github/workflows/rebuild.yml` job by job:

| Job id in the workflow file | Has a matrix | Check name(s) GitHub reports |
|---|---|---|
| `typecheck` | no | `typecheck` |
| `test` | yes, one axis: `node-version: ['22.19.x', '24.x', '26.x']` | `test (22.19.x)`, `test (24.x)`, `test (26.x)` |
| `coverage` | no | `coverage` |
| `mutation` | no | `mutation` |
| `inspector` | no | `inspector` |
| `seeded-mutation` | no | `seeded-mutation` |

None of the six jobs sets an explicit `name:` field, so the check name is the bare job id (with
the matrix suffix where one applies); this table was built by reading the job ids and the
`strategy.matrix` block directly out of the workflow file, not guessed.

One caveat that changes which jobs are safe to mark required for the push-to-main case this
runbook is about: the `mutation` job carries `if: github.event_name == 'pull_request'`, so on a
plain push to `main` (as opposed to a pull request), that job does not run at all and reports no
check. A required status check that a push event never produces blocks every future push to
`main` from ever becoming mergeable-clean, because GitHub is left waiting on a check that will
never arrive for that event type. Do not mark `mutation` as a required check for the push-to-main
protection this runbook sets up; the other five jobs (`typecheck`, `test`, `coverage`,
`inspector`, `seeded-mutation`) do run on every push to `main`, and because `test` alone reports
three check names, those five jobs together produce seven check names (`typecheck`,
`test (22.19.x)`, `test (24.x)`, `test (26.x)`, `coverage`, `inspector`, `seeded-mutation`) that
are safe candidates.

## 3. Two ways to make a check required — pick one

The repository has neither a classic branch-protection rule nor a ruleset today (see section 1),
so either of these is a fresh setup, not an edit of something existing.

### Option A: classic branch protection

**UI path:** repository page -> `Settings` -> `Branches` (left sidebar, under "Code and
automation") -> `Add branch protection rule` -> in "Branch name pattern" enter `main` -> check
"Require status checks to pass before merging" -> in the search box that appears, add each check
name from the table above (skip `mutation`, per the caveat) -> `Create` (or `Save changes` if a
rule for `main` already exists by the time you read this).

**`gh api` command (for a human to run; do not run this from an agent):**

```
gh api --method PUT repos/SatanshuMishra/logbook/branches/main/protection \
  -H "Accept: application/vnd.github+json" \
  --input - <<'JSON'
{
  "required_status_checks": {
    "strict": true,
    "contexts": [
      "typecheck",
      "test (22.19.x)",
      "test (24.x)",
      "test (26.x)",
      "coverage",
      "inspector",
      "seeded-mutation"
    ]
  },
  "enforce_admins": null,
  "required_pull_request_reviews": null,
  "restrictions": null
}
JSON
```

The classic protection endpoint requires the whole configuration in one `PUT`, so the three
`null` fields above (`enforce_admins`, `required_pull_request_reviews`, `restrictions`) are left
unset deliberately; decide those separately from this runbook and fill them in before running the
command if you want them enabled. `required_pull_request_reviews` and `restrictions` are
unrelated to required status checks, and this runbook does not recommend a value for either.
`enforce_admins` is not unrelated: it is the field deciding whether the required status checks
configured above bind repository administrators at all. Left `null` (GitHub treats this the same
as `false`), a repository administrator can still push straight to `main` past a failing required
check, exactly as if this runbook had never been applied for that one class of user. Only setting
`enforce_admins: true` makes the required checks block administrators too.

### Option B: rulesets (the newer, repo-settings replacement for classic protection)

**UI path:** repository page -> `Settings` -> `Rules` -> `Rulesets` (left sidebar) -> `New branch
ruleset` -> give it a name (for example `main-required-status-checks`) -> set "Enforcement
status" to `Active` -> under "Target branches" click `Add target` -> `Include default branch` (or
add `main` explicitly) -> under "Branch rules" check "Require status checks to pass" -> `Add
checks` and add each of the seven check names from the table above except `mutation` -> `Create`.

**`gh api` command (for a human to run; do not run this from an agent):**

```
gh api --method POST repos/SatanshuMishra/logbook/rulesets \
  -H "Accept: application/vnd.github+json" \
  --input - <<'JSON'
{
  "name": "main-required-status-checks",
  "target": "branch",
  "enforcement": "active",
  "conditions": {
    "ref_name": {
      "include": ["refs/heads/main"],
      "exclude": []
    }
  },
  "rules": [
    {
      "type": "required_status_checks",
      "parameters": {
        "strict_required_status_checks_policy": true,
        "required_status_checks": [
          { "context": "typecheck" },
          { "context": "test (22.19.x)" },
          { "context": "test (24.x)" },
          { "context": "test (26.x)" },
          { "context": "coverage" },
          { "context": "inspector" },
          { "context": "seeded-mutation" }
        ]
      }
    }
  ]
}
JSON
```

`[unverified]` the exact field names inside `rules[].parameters` for the rulesets API
(`strict_required_status_checks_policy`, `required_status_checks[].context`) could not be
confirmed against GitHub's current REST API reference during this session, because no
documentation-fetch tool was available; confirm the current schema against GitHub's own
"Repository Rulesets" REST API documentation before running this command, and adjust field names
if the current API has changed them.

## 4. Until a human does one of these, nothing is enforced

Today, with neither branch protection nor a ruleset in place on `main`, the `push`-triggered jobs
in `.github/workflows/rebuild.yml` run and report their pass/fail state, but nothing reads that
state to block anything. A push straight to `main` that fails every one of `typecheck`, `test`,
`coverage`, `inspector` and `seeded-mutation` still lands on `main` exactly as if CI had never
run. Section 3 is what turns "runs and reports" into "runs and blocks."

## 5. Verifying afterward

Run the same three read-only `GET` requests from section 1 again.

```
gh api repos/SatanshuMishra/logbook/branches/main/protection
```
Before either option is applied this returns `{"message":"Branch not protected", ...}`.
After option A (classic branch protection) is applied, this instead returns a JSON object whose
`required_status_checks.contexts` array lists the check names configured in section 3, for
example `{"url": "...", "required_status_checks": {"strict": true, "contexts": ["typecheck",
"test (22.19.x)", ...]}, ...}`. Option B (rulesets) does not populate this classic-protection
endpoint at all; it stays at `{"message":"Branch not protected", ...}` even after a ruleset is
active, because rulesets and classic branch protection are two independent GitHub features
answered by two different endpoints.

```
gh api repos/SatanshuMishra/logbook/rulesets
```
Before option B this returns `[]`. After option B this returns a non-empty array containing the
ruleset just created, for example `[{"id": <number>, "name": "main-required-status-checks",
"target": "branch", "source_type": "Repository", "enforcement": "active", ...}]`. Option A
(classic branch protection) does not populate this endpoint; it stays `[]` even after classic
protection is configured.

```
gh api repos/SatanshuMishra/logbook/rules/branches/main
```
Before either option this returns `[]`. This endpoint reports the rules actually in effect on
`main` from every source (rulesets and classic branch protection both), so after either option A
or option B is correctly applied, this returns a non-empty array that includes an entry whose
`"type"` is `"required_status_check"` (one entry per required check), naming the check contexts
configured above. An empty array here after applying either option means the configuration did
not take effect and the previous steps should be re-checked.
