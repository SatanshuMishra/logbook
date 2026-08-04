import openThread from '../../src/tools/open-thread.mjs';
import updateThread from '../../src/tools/update-thread.mjs';
import recordDecision from '../../src/tools/record-decision.mjs';

const CRITERIA = [
  { text: 'criterion identity: ids, kind, struck_by, schema v2 and the read-time upcast' },
  { text: 'scoped items: scope defaults, per-scope caps and the two update_thread gates' },
  { text: 'server-rendered briefing: selection, renderer, pledge and the verbatim gate' },
  { text: 'amendments: amend_criteria, detour rules and struck rendering' },
  { text: 'drift and progress surfaces: snapshot, since-you-left and index counts' },
  { text: 'measure the whole tool response against the acceptance budget' },
  { text: 'chase the flaky worktree teardown that strands a lock file', kind: 'detour' },
];

const CURRENT_SCOPE = 'c3';

const CURRENT_DECISIONS = [
  ['server-renders', 'the server owns every heading and separator so the format cannot drift between runs'],
  ['string-only-payload', 'ship the rendered string alone; a sidecar object would undo the reduction'],
  ['verbatim-pledge', 'pledge the rendered text so a reworded echo blocks from the stop hook'],
  ['fail-open-guard', 'fail the verbatim guard open on an unreadable transcript, never closed'],
];

const AGED_SCOPES = ['c1', 'c2', 'c4', 'c5', 'c6', 'legacy'];

const AGED_TITLES = [
  'keep the ledger in git refs so a clone carries its own continuity',
  'run every ledger git call in a scope that disables ambient hooks and fsmonitor',
  'write every ledger file through a temp file and an atomic rename',
  'key the non-git data directory by a normalized project key',
  'freeze the tool surface so a skill cannot depend on an unreviewed tool',
  'allocate criterion ids from the maximum suffix so a strike never reuses one',
  'retain struck criteria in the array and mark them rather than deleting them',
  'default an omitted scope to the criterion current after this call own toggles',
  'refuse the legacy scope on every write path so only the upcast can set it',
  'cap open risks per scope group rather than per thread',
  'keep detours out of the done over total fraction so progress stays honest',
];

const RISKS = [
  [CURRENT_SCOPE, 'rerun the stop-hook suite after touching the transcript parser — a guard that fails closed bricks every session it cannot read', ['0011-verbatim-pledge']],
  [CURRENT_SCOPE, 'keep index/briefing.json out of the committed ledger — it is session state, not continuity', []],
  ['thread', 'never edit the vendored sdk under node_modules — upgrades are managed upstream and a local patch is silently lost', []],
  ['thread', 'hold the green-branch invariant on every merge — a red integration tip blocks every other unit in flight', []],
  ['c1', 'run the v1 upcast against a copy of the ledger first — a partially upcast ledger is not reversible in place', []],
  ['c1', 'do not throw from the upcast on an over-cap legacy scalar — caps are a write-time gate, not a read-time one', []],
  ['c1', 'check every criterion id against the stored array before toggling — a positional match silently marks the wrong step', []],
  ['c2', 'assert the per-scope risk cap on the merged spine, not on the patch — a patch alone cannot see the stored groups', []],
  ['c2', 'keep the two-clause risk gate off the stored record — a migrated legacy risk must survive a re-read', []],
  ['c2', 'measure the out-of-scope dedup on normalized text — punctuation differences hide a restated decision title', []],
  ['c4', 'roll amend_criteria back as a whole on a mid-array failure — a half-applied amendment leaves ids unallocated', []],
  ['c4', 'refuse a detour on a detour — nesting has no rendering and no closure rule', []],
  ['c5', 'clear only the briefed thread from the drift snapshot — clearing the file drops every other thread signal', []],
  ['c5', 'recompute drift after a reattach — a stale binding reports a phantom branch that no longer exists', []],
  ['c6', 'measure the whole tool response, not the rendered string — a filtered string beside an unfiltered object is not a reduction', []],
  ['c6', 'hold the regression floor at the recorded test count — anything below it is a regression, not a rewrite', []],
];

const OUT_OF_SCOPE = [
  'renaming internals to aviation terms',
  'a separate machine-readable risks section',
  'a numeric cap on the number of visible risks',
  'a KEY FILES section in the briefing',
  'model-side summarization at read time',
  'nested detours',
  'a PostToolUse lint over what update_thread just wrote',
  'detecting machine payload in risk prose to force it into refs',
];

const ACTIVE_GOAL = 'make briefing length a function of the current step rather than of the thread age, so a thirty-session thread briefs at the same size as a three-session one, by scoping every risk and decision to a completion criterion at write time and filtering to the current criterion at read time, and by shipping the rendered markdown as the only payload the tool returns';

const NEXT_STEP = 'wire the stop hook to the pledge written by get_resume_brief: read the pledge, compare it to the last assistant message in the transcript, clear the pledge and fall through on an exact echo, and block with exit 2 and the owed text on stderr on a reworded one. Fail open on a missing transcript, an unparseable transcript and an unreadable pledge, then add the four unit cases that pin those fail-open paths.';

const LAST_SESSION = 'landed the scoped-items unit and merged it into the integration tip; the server-side renderer and its verbatim gate are next';

const AGED_DECISION_COUNT = 66;

function agedDecisions() {
  return Array.from({ length: AGED_DECISION_COUNT }, (unused, i) => ({
    ref: `${String(i + 101).padStart(4, '0')}-aged-ruling-${i + 1}`,
    title: AGED_TITLES[i % AGED_TITLES.length],
    scope: AGED_SCOPES[i % AGED_SCOPES.length],
  }));
}

export async function seedHeavyThread(ctx) {
  const { thread } = await openThread.handler(ctx, {
    title: 'Mitosis preflight briefing redesign',
    completion_criteria: CRITERIA,
  });

  for (const [slug, title] of CURRENT_DECISIONS) {
    await recordDecision.handler(ctx, {
      thread_id: thread.id,
      slug,
      title,
      scope: CURRENT_SCOPE,
      context: `the redesign needs a ruling on ${slug}`,
      options: ['keep the current behavior', 'change it as described'],
      outcome: title,
    });
  }

  await updateThread.handler(ctx, {
    thread_id: thread.id,
    completion_criteria: [{ id: 'c1', done: true }, { id: 'c2', done: true }],
    spine: {
      next_step: NEXT_STEP,
      last_session: LAST_SESSION,
      open_risks: RISKS.map(([scope, text, refs]) => ({ text, scope, refs })),
      out_of_scope: OUT_OF_SCOPE,
    },
  });

  const written = await ctx.driver.readThread(thread.id);
  const upcast = {
    ...written,
    spine: {
      ...written.spine,
      active_goal: ACTIVE_GOAL,
      key_decisions: [...written.spine.key_decisions, ...agedDecisions()],
    },
  };
  await ctx.driver.writeThread(upcast);
  return { thread: upcast };
}
