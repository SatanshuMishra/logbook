import assert from "node:assert/strict";
import { test } from "node:test";

const OLD_TIME = new Date(Date.UTC(2026, 9, 14, 8, 0, 0)).toISOString();
const NEW_TIME = new Date(Date.UTC(2026, 9, 14, 9, 30, 0)).toISOString();

const SLUG = "fix-login";
const TITLE_LINE = "# fix-login: Fix the login page";
const STATUS_VALUES =
  "active, blocked: <reason>, waiting: <reason>, parked, done or abandoned: <reason>";
const SECTION_ORDER =
  '"## Goal", "## Done when", "## Where things stand", "## Next step", "## Decisions in force", "## Open risks", "## Settled, do not reopen", "## Where the details live"';

type Bodies = {
  goal: readonly string[];
  doneWhen: readonly string[];
  whereThingsStand: readonly string[];
  nextStep: readonly string[];
  decisions: readonly string[];
  risks: readonly string[];
  settled: readonly string[];
  details: readonly string[];
};

type SectionSpec = readonly [string, readonly string[]];

const DEFAULT_BODIES: Bodies = {
  goal: ["Let people sign in again."],
  doneWhen: ["- [ ] c1 The page loads"],
  whereThingsStand: ["The form posts to the old endpoint."],
  nextStep: ["Point the form at the new endpoint."],
  decisions: ["- D1 Keep the session cookie"],
  risks: ["- R1 The cache may hold the old page"],
  settled: ["- S1 The login page stays at /login"],
  details: ["- Spec: docs/specs/login.md"],
};

const headerWith = (
  options: {
    title?: string;
    status?: string;
    nextIds?: string;
    updated?: string;
  } = {},
): string[] => [
  options.title ?? TITLE_LINE,
  options.status ?? "Status: active",
  options.updated ?? `Updated: ${OLD_TIME}`,
  options.nextIds ?? "Next ids: c2 D2 R2 S2",
];

const sectionsOf = (bodies: Partial<Bodies> = {}): SectionSpec[] => {
  const merged = { ...DEFAULT_BODIES, ...bodies };
  return [
    ["Goal", merged.goal],
    ["Done when", merged.doneWhen],
    ["Where things stand", merged.whereThingsStand],
    ["Next step", merged.nextStep],
    ["Decisions in force", merged.decisions],
    ["Open risks", merged.risks],
    ["Settled, do not reopen", merged.settled],
    ["Where the details live", merged.details],
  ];
};

const render = (
  header: readonly string[],
  sections: readonly SectionSpec[],
  note?: readonly string[],
): string =>
  [
    ...header,
    "",
    ...sections.flatMap(([name, body]) => [`## ${name}`, "", ...body, ""]),
    ...(note === undefined ? [] : ["## This update", "", ...note, ""]),
  ].join("\n");

const buildDocument = (
  options: {
    header?: readonly string[];
    bodies?: Partial<Bodies>;
    note?: readonly string[];
  } = {},
): string =>
  render(
    options.header ?? headerWith(),
    sectionsOf(options.bodies),
    options.note,
  );

test("check.structure-accepts-a-valid-document", async () => {
  const { checkStructure } = await import("../../../src/doc/check.ts");
  assert.deepEqual(checkStructure(buildDocument(), SLUG), []);
});

test("check.structure-refuses-a-missing-title", async () => {
  const { checkStructure } = await import("../../../src/doc/check.ts");
  const text = buildDocument().split("\n").slice(1).join("\n");
  const violations = checkStructure(text, SLUG);
  assert.equal(violations.length, 1, JSON.stringify(violations));
  assert.equal(violations[0]?.line, 1);
  assert.ok(
    violations[0]?.message.includes('"# <slug>: <title>"'),
    violations[0]?.message,
  );
});

test("check.structure-refuses-another-slug", async () => {
  const { checkStructure } = await import("../../../src/doc/check.ts");
  const violations = checkStructure(buildDocument(), "other-thread");
  assert.equal(violations.length, 1, JSON.stringify(violations));
  assert.equal(violations[0]?.line, 1);
  assert.ok(
    violations[0]?.message.includes('the title must start "# other-thread: "'),
    violations[0]?.message,
  );
});

test("check.structure-refuses-a-missing-status", async () => {
  const { checkStructure } = await import("../../../src/doc/check.ts");
  const text = buildDocument({
    header: [TITLE_LINE, `Updated: ${OLD_TIME}`, "Next ids: c2 D2 R2 S2"],
  });
  const violations = checkStructure(text, SLUG);
  assert.equal(violations.length, 1, JSON.stringify(violations));
  assert.equal(violations[0]?.line, 2);
  assert.ok(
    violations[0]?.message.includes("the Status line is missing"),
    violations[0]?.message,
  );
  assert.ok(
    violations[0]?.message.includes(STATUS_VALUES),
    violations[0]?.message,
  );
});

test("check.structure-refuses-an-unknown-status", async () => {
  const { checkStructure } = await import("../../../src/doc/check.ts");
  const violations = checkStructure(
    buildDocument({ header: headerWith({ status: "Status: finished" }) }),
    SLUG,
  );
  assert.equal(violations.length, 1, JSON.stringify(violations));
  assert.equal(violations[0]?.line, 2);
  assert.ok(
    violations[0]?.message.includes('"finished"'),
    violations[0]?.message,
  );
  assert.ok(
    violations[0]?.message.includes(STATUS_VALUES),
    violations[0]?.message,
  );
});

test("check.structure-refuses-a-status-without-its-reason", async () => {
  const { checkStructure } = await import("../../../src/doc/check.ts");
  for (const status of [
    "Status: blocked:",
    "Status: waiting",
    "Status: abandoned",
  ]) {
    const violations = checkStructure(
      buildDocument({ header: headerWith({ status }) }),
      SLUG,
    );
    assert.equal(
      violations.length,
      1,
      `${status}: ${JSON.stringify(violations)}`,
    );
    assert.equal(violations[0]?.line, 2);
    assert.ok(
      violations[0]?.message.includes("needs a reason after the colon"),
      violations[0]?.message,
    );
  }
});

test("check.structure-refuses-a-missing-section", async () => {
  const { checkStructure } = await import("../../../src/doc/check.ts");
  const text = render(
    headerWith(),
    sectionsOf().filter(([name]) => name !== "Open risks"),
  );
  const violations = checkStructure(text, SLUG);
  assert.equal(violations.length, 1, JSON.stringify(violations));
  assert.equal(violations[0]?.line, 26);
  assert.ok(
    violations[0]?.message.includes('the section "## Open risks" is missing'),
    violations[0]?.message,
  );
  assert.ok(
    violations[0]?.message.includes(
      'after "## Decisions in force" and before "## Settled, do not reopen"',
    ),
    violations[0]?.message,
  );
});

test("check.structure-refuses-sections-out-of-order", async () => {
  const { checkStructure } = await import("../../../src/doc/check.ts");
  const sections = sectionsOf();
  const reordered = sections.map((section, index) => {
    if (index === 2) return sections[3] ?? section;
    if (index === 3) return sections[2] ?? section;
    return section;
  });
  assert.deepEqual(reordered.map(([name]) => name).slice(2, 4), [
    "Next step",
    "Where things stand",
  ]);
  const violations = checkStructure(render(headerWith(), reordered), SLUG);
  assert.equal(violations.length, 1, JSON.stringify(violations));
  assert.equal(violations[0]?.line, 18);
  assert.ok(
    violations[0]?.message.includes(SECTION_ORDER),
    violations[0]?.message,
  );
});

test("check.structure-refuses-an-unknown-section", async () => {
  const { checkStructure } = await import("../../../src/doc/check.ts");
  const text = render(headerWith(), [
    ...sectionsOf(),
    ["Notes", ["Ask the owner about caching."]],
  ]);
  const violations = checkStructure(text, SLUG);
  assert.equal(violations.length, 1, JSON.stringify(violations));
  assert.equal(violations[0]?.line, 38);
  assert.ok(
    violations[0]?.message.includes('"## Notes"'),
    violations[0]?.message,
  );
});

test("check.structure-refuses-a-note-that-is-not-last", async () => {
  const { checkStructure } = await import("../../../src/doc/check.ts");
  const sections = sectionsOf();
  const text = render(headerWith(), [
    ...sections.slice(0, 5),
    ["This update", ["Moved a risk."]],
    ...sections.slice(5),
  ]);
  const violations = checkStructure(text, SLUG);
  assert.equal(violations.length, 1, JSON.stringify(violations));
  assert.equal(violations[0]?.line, 26);
  assert.ok(
    violations[0]?.message.includes(
      '"## This update" must be the last section',
    ),
    violations[0]?.message,
  );
});

test("check.structure-refuses-a-bad-list-line", async () => {
  const { checkStructure } = await import("../../../src/doc/check.ts");
  const text = buildDocument({
    bodies: { decisions: ["- D1 Keep the session cookie", "- use Postgres"] },
  });
  const violations = checkStructure(text, SLUG);
  assert.equal(violations.length, 1, JSON.stringify(violations));
  assert.equal(violations[0]?.line, 25);
  assert.ok(
    violations[0]?.message.includes('"- use Postgres"'),
    violations[0]?.message,
  );
  assert.ok(
    violations[0]?.message.includes('"- D<n> <text>"'),
    violations[0]?.message,
  );
});

test("check.structure-refuses-a-criterion-without-a-box", async () => {
  const { checkStructure } = await import("../../../src/doc/check.ts");
  const violations = checkStructure(
    buildDocument({ bodies: { doneWhen: ["- c1 The page loads"] } }),
    SLUG,
  );
  assert.equal(violations.length, 1, JSON.stringify(violations));
  assert.equal(violations[0]?.line, 12);
  assert.equal(violations[0]?.id, "c1");
  assert.ok(
    violations[0]?.message.includes('"- [ ] c<n> <text>"'),
    violations[0]?.message,
  );
});

test("check.structure-refuses-a-boxed-decision", async () => {
  const { checkStructure } = await import("../../../src/doc/check.ts");
  const violations = checkStructure(
    buildDocument({ bodies: { decisions: ["- [x] D1 Use Postgres"] } }),
    SLUG,
  );
  assert.equal(violations.length, 1, JSON.stringify(violations));
  assert.equal(violations[0]?.line, 24);
  assert.equal(violations[0]?.id, "D1");
});

test("check.structure-refuses-an-item-in-another-section", async () => {
  const { checkStructure } = await import("../../../src/doc/check.ts");
  const text = buildDocument({
    bodies: {
      decisions: ["- D2 Keep the session cookie"],
      risks: ["- R1 The cache may hold the old page", "- D1 Use Postgres"],
    },
  });
  const violations = checkStructure(text, SLUG);
  assert.equal(violations.length, 1, JSON.stringify(violations));
  assert.equal(violations[0]?.line, 29);
  assert.equal(violations[0]?.id, "D1");
  assert.ok(
    violations[0]?.message.includes(
      'D items belong under "## Decisions in force"',
    ),
    violations[0]?.message,
  );
});

test("check.structure-refuses-a-repeated-id", async () => {
  const { checkStructure } = await import("../../../src/doc/check.ts");
  const text = buildDocument({
    bodies: {
      risks: [
        "- R1 The cache may hold the old page",
        "- R1 The cache may hold the old page",
      ],
    },
  });
  const violations = checkStructure(text, SLUG);
  assert.equal(violations.length, 1, JSON.stringify(violations));
  assert.equal(violations[0]?.line, 29);
  assert.equal(violations[0]?.id, "R1");
  assert.ok(violations[0]?.message.includes("R1"), violations[0]?.message);
});

test("check.structure-refuses-conflict-markers", async () => {
  const { checkStructure } = await import("../../../src/doc/check.ts");
  const text = buildDocument({
    bodies: {
      whereThingsStand: [
        "<<<<<<< local",
        "The form posts to the old endpoint.",
        "=======",
        "The form posts to the new endpoint.",
        ">>>>>>> remote",
      ],
    },
  });
  const violations = checkStructure(text, SLUG);
  assert.deepEqual(
    violations.map((entry) => entry.line),
    [16, 18, 20],
  );
  for (const entry of violations) {
    assert.ok(entry.message.includes("resolve the conflict"), entry.message);
    assert.ok(entry.message.includes("delete this marker line"), entry.message);
  }
});

test("check.structure-names-the-line-of-a-missing-last-section", async () => {
  const { checkStructure } = await import("../../../src/doc/check.ts");
  const sections = sectionsOf().filter(
    ([name]) => name !== "Where the details live",
  );
  const first = render(headerWith(), sections);
  const second = render(headerWith(), sections, ["Dropped the details."]);
  const noteLine = second.split("\n").indexOf("## This update") + 1;
  const firstViolations = checkStructure(first, SLUG);
  const secondViolations = checkStructure(second, SLUG);
  assert.equal(firstViolations.length, 1, JSON.stringify(firstViolations));
  assert.equal(secondViolations.length, 1, JSON.stringify(secondViolations));
  assert.ok(
    firstViolations[0]?.message.includes('"## Where the details live"'),
    firstViolations[0]?.message,
  );
  assert.ok(
    secondViolations[0]?.message.includes('"## Where the details live"'),
    secondViolations[0]?.message,
  );
  assert.equal(firstViolations[0]?.line, first.split("\n").length);
  assert.equal(secondViolations[0]?.line, noteLine);
});

test("check.structure-refuses-an-item-number-past-the-bound", async () => {
  const { checkStructure } = await import("../../../src/doc/check.ts");
  const text = buildDocument({
    bodies: {
      decisions: [
        "- D1 Keep the session cookie",
        "- D9007199254740991 at the bound",
        "- D99999999999999999999 big",
      ],
    },
  });
  const violations = checkStructure(text, SLUG);
  assert.deepEqual(
    violations.map((entry) => entry.line),
    [25, 26],
  );
  for (const entry of violations) {
    assert.ok(entry.message.includes('"- D<n> <text>"'), entry.message);
  }
});

test("check.structure-says-when-a-letter-is-used-up", async () => {
  const { checkStructure } = await import("../../../src/doc/check.ts");
  const text = buildDocument({
    header: headerWith({ nextIds: "Next ids: c2 D9007199254740991 R2 S2" }),
    bodies: {
      decisions: [
        "- D9007199254740990 Keep the session cookie",
        "- D9007199254740991 one more",
        "- D9007199254740990 again",
      ],
    },
  });
  const violations = checkStructure(text, SLUG);
  assert.deepEqual(
    violations.map((entry) => entry.line),
    [25, 26],
  );
  for (const entry of violations) {
    assert.ok(
      entry.message.includes("the D ids of this thread are used up"),
      entry.message,
    );
    assert.ok(entry.message.includes("delete the line"), entry.message);
    assert.ok(!entry.message.includes("or higher"), entry.message);
    assert.ok(
      !entry.message.includes("the number on the Next ids line"),
      entry.message,
    );
  }
});

test("check.structure-takes-the-letter-of-a-bad-line-from-its-text", async () => {
  const { checkStructure } = await import("../../../src/doc/check.ts");
  const text = buildDocument({
    header: headerWith({ nextIds: "Next ids: c2 D9007199254740991 R2 S2" }),
    bodies: {
      decisions: [
        "- D9007199254740990 Keep the session cookie",
        "- R99999999999999999999 The build may time out",
        "- use Postgres",
        "- S3-compatible storage is the target",
      ],
      risks: ["- D9007199254740991 Use Postgres"],
    },
  });
  const violations = checkStructure(text, SLUG);
  assert.deepEqual(
    violations.map((entry) => entry.line),
    [25, 26, 27, 31],
  );
  const [riskLine, ...usedUpLines] = violations;
  assert.ok(riskLine?.message.includes('"- R<n> <text>"'), riskLine?.message);
  assert.ok(!riskLine?.message.includes("used up"), riskLine?.message);
  for (const entry of usedUpLines) {
    assert.ok(
      entry.message.includes("the D ids of this thread are used up"),
      entry.message,
    );
    assert.ok(entry.message.includes("delete the line"), entry.message);
    assert.ok(!entry.message.includes("or higher"), entry.message);
    assert.ok(
      !entry.message.includes("the number on the Next ids line"),
      entry.message,
    );
  }
});

test("check.structure-refuses-a-marker-written-alone", async () => {
  const { checkStructure } = await import("../../../src/doc/check.ts");
  const text = buildDocument({
    bodies: { whereThingsStand: ["<<<<<<<", "|||||||", ">>>>>>>"] },
  });
  const violations = checkStructure(text, SLUG);
  assert.deepEqual(
    violations.map((entry) => entry.line),
    [16, 17, 18],
  );
  for (const entry of violations) {
    assert.ok(entry.message.includes("resolve the conflict"), entry.message);
    assert.ok(entry.message.includes("delete this marker line"), entry.message);
  }
});

test("check.update-accepts-an-unchanged-version", async () => {
  const { checkUpdate } = await import("../../../src/doc/check.ts");
  assert.deepEqual(checkUpdate(buildDocument(), buildDocument()), []);
});

test("check.update-accepts-edited-prose", async () => {
  const { checkUpdate } = await import("../../../src/doc/check.ts");
  const newText = buildDocument({
    bodies: {
      whereThingsStand: ["The form now posts to the new endpoint."],
      nextStep: ["Deploy the form and watch the error rate."],
    },
  });
  assert.deepEqual(checkUpdate(buildDocument(), newText), []);
});

test("check.update-ignores-the-header-lines", async () => {
  const { checkUpdate } = await import("../../../src/doc/check.ts");
  const newText = buildDocument({
    header: headerWith({
      updated: `Updated: ${NEW_TIME}`,
      nextIds: "Next ids: c1 D1 R1 S1",
    }),
  });
  assert.deepEqual(checkUpdate(buildDocument(), newText), []);
});

test("check.update-accepts-a-removal-with-each-reason-form", async () => {
  const { checkUpdate } = await import("../../../src/doc/check.ts");
  const header = headerWith({ nextIds: "Next ids: c2 D3 R2 S2" });
  const oldText = buildDocument({
    header,
    bodies: {
      decisions: ["- D1 Keep the session cookie", "- D2 Use Postgres"],
    },
  });
  const newText = buildDocument({
    header,
    bodies: {
      decisions: ["- D1 Keep the session cookie"],
      risks: ["None known yet."],
      settled: ["Nothing settled yet."],
    },
    note: [
      "Removed: R1 because it passed",
      "Removed: D2 - superseded",
      "Removed: S1: no longer asked",
    ],
  });
  assert.deepEqual(checkUpdate(oldText, newText), []);
});

test("check.update-refuses-a-silent-removal", async () => {
  const { checkUpdate } = await import("../../../src/doc/check.ts");
  const violations = checkUpdate(
    buildDocument(),
    buildDocument({ bodies: { risks: ["None known yet."] } }),
  );
  assert.equal(violations.length, 1, JSON.stringify(violations));
  assert.equal(violations[0]?.id, "R1");
  assert.ok(
    violations[0]?.message.includes('"Removed: R1 because <reason>"'),
    violations[0]?.message,
  );
});

test("check.update-refuses-a-removed-criterion", async () => {
  const { checkUpdate } = await import("../../../src/doc/check.ts");
  const header = headerWith({ nextIds: "Next ids: c3 D2 R2 S2" });
  const oldText = buildDocument({
    header,
    bodies: { doneWhen: ["- [ ] c1 The page loads", "- [ ] c2 Errors show"] },
  });
  const withoutNote = buildDocument({
    header,
    bodies: { doneWhen: ["- [ ] c1 The page loads"] },
  });
  const withNote = buildDocument({
    header,
    bodies: { doneWhen: ["- [ ] c1 The page loads"] },
    note: ["Removed: c2 because done elsewhere"],
  });
  for (const newText of [withoutNote, withNote]) {
    const violations = checkUpdate(oldText, newText);
    assert.equal(violations.length, 1, JSON.stringify(violations));
    assert.equal(violations[0]?.id, "c2");
    assert.ok(
      violations[0]?.message.includes("never removed"),
      violations[0]?.message,
    );
    assert.ok(
      violations[0]?.message.includes("struck with [~] and struck:"),
      violations[0]?.message,
    );
  }
});

test("check.update-refuses-a-removed-line-for-a-present-id", async () => {
  const { checkUpdate } = await import("../../../src/doc/check.ts");
  const violations = checkUpdate(
    buildDocument(),
    buildDocument({ note: ["Removed: R1 because it passed"] }),
  );
  assert.equal(violations.length, 1, JSON.stringify(violations));
  assert.equal(violations[0]?.id, "R1");
  assert.ok(
    violations[0]?.message.includes("R1 is still in the document"),
    violations[0]?.message,
  );
});

test("check.update-refuses-a-removed-line-for-an-unknown-id", async () => {
  const { checkUpdate } = await import("../../../src/doc/check.ts");
  const violations = checkUpdate(
    buildDocument(),
    buildDocument({ note: ["Removed: R9 because it passed"] }),
  );
  assert.equal(violations.length, 1, JSON.stringify(violations));
  assert.equal(violations[0]?.id, "R9");
  assert.ok(
    violations[0]?.message.includes("the old version has no R9"),
    violations[0]?.message,
  );
});

test("check.update-accepts-a-tick-with-evidence", async () => {
  const { checkUpdate } = await import("../../../src/doc/check.ts");
  const newText = buildDocument({
    bodies: { doneWhen: ["- [x] c1 The page loads evidence: npm test passed"] },
  });
  assert.deepEqual(checkUpdate(buildDocument(), newText), []);
});

test("check.update-refuses-a-tick-without-evidence", async () => {
  const { checkUpdate } = await import("../../../src/doc/check.ts");
  const header = headerWith({ nextIds: "Next ids: c4 D2 R2 S2" });
  const oldText = buildDocument({
    header,
    bodies: {
      doneWhen: [
        "- [ ] c1 The page loads",
        "- [ ] c2 Errors show",
        "- [~] c3 Old flow struck: replaced by D1",
      ],
    },
  });
  const newText = buildDocument({
    header,
    bodies: {
      doneWhen: [
        "- [x] c1 The page loads",
        "- [ ] c2 Errors show",
        "- [x] c3 Old flow",
      ],
    },
  });
  const violations = checkUpdate(oldText, newText);
  assert.deepEqual(
    violations.map((entry) => entry.id),
    ["c1", "c3"],
  );
  for (const entry of violations) {
    assert.ok(
      entry.message.includes("evidence: <what proves it>"),
      entry.message,
    );
  }
});

test("check.update-accepts-a-strike-with-a-reason", async () => {
  const { checkUpdate } = await import("../../../src/doc/check.ts");
  const header = headerWith({ nextIds: "Next ids: c3 D2 R2 S2" });
  const oldText = buildDocument({
    header,
    bodies: { doneWhen: ["- [ ] c1 The page loads", "- [ ] c2 Errors show"] },
  });
  const newText = buildDocument({
    header,
    bodies: {
      doneWhen: [
        "- [ ] c1 The page loads",
        "- [~] c2 Errors show struck: replaced by c4",
      ],
    },
  });
  assert.deepEqual(checkUpdate(oldText, newText), []);
});

test("check.update-refuses-a-strike-without-a-reason", async () => {
  const { checkUpdate } = await import("../../../src/doc/check.ts");
  const header = headerWith({ nextIds: "Next ids: c3 D2 R2 S2" });
  const oldText = buildDocument({
    header,
    bodies: { doneWhen: ["- [ ] c1 The page loads", "- [ ] c2 Errors show"] },
  });
  const newText = buildDocument({
    header,
    bodies: { doneWhen: ["- [ ] c1 The page loads", "- [~] c2 Errors show"] },
  });
  const violations = checkUpdate(oldText, newText);
  assert.equal(violations.length, 1, JSON.stringify(violations));
  assert.equal(violations[0]?.id, "c2");
  assert.ok(
    violations[0]?.message.includes("struck: <reason>"),
    violations[0]?.message,
  );
});

test("check.update-accepts-a-reopen-with-a-reason", async () => {
  const { checkUpdate } = await import("../../../src/doc/check.ts");
  const oldText = buildDocument({
    bodies: { doneWhen: ["- [x] c1 The page loads evidence: npm test passed"] },
  });
  const newText = buildDocument({
    bodies: {
      doneWhen: ["- [ ] c1 The page loads reopened: the fix regressed"],
    },
  });
  assert.deepEqual(checkUpdate(oldText, newText), []);
});

test("check.update-refuses-a-reopen-without-a-reason", async () => {
  const { checkUpdate } = await import("../../../src/doc/check.ts");
  const header = headerWith({ nextIds: "Next ids: c3 D2 R2 S2" });
  const oldText = buildDocument({
    header,
    bodies: {
      doneWhen: [
        "- [x] c1 The page loads evidence: npm test passed",
        "- [~] c2 Errors show struck: replaced by c3",
      ],
    },
  });
  const newText = buildDocument({
    header,
    bodies: { doneWhen: ["- [ ] c1 The page loads", "- [ ] c2 Errors show"] },
  });
  const violations = checkUpdate(oldText, newText);
  assert.deepEqual(
    violations.map((entry) => entry.id),
    ["c1", "c2"],
  );
  for (const entry of violations) {
    assert.ok(entry.message.includes("reopened: <reason>"), entry.message);
  }
});

test("check.update-accepts-a-reword-citing-a-new-decision", async () => {
  const { checkUpdate } = await import("../../../src/doc/check.ts");
  const header = headerWith({ nextIds: "Next ids: c2 D3 R2 S2" });
  const oldText = buildDocument({
    header,
    bodies: {
      decisions: ["- D1 Keep the session cookie", "- D2 Use Postgres"],
    },
  });
  const newText = buildDocument({
    header,
    bodies: {
      doneWhen: ["- [ ] c1 The page loads within two seconds per D3"],
      decisions: [
        "- D1 Keep the session cookie",
        "- D2 Use Postgres",
        "- D3 Answer within two seconds",
      ],
    },
  });
  assert.deepEqual(checkUpdate(oldText, newText), []);
});

test("check.update-refuses-a-reword-citing-a-decision-not-in-force", async () => {
  const { checkUpdate } = await import("../../../src/doc/check.ts");
  const newText = buildDocument({
    bodies: { doneWhen: ["- [ ] c1 The page loads within two seconds per D7"] },
  });
  const violations = checkUpdate(buildDocument(), newText);
  assert.equal(violations.length, 1, JSON.stringify(violations));
  assert.equal(violations[0]?.id, "c1");
  assert.ok(
    violations[0]?.message.includes(
      "the wording of c1 changed without a decision in force",
    ),
    violations[0]?.message,
  );
});

test("check.update-refuses-a-reword-without-a-new-decision", async () => {
  const { checkUpdate } = await import("../../../src/doc/check.ts");
  const oldText = buildDocument({
    bodies: { doneWhen: ["- [ ] c1 The page loads per D1"] },
  });
  const newText = buildDocument({
    bodies: { doneWhen: ["- [ ] c1 The page loads fast per D1"] },
  });
  const violations = checkUpdate(oldText, newText);
  assert.equal(violations.length, 1, JSON.stringify(violations));
  assert.equal(violations[0]?.id, "c1");
  assert.ok(violations[0]?.message.includes("c1"), violations[0]?.message);
});

test("check.update-refuses-an-id-below-next-ids", async () => {
  const { checkUpdate } = await import("../../../src/doc/check.ts");
  const header = headerWith({ nextIds: "Next ids: c2 D5 R2 S2" });
  const oldText = buildDocument({ header });
  const newText = buildDocument({
    header,
    bodies: {
      decisions: ["- D1 Keep the session cookie", "- D3 Use Postgres"],
    },
  });
  const violations = checkUpdate(oldText, newText);
  assert.equal(violations.length, 1, JSON.stringify(violations));
  assert.equal(violations[0]?.id, "D3");
  assert.ok(
    violations[0]?.message.includes("D5 or higher"),
    violations[0]?.message,
  );
});

test("check.update-accepts-an-id-at-next-ids", async () => {
  const { checkUpdate } = await import("../../../src/doc/check.ts");
  const header = headerWith({ nextIds: "Next ids: c2 D5 R2 S2" });
  const oldText = buildDocument({ header });
  const newText = buildDocument({
    header,
    bodies: {
      decisions: ["- D1 Keep the session cookie", "- D5 Use Postgres"],
    },
  });
  assert.deepEqual(checkUpdate(oldText, newText), []);
});

test("check.update-refuses-a-changed-slug", async () => {
  const { checkUpdate } = await import("../../../src/doc/check.ts");
  const newText = buildDocument({
    header: headerWith({ title: "# fix-logout: Fix the login page" }),
  });
  const violations = checkUpdate(buildDocument(), newText);
  assert.equal(violations.length, 1, JSON.stringify(violations));
  assert.equal(violations[0]?.line, 1);
  assert.ok(
    violations[0]?.message.includes("the slug of this thread stays fix-login"),
    violations[0]?.message,
  );
});

test("check.update-names-the-line-of-a-removal-whose-section-is-gone", async () => {
  const { checkUpdate } = await import("../../../src/doc/check.ts");
  const oldText = buildDocument();
  const newText = render(
    headerWith(),
    sectionsOf({ decisions: ["- D1 Keep the session cookie"] }).filter(
      ([name]) => name !== "Done when" && name !== "Open risks",
    ),
  );
  const lines = newText.split("\n");
  const violations = checkUpdate(oldText, newText);
  assert.equal(violations.length, 2, JSON.stringify(violations));
  assert.equal(
    violations.find((entry) => entry.id === "c1")?.line,
    lines.indexOf("## Where things stand") + 1,
  );
  assert.equal(
    violations.find((entry) => entry.id === "R1")?.line,
    lines.indexOf("## Settled, do not reopen") + 1,
  );
});

test("check.update-reads-the-old-next-ids-per-letter", async () => {
  const { checkUpdate } = await import("../../../src/doc/check.ts");
  const risks = ["- R1 The cache may hold the old page"];
  const grown = [
    "- R1 The cache may hold the old page",
    "- R2 The build may time out",
  ];
  const withLine = buildDocument({
    header: headerWith({ nextIds: "Next ids: c2 D99999999999999999999 R3 S2" }),
    bodies: { risks },
  });
  const withoutLine = buildDocument({
    header: headerWith().slice(0, 3),
    bodies: { risks },
  });
  const first = checkUpdate(
    withLine,
    buildDocument({
      header: headerWith({
        nextIds: "Next ids: c2 D99999999999999999999 R3 S2",
      }),
      bodies: { risks: grown },
    }),
  );
  assert.equal(first.length, 1, JSON.stringify(first));
  assert.equal(first[0]?.id, "R2");
  assert.ok(first[0]?.message.includes("R3 or higher"), first[0]?.message);
  assert.deepEqual(
    checkUpdate(
      withoutLine,
      buildDocument({
        header: headerWith().slice(0, 3),
        bodies: { risks: grown },
      }),
    ),
    [],
  );
});

test("check.update-says-when-a-letter-is-used-up", async () => {
  const { checkUpdate } = await import("../../../src/doc/check.ts");
  const header = headerWith({
    nextIds: "Next ids: c2 D9007199254740991 R2 S2",
  });
  const oldText = buildDocument({
    header,
    bodies: { decisions: ["- D9007199254740990 Keep the session cookie"] },
  });
  const newText = buildDocument({
    header,
    bodies: {
      decisions: [
        "- D9007199254740990 Keep the session cookie",
        "- D7 Use Postgres",
      ],
    },
  });
  const violations = checkUpdate(oldText, newText);
  assert.equal(violations.length, 1, JSON.stringify(violations));
  assert.equal(violations[0]?.id, "D7");
  assert.ok(
    violations[0]?.message.includes("the D ids of this thread are used up"),
    violations[0]?.message,
  );
  assert.ok(
    violations[0]?.message.includes("delete the line"),
    violations[0]?.message,
  );
  assert.ok(
    !violations[0]?.message.includes("or higher"),
    violations[0]?.message,
  );
});

test("check.close-accepts-done-with-every-criterion-settled", async () => {
  const { checkClose } = await import("../../../src/doc/check.ts");
  const oldText = buildDocument({
    header: headerWith({ nextIds: "Next ids: c3 D2 R2 S2" }),
    bodies: { doneWhen: ["- [ ] c1 The page loads", "- [ ] c2 Errors show"] },
  });
  const newText = buildDocument({
    header: headerWith({
      status: "Status: done",
      nextIds: "Next ids: c3 D2 R2 S2",
    }),
    bodies: {
      doneWhen: [
        "- [x] c1 The page loads evidence: npm test passed",
        "- [~] c2 Errors show struck: replaced by D1",
      ],
    },
  });
  assert.deepEqual(checkClose(oldText, newText), []);
});

test("check.close-refuses-done-with-an-open-criterion", async () => {
  const { checkClose } = await import("../../../src/doc/check.ts");
  const doneWhen = [
    "- [ ] c1 The page loads",
    "- [ ] c2 Errors show",
    "- [ ] c3 The old page redirects",
  ];
  const oldText = buildDocument({
    header: headerWith({ nextIds: "Next ids: c4 D2 R2 S2" }),
    bodies: { doneWhen },
  });
  const newText = buildDocument({
    header: headerWith({
      status: "Status: done",
      nextIds: "Next ids: c4 D2 R2 S2",
    }),
    bodies: {
      doneWhen: [
        "- [x] c1 The page loads evidence: npm test passed",
        "- [ ] c2 Errors show",
        "- [ ] c3 The old page redirects",
      ],
    },
  });
  const violations = checkClose(oldText, newText);
  assert.deepEqual(
    violations.map((entry) => entry.id),
    ["c2", "c3"],
  );
  assert.deepEqual(
    violations.map((entry) => entry.line),
    [13, 14],
  );
  for (const entry of violations) {
    assert.ok(
      entry.message.includes(`${entry.id} is still open`),
      entry.message,
    );
    assert.ok(
      entry.message.includes("before the thread is done"),
      entry.message,
    );
  }
});

test("check.close-accepts-done-without-criteria", async () => {
  const { checkClose } = await import("../../../src/doc/check.ts");
  const oldText = buildDocument({
    header: headerWith({ nextIds: "Next ids: c1 D2 R2 S2" }),
    bodies: { doneWhen: [] },
  });
  const newText = buildDocument({
    header: headerWith({
      status: "Status: done",
      nextIds: "Next ids: c1 D2 R2 S2",
    }),
    bodies: { doneWhen: [] },
  });
  assert.deepEqual(checkClose(oldText, newText), []);
});

test("check.close-accepts-abandoned-with-open-criteria", async () => {
  const { checkClose } = await import("../../../src/doc/check.ts");
  const newText = buildDocument({
    header: headerWith({
      status: "Status: abandoned: the owner dropped the feature",
    }),
  });
  assert.deepEqual(checkClose(buildDocument(), newText), []);
});

test("check.close-leaves-an-already-done-version-alone", async () => {
  const { checkClose } = await import("../../../src/doc/check.ts");
  const header = headerWith({
    status: "Status: done",
    nextIds: "Next ids: c3 D2 R2 S2",
  });
  const doneWhen = [
    "- [x] c1 The page loads evidence: npm test passed",
    "- [ ] c2 Errors show",
  ];
  const oldText = buildDocument({ header, bodies: { doneWhen } });
  const newText = buildDocument({
    header,
    bodies: {
      doneWhen,
      whereThingsStand: ["The thread was converted from the old ledger."],
    },
  });
  assert.deepEqual(checkClose(oldText, newText), []);
});

test("check.version-lists-structure-then-update-then-close", async () => {
  const { checkVersion } = await import("../../../src/doc/check.ts");
  const oldText = buildDocument({
    header: headerWith({ nextIds: "Next ids: c3 D2 R2 S2" }),
    bodies: { doneWhen: ["- [ ] c1 The page loads", "- [ ] c2 Errors show"] },
  });
  const newText = buildDocument({
    header: headerWith({
      status: "Status: done",
      nextIds: "Next ids: c3 D2 R2 S2",
    }),
    bodies: {
      doneWhen: ["- [x] c1 The page loads", "- [ ] c2 Errors show"],
      decisions: ["- [x] D1 Keep the session cookie"],
    },
  });
  const violations = checkVersion(oldText, newText, SLUG);
  assert.deepEqual(
    violations.map((entry) => [entry.line, entry.id]),
    [
      [25, "D1"],
      [12, "c1"],
      [13, "c2"],
    ],
  );
});

test("check.removed-ids-follow-document-order", async () => {
  const { removedIds } = await import("../../../src/doc/check.ts");
  const header = headerWith({ nextIds: "Next ids: c3 D3 R2 S2" });
  const oldText = buildDocument({
    header,
    bodies: {
      doneWhen: ["- [ ] c1 The page loads", "- [ ] c2 Errors show"],
      decisions: ["- D1 Keep the session cookie", "- D2 Use Postgres"],
    },
  });
  const newText = buildDocument({
    header,
    bodies: {
      doneWhen: ["- [ ] c1 The page loads"],
      decisions: ["- D2 Use Postgres"],
      settled: ["Nothing settled yet."],
    },
  });
  assert.deepEqual(removedIds(oldText, newText), ["c2", "D1", "S1"]);
});

test("check.format-violation-names-the-line", async () => {
  const { formatViolation } = await import("../../../src/doc/check.ts");
  assert.equal(
    formatViolation({
      line: 14,
      id: "R1",
      message: "R1 was removed without a reason",
    }),
    "line 14: R1 was removed without a reason",
  );
});
