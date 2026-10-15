export type EditUpdateCase = {
  name: string
  thread: string
  title: string
  goal: string
  nextStep: string
  criteria: readonly string[]
  files: Readonly<Record<string, string>>
  prompt: string
}

export type StaleLineCase = {
  name: string
  thread: string
  title: string
  document: string
  markers: readonly string[]
  prompt: string
}

export type LongSequenceCase = {
  name: string
  thread: string
  title: string
  goal: string
  nextStep: string
  criteria: readonly string[]
  turns: readonly string[]
}

export type Question = { question: string; required: readonly string[] }

export type ContinueMode = {
  name: 'fresh session through preflight' | 'after compact' | 'after clear'
  takesHold: boolean
  turns: readonly string[]
  resumesNewSession: boolean
}

export type ContinueCase = {
  name: string
  thread: string
  document: string
  questions: readonly Question[]
  modes: readonly ContinueMode[]
}

type DocumentParts = {
  slug: string
  title: string
  status: string
  nextIds: string
  goal: readonly string[]
  doneWhen: readonly string[]
  stands: readonly string[]
  nextStep: readonly string[]
  decisions: readonly string[]
  risks: readonly string[]
  settled: readonly string[]
  details: readonly string[]
}

const UPDATED_AT = new Date(Date.UTC(2026, 9, 14, 9, 0, 0)).toISOString()

const section = (name: string, body: readonly string[]): string[] => [
  `## ${name}`,
  '',
  ...body,
  ...(body.length === 0 ? [] : [''])
]

const documentOf = (parts: DocumentParts): string =>
  `${[
    `# ${parts.slug}: ${parts.title}`,
    `Status: ${parts.status}`,
    `Updated: ${UPDATED_AT}`,
    `Next ids: ${parts.nextIds}`,
    '',
    ...section('Goal', parts.goal),
    ...section('Done when', parts.doneWhen),
    ...section('Where things stand', parts.stands),
    ...section('Next step', parts.nextStep),
    ...section('Decisions in force', parts.decisions),
    ...section('Open risks', parts.risks),
    ...section('Settled, do not reopen', parts.settled),
    ...section('Where the details live', parts.details)
  ]
    .join('\n')
    .replace(/\n+$/, '')}\n`

export const EDIT_UPDATE_CASES: readonly EditUpdateCase[] = [
  {
    name: 'notes file task',
    thread: 'team-notes',
    title: 'Team notes',
    goal: "Keep a notes file of the team's meeting rules",
    nextStep: 'Write notes.md with the agreed rules and commit it.',
    criteria: ['notes.md lists the three agreed meeting rules'],
    files: {},
    prompt:
      "Create notes.md listing these three meeting rules as bullet points: start on time, one speaker at a time, end with action items. Then commit it with git using the message 'add meeting rules'."
  },
  {
    name: 'sum module task',
    thread: 'sum-module',
    title: 'Sum module',
    goal: 'Provide a sum function in sum.mjs with a passing test',
    nextStep: 'Write sum.mjs and test.mjs, run the test and commit.',
    criteria: ['sum.mjs exports sum(a, b)', 'test.mjs checks that sum(2, 3) is 5 and passes under node'],
    files: {},
    prompt:
      'Write sum.mjs exporting sum(a, b), and test.mjs that imports it and asserts sum(2, 3) === 5 with node:assert. Run node test.mjs, then commit both files with git.'
  },
  {
    name: 'rename task',
    thread: 'rename-config',
    title: 'Rename the config file',
    goal: 'Rename config.txt to settings.txt everywhere',
    nextStep: 'Rename the file with git mv, fix README.md and commit.',
    criteria: ['config.txt is renamed to settings.txt', 'README.md names settings.txt'],
    files: {
      'config.txt': 'mode=fast\n',
      'README.md': 'Edit config.txt to change the mode.\n'
    },
    prompt: 'Rename config.txt to settings.txt with git mv, update README.md so it names settings.txt, and commit with git.'
  }
]

export const STALE_LINE_CASES: readonly StaleLineCase[] = [
  {
    name: 'schema migration choice',
    thread: 'orders-schema',
    title: 'Record when orders ship',
    document: documentOf({
      slug: 'orders-schema',
      title: 'Record when orders ship',
      status: 'blocked: the owner chooses option A or option B',
      nextIds: 'c2 D1 R2 S1',
      goal: ['Record when each order ships'],
      doneWhen: ['- [ ] c1 the orders schema can record a ship time'],
      stands: ['Not started.'],
      nextStep: [
        'Waiting on the owner. Option A: add a nullable column shipped_at to orders in orders.sql and backfill later. Option B: create a separate shipments table in shipments.sql keyed by order id.'
      ],
      decisions: [],
      risks: ['- R1 A separate shipments table needs a join in every report query.'],
      settled: [],
      details: []
    }),
    markers: ['shipments.sql', 'separate shipments', 'join in every report'],
    prompt:
      'The owner chose option A. Carry out its first action: create orders.sql containing ALTER TABLE orders ADD COLUMN shipped_at TIMESTAMP NULL; and commit it with git.'
  },
  {
    name: 'parser packaging choice',
    thread: 'csv-parser',
    title: 'Ship the CSV parser',
    document: documentOf({
      slug: 'csv-parser',
      title: 'Ship the CSV parser',
      status: 'blocked: the owner chooses option A or option B',
      nextIds: 'c2 D1 R2 S1',
      goal: ['Make the CSV parser available to the app'],
      doneWhen: ['- [ ] c1 the app can import a CSV parser'],
      stands: ['Not started.'],
      nextStep: [
        'Waiting on the owner. Option A: publish the parser as its own package csv-lite with a package.json. Option B: vendor parse.mjs inside app/vendor/.'
      ],
      decisions: [],
      risks: ['- R1 Publishing csv-lite needs a registry account.'],
      settled: [],
      details: []
    }),
    markers: ['csv-lite', 'own package', 'registry account'],
    prompt:
      'The owner chose option B, vendoring. Carry out its first action: create app/vendor/parse.mjs exporting parse(text) that splits lines on newlines and fields on commas, and commit it with git.'
  },
  {
    name: 'nightly job choice',
    thread: 'nightly-report',
    title: 'Run the report nightly',
    document: documentOf({
      slug: 'nightly-report',
      title: 'Run the report nightly',
      status: 'blocked: the owner chooses option A or option B',
      nextIds: 'c2 D1 R2 S1',
      goal: ['Run report.mjs every night'],
      doneWhen: ['- [ ] c1 report.mjs runs every night'],
      stands: ['Not started.'],
      nextStep: [
        'Waiting on the owner. Option A: run it from cron with a line in ops/crontab. Option B: run it from a GitHub Actions schedule in .github/workflows/nightly.yml.'
      ],
      decisions: [],
      risks: ['- R1 A GitHub Actions schedule can be delayed by queueing.'],
      settled: [],
      details: []
    }),
    markers: ['GitHub Actions', 'nightly.yml', 'queueing'],
    prompt:
      'The owner chose option A, cron. Carry out its first action: create ops/crontab with the line 0 2 * * * node report.mjs and commit it with git.'
  }
]

export const LONG_SEQUENCE_CASE: LongSequenceCase = {
  name: 'eight-turn library build',
  thread: 'text-utils',
  title: 'Text utilities',
  goal: 'Build a small text utility library textutils.mjs with tests',
  nextStep: 'Start with capitalize.',
  criteria: [
    'textutils.mjs exports capitalize, slugify, truncate and wordCount',
    'test.mjs covers each function and passes under node',
    'README.md documents each function',
    'CHANGELOG.md has an entry for version 0.1.0'
  ],
  turns: [
    "Create textutils.mjs exporting capitalize(s), which upper-cases the first letter, and test.mjs asserting capitalize('hello') is 'Hello' with node:assert. Run node test.mjs and commit with git.",
    'Add slugify(s) to textutils.mjs: lower-case, spaces become hyphens, other punctuation is dropped. Add a test, run node test.mjs and commit.',
    'We considered truncating by characters or by words. Decide on characters and record that decision. Then add truncate(s, n), which appends ... when it cuts, with a test. Run the tests and commit.',
    'Add wordCount(s) with a test. Note the risk that wordCount treats hyphenated words as one word. Run the tests and commit.',
    'Write README.md documenting the four functions with one example each. Commit.',
    "Make slugify collapse repeated hyphens and add a test that 'a  b' becomes 'a-b'. Also make wordCount split on hyphens and update its test, so the hyphen risk no longer applies. Run the tests and commit.",
    'Add CHANGELOG.md with a 0.1.0 entry listing the four functions. Commit.',
    'Add package.json with name text-utils, version 0.1.0 and type module. Run node test.mjs and commit.'
  ]
}

export const CONTINUE_CASE: ContinueCase = {
  name: 'release thread',
  thread: 'release-v2',
  document: documentOf({
    slug: 'release-v2',
    title: 'Ship release 2.0 of the billing service',
    status: 'active',
    nextIds: 'c4 D3 R2 S2',
    goal: ['Ship billing service 2.0 with the new invoice engine.'],
    doneWhen: [
      '- [x] c1 The invoice engine is merged evidence: PR 41 merged',
      '- [ ] c2 The staging soak passes for 48 hours',
      '- [ ] c3 The migration script runs on a copy of production data'
    ],
    stands: [
      'The invoice engine is merged in PR 41. The staging soak started; it failed once on a timezone bug, fixed in PR 44.'
    ],
    nextStep: ['Run scripts/migrate-v2.sh against the production copy on host db-copy-3 and record its run time.'],
    decisions: [
      '- D1 Invoices round half-even, not half-up: finance requires it.',
      '- D2 Keep the old engine behind the flag billing.legacy for one release.'
    ],
    risks: ['- R1 The migration may exceed the 30-minute maintenance window. Bears on c3.'],
    settled: ["- S1 Do not switch to the vendor's hosted invoicing: finance rejected it in March."],
    details: ['- Spec: docs/billing-v2.md', '- Runbook: docs/runbooks/migrate-v2.md']
  }),
  questions: [
    {
      question: 'What is the very next thing to do on this thread, and where?',
      required: ['migrate-v2.sh', 'db-copy-3']
    },
    { question: 'How should invoice amounts be rounded?', required: ['half-even'] },
    { question: "Should we move to the vendor's hosted invoicing to save time?", required: ['finance'] },
    { question: 'What could make the migration step miss its time budget?', required: ['maintenance window'] }
  ],
  modes: [
    {
      name: 'fresh session through preflight',
      takesHold: false,
      turns: ['/logbook:preflight release-v2'],
      resumesNewSession: false
    },
    { name: 'after compact', takesHold: true, turns: ['Say ready.', '/compact'], resumesNewSession: false },
    { name: 'after clear', takesHold: true, turns: ['Say ready.', '/clear'], resumesNewSession: true }
  ]
}
