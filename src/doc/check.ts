import {
  LETTER_SECTION,
  MAX_ITEM_NUMBER,
  NOTE_HEADING,
  SECTION_NAMES,
  highestIds,
  letterNamed,
  parseDocument,
  type Item,
  type Letter,
  type NextIds,
  type ParsedDocument,
  type Section,
  type StatusKind,
} from "./document.ts";

export type Violation = { line: number; id: string | null; message: string };

type RemovedLine = { id: string; line: number; text: string };

const LETTERS: readonly Letter[] = ["c", "D", "R", "S"];
const ITEM_FORMS: Record<Letter, string> = {
  c: "- [ ] c<n> <text>",
  D: "- D<n> <text>",
  R: "- R<n> <text>",
  S: "- S<n> <text>",
};
const TITLE_FORM = "# <slug>: <title>";
const STATUS_VALUES =
  "active, blocked: <reason>, waiting: <reason>, parked, done or abandoned: <reason>";
const REASONED_KINDS: readonly StatusKind[] = [
  "blocked",
  "waiting",
  "abandoned",
];
const EVIDENCE_MARKER = " evidence: ";
const STRUCK_MARKER = " struck: ";
const REOPENED_MARKER = " reopened: ";
const WORDING_MARKERS: readonly string[] = [
  EVIDENCE_MARKER,
  STRUCK_MARKER,
  REOPENED_MARKER,
];
const REMOVED_PATTERN =
  /^Removed: ([cDRS][1-9][0-9]*)(?: because | - |: )(.+)$/;
const DECISION_ID_PATTERN = /\bD[1-9][0-9]*\b/g;
const SECTION_ORDER = SECTION_NAMES.map((name) => `"## ${name}"`).join(", ");

const violation = (
  line: number,
  id: string | null,
  message: string,
): Violation => ({ line, id, message });

const inLineOrder = (violations: readonly Violation[]): Violation[] =>
  [...violations].sort((left, right) => left.line - right.line);

const isSectionName = (name: string): boolean =>
  SECTION_NAMES.some((known) => known === name);

const rankOf = (name: string): number =>
  SECTION_NAMES.findIndex((known) => known === name);

const letterOfSection = (name: string): Letter | undefined =>
  LETTERS.find((letter) => LETTER_SECTION[letter] === name);

const firstOccurrences = (items: readonly Item[]): Item[] =>
  items.filter(
    (item, index) => items.findIndex((other) => other.id === item.id) === index,
  );

const usedUpMessage = (letter: Letter): string =>
  `the ${letter} ids of this thread are used up, because ${MAX_ITEM_NUMBER} is the largest number an item may take; delete the line`;

const isUsedUp = (next: number): boolean => next > MAX_ITEM_NUMBER;

const firstSections = (parsed: ParsedDocument): Section[] => {
  const known = parsed.sections.filter((section) =>
    isSectionName(section.name),
  );
  return known.filter(
    (section, index) =>
      known.findIndex((other) => other.name === section.name) === index,
  );
};

const titleViolations = (parsed: ParsedDocument, slug: string): Violation[] => {
  if (parsed.slug === null) {
    return [
      violation(
        1,
        null,
        `the first line must be the title in the form "${TITLE_FORM}"; write "# ${slug}: <title>" there`,
      ),
    ];
  }
  if (parsed.slug !== slug) {
    return [
      violation(
        1,
        null,
        `the title must start "# ${slug}: ", because ${slug} is the slug of this thread; change the first line to "# ${slug}: ${parsed.title ?? "<title>"}"`,
      ),
    ];
  }
  return [];
};

const statusViolations = (parsed: ParsedDocument): Violation[] => {
  const status = parsed.status;
  if (status === null || parsed.statusLine === null) {
    return [
      violation(
        2,
        null,
        `the Status line is missing; add "Status: <value>" right after the title line, where <value> is one of ${STATUS_VALUES}`,
      ),
    ];
  }
  if (status.kind === null) {
    return [
      violation(
        parsed.statusLine,
        null,
        `the status "${status.raw}" is not one of ${STATUS_VALUES}; change the line to "Status: " followed by one of these`,
      ),
    ];
  }
  if (REASONED_KINDS.includes(status.kind) && status.reason === null) {
    return [
      violation(
        parsed.statusLine,
        null,
        `the status ${status.kind} needs a reason after the colon; write "Status: ${status.kind}: <reason>"`,
      ),
    ];
  }
  return [];
};

const placeOf = (
  previous: string | undefined,
  next: string | undefined,
): string => {
  if (previous !== undefined && next !== undefined)
    return `after "## ${previous}" and before "## ${next}"`;
  if (previous !== undefined) return `after "## ${previous}"`;
  if (next !== undefined) return `before "## ${next}"`;
  return "after the header lines";
};

const missingSectionLine = (name: string, parsed: ParsedDocument): number => {
  const present = firstSections(parsed);
  const presentNames = new Set(present.map((section) => section.name));
  const next = SECTION_NAMES.slice(rankOf(name) + 1).find((known) =>
    presentNames.has(known),
  );
  return (
    present.find((section) => section.name === next)?.line ??
    parsed.noteLine ??
    parsed.lineCount + 1
  );
};

const missingSectionViolation = (
  name: string,
  parsed: ParsedDocument,
): Violation => {
  const present = firstSections(parsed);
  const rank = rankOf(name);
  const presentNames = new Set(present.map((section) => section.name));
  const previous = SECTION_NAMES.slice(0, rank)
    .filter((known) => presentNames.has(known))
    .at(-1);
  const next = SECTION_NAMES.slice(rank + 1).find((known) =>
    presentNames.has(known),
  );
  return violation(
    missingSectionLine(name, parsed),
    null,
    `the section "## ${name}" is missing; add the heading "## ${name}" with its lines ${placeOf(previous, next)}`,
  );
};

const orderViolations = (firsts: readonly Section[]): Violation[] => {
  const breakIndex = firsts.findIndex((section, index) =>
    firsts
      .slice(0, index)
      .some((earlier) => rankOf(earlier.name) > rankOf(section.name)),
  );
  const section = firsts[breakIndex];
  if (breakIndex < 0 || section === undefined) return [];
  const ahead = firsts
    .slice(0, breakIndex)
    .find((earlier) => rankOf(earlier.name) > rankOf(section.name));
  if (ahead === undefined) return [];
  return [
    violation(
      section.line,
      null,
      `"## ${section.name}" comes after "## ${ahead.name}", but the sections go in this order: ${SECTION_ORDER}; move "## ${section.name}" and its lines before "## ${ahead.name}"`,
    ),
  ];
};

const sectionViolations = (parsed: ParsedDocument): Violation[] => {
  const known = parsed.sections.filter((section) =>
    isSectionName(section.name),
  );
  const firsts = firstSections(parsed);
  const unknown = parsed.sections
    .filter(
      (section) =>
        !isSectionName(section.name) && section.name !== NOTE_HEADING,
    )
    .map((section) =>
      violation(
        section.line,
        null,
        `"## ${section.name}" is not a section of a state document, whose sections are ${SECTION_ORDER}; rename the heading to one of them, or move its lines into one of them and delete the heading`,
      ),
    );
  const misplacedNotes = parsed.sections
    .filter((section) => section.name === NOTE_HEADING)
    .map((section) =>
      violation(
        section.line,
        null,
        `"## ${NOTE_HEADING}" must be the last section; move it and its lines to the end of the document`,
      ),
    );
  const repeated = known.flatMap((section) => {
    const first = firsts.find((other) => other.name === section.name);
    return first === undefined || first === section
      ? []
      : [
          violation(
            section.line,
            null,
            `"## ${section.name}" appears a second time, first at line ${first.line}; move its lines into that section and delete this heading`,
          ),
        ];
  });
  const missing = SECTION_NAMES.filter(
    (name) => !firsts.some((section) => section.name === name),
  ).map((name) => missingSectionViolation(name, parsed));
  return [
    ...unknown,
    ...misplacedNotes,
    ...repeated,
    ...missing,
    ...orderViolations(firsts),
  ];
};

const badLineViolation =
  (free: NextIds) =>
  (bad: { line: number; text: string; section: string }): Violation => {
    const letter = letterNamed(bad.text) ?? letterOfSection(bad.section);
    const fix =
      letter === undefined
        ? 'remove the leading "- "'
        : isUsedUp(free[letter])
          ? `${usedUpMessage(letter)}; it matches no item form`
          : `write it in the form "${ITEM_FORMS[letter]}", giving a new item the number on the Next ids line`;
    return violation(
      bad.line,
      null,
      `"${bad.text}" under "## ${bad.section}" is not an item line; ${fix}`,
    );
  };

const itemViolations = (item: Item): Violation[] => {
  const home = LETTER_SECTION[item.letter];
  const misplaced =
    item.section === home
      ? []
      : [
          violation(
            item.line,
            item.id,
            `${item.id} sits under "## ${item.section}", but ${item.letter} items belong under "## ${home}"; move the line there`,
          ),
        ];
  const unboxed =
    item.letter === "c" && item.box === null
      ? [
          violation(
            item.line,
            item.id,
            `criterion ${item.id} has no checkbox; write it in the form "${ITEM_FORMS.c}", as "- [ ] ${item.id} ${item.text}"`,
          ),
        ]
      : [];
  const boxed =
    item.letter !== "c" && item.box !== null
      ? [
          violation(
            item.line,
            item.id,
            `${item.id} has a checkbox, and only criteria under "## ${LETTER_SECTION.c}" take one; write it as "- ${item.id} ${item.text}"`,
          ),
        ]
      : [];
  return [...misplaced, ...unboxed, ...boxed];
};

const freeNumbers = (text: string, parsed: ParsedDocument): NextIds => {
  const highest = highestIds(text);
  const stated = parsed.nextIds ?? highest;
  return {
    c: Math.max(stated.c, highest.c),
    D: Math.max(stated.D, highest.D),
    R: Math.max(stated.R, highest.R),
    S: Math.max(stated.S, highest.S),
  };
};

const repeatedIdViolations = (
  parsed: ParsedDocument,
  free: NextIds,
): Violation[] => {
  const firstById = new Map(
    [...parsed.items].reverse().map((item) => [item.id, item] as const),
  );
  return parsed.items.flatMap((item) => {
    const first = firstById.get(item.id);
    return first === undefined || first === item
      ? []
      : [
          violation(
            item.line,
            item.id,
            isUsedUp(free[item.letter])
              ? `${item.id} is used a second time, first at line ${first.line}; ${usedUpMessage(item.letter)}`
              : `${item.id} is used a second time, first at line ${first.line}; give this item the new id ${item.letter}${free[item.letter]} or higher, or delete it if it repeats line ${first.line}`,
          ),
        ];
  });
};

const conflictViolations = (parsed: ParsedDocument): Violation[] =>
  parsed.conflictLines.map((conflict) =>
    violation(
      conflict.line,
      null,
      `"${conflict.text}" is a merge conflict marker; resolve the conflict by keeping the lines that should stay, then delete this marker line`,
    ),
  );

export const checkStructure = (text: string, slug: string): Violation[] => {
  const parsed = parseDocument(text);
  const free = freeNumbers(text, parsed);
  return inLineOrder([
    ...titleViolations(parsed, slug),
    ...statusViolations(parsed),
    ...sectionViolations(parsed),
    ...parsed.badLines.map(badLineViolation(free)),
    ...parsed.items.flatMap(itemViolations),
    ...repeatedIdViolations(parsed, free),
    ...conflictViolations(parsed),
  ]);
};

const removedLinesOf = (
  text: string,
  parsed: ParsedDocument,
): RemovedLine[] => {
  const start = parsed.noteLine;
  if (start === null) return [];
  return text
    .split("\n")
    .slice(start)
    .flatMap((line, offset) => {
      const id = REMOVED_PATTERN.exec(line)?.[1];
      return id === undefined
        ? []
        : [{ id, line: start + 1 + offset, text: line }];
    });
};

const wordingOf = (text: string): string => {
  const cuts = WORDING_MARKERS.map((marker) => text.indexOf(marker)).filter(
    (index) => index >= 0,
  );
  return (cuts.length === 0 ? text : text.slice(0, Math.min(...cuts))).trim();
};

const hasReason = (text: string, marker: string): boolean => {
  const index = text.indexOf(marker);
  return index >= 0 && text.slice(index + marker.length).trim() !== "";
};

const citedDecisions = (wording: string): string[] => [
  ...new Set(wording.match(DECISION_ID_PATTERN) ?? []),
];

const removalViolations = (
  item: Item,
  after: ParsedDocument,
  removedLines: readonly RemovedLine[],
): Violation[] => {
  const homeName = LETTER_SECTION[item.letter];
  const home =
    firstSections(after).find((section) => section.name === homeName)?.line ??
    missingSectionLine(homeName, after);
  const named = removedLines.some((removed) => removed.id === item.id);
  if (item.letter === "c") {
    return [
      violation(
        home,
        item.id,
        `criterion ${item.id} was removed, but a criterion is never removed: it is struck with [~] and struck: instead; put it back as "- [~] ${item.id} ${wordingOf(item.text)} struck: <reason>"${named ? ` and delete the Removed line for ${item.id}` : ""}`,
      ),
    ];
  }
  if (named) return [];
  return [
    violation(
      home,
      item.id,
      `${item.id} was removed without a reason; add the line "Removed: ${item.id} because <reason>" to the "## ${NOTE_HEADING}" section at the end of the document, adding that section if it is missing, or put ${item.id} back`,
    ),
  ];
};

const removedLineViolations = (
  removedLines: readonly RemovedLine[],
  beforeIds: ReadonlySet<string>,
  after: ParsedDocument,
): Violation[] =>
  removedLines.flatMap((removed) => {
    if (!beforeIds.has(removed.id)) {
      return [
        violation(
          removed.line,
          removed.id,
          `"${removed.text}" names ${removed.id}, but the old version has no ${removed.id}; delete this line`,
        ),
      ];
    }
    const present = after.items.find((item) => item.id === removed.id);
    if (present === undefined) return [];
    return [
      violation(
        removed.line,
        removed.id,
        `"${removed.text}" names ${removed.id}, but ${removed.id} is still in the document at line ${present.line}; delete this line to keep ${removed.id}, or delete the ${removed.id} line to remove it`,
      ),
    ];
  });

const boxViolations = (before: Item, after: Item): Violation[] => {
  if (
    after.box === "x" &&
    before.box !== "x" &&
    !hasReason(after.text, EVIDENCE_MARKER)
  ) {
    return [
      violation(
        after.line,
        after.id,
        `${after.id} was ticked [x] without evidence; add " evidence: <what proves it>" to the end of the line, or set the box back to [${before.box ?? " "}]`,
      ),
    ];
  }
  if (
    after.box === "~" &&
    before.box !== "~" &&
    !hasReason(after.text, STRUCK_MARKER)
  ) {
    return [
      violation(
        after.line,
        after.id,
        `${after.id} was struck [~] without a reason; add " struck: <reason>" to the end of the line`,
      ),
    ];
  }
  if (
    after.box === " " &&
    (before.box === "x" || before.box === "~") &&
    !hasReason(after.text, REOPENED_MARKER)
  ) {
    return [
      violation(
        after.line,
        after.id,
        `${after.id} was reopened to [ ] without a reason; add " reopened: <reason>" to the end of the line`,
      ),
    ];
  }
  return [];
};

const wordingViolations = (
  before: Item,
  after: Item,
  inForce: ReadonlySet<string>,
): Violation[] => {
  const oldWording = wordingOf(before.text);
  const newWording = wordingOf(after.text);
  if (oldWording === newWording) return [];
  const oldCited = new Set(citedDecisions(oldWording));
  const newlyCited = citedDecisions(newWording).filter(
    (id) => !oldCited.has(id),
  );
  if (newlyCited.some((id) => inForce.has(id))) return [];
  if (newlyCited.length === 0) {
    return [
      violation(
        after.line,
        after.id,
        `the wording of ${after.id} changed without citing a new decision; restore the wording "${oldWording}", or add the decision behind the change as a new D item under "## ${LETTER_SECTION.D}" and cite its id in the wording`,
      ),
    ];
  }
  return [
    violation(
      after.line,
      after.id,
      `the wording of ${after.id} changed without a decision in force: it cites ${newlyCited.join(", ")}, which "## ${LETTER_SECTION.D}" does not hold; add the decision there, or restore the wording "${oldWording}"`,
    ),
  ];
};

const criterionViolations = (
  before: ParsedDocument,
  after: ParsedDocument,
): Violation[] => {
  const inForce = new Set(
    after.items
      .filter(
        (item) => item.letter === "D" && item.section === LETTER_SECTION.D,
      )
      .map((item) => item.id),
  );
  const afterById = new Map(
    firstOccurrences(after.items).map((item) => [item.id, item] as const),
  );
  return firstOccurrences(before.items)
    .filter((item) => item.letter === "c")
    .flatMap((item) => {
      const changed = afterById.get(item.id);
      return changed === undefined
        ? []
        : [
            ...boxViolations(item, changed),
            ...wordingViolations(item, changed, inForce),
          ];
    });
};

const newIdViolations = (
  after: ParsedDocument,
  beforeIds: ReadonlySet<string>,
  oldNext: NextIds,
): Violation[] =>
  firstOccurrences(after.items)
    .filter(
      (item) => !beforeIds.has(item.id) && item.number < oldNext[item.letter],
    )
    .map((item) => {
      const lowest = `${item.letter}${oldNext[item.letter]}`;
      return violation(
        item.line,
        item.id,
        isUsedUp(oldNext[item.letter])
          ? `${item.id} is new but its letter has no free number; ${usedUpMessage(item.letter)}`
          : `${item.id} is new but below the Next ids number ${lowest}, so it could reuse an id that was removed; number it ${lowest} or higher`,
      );
    });

const slugViolations = (
  before: ParsedDocument,
  after: ParsedDocument,
): Violation[] =>
  before.slug !== null && after.slug !== null && before.slug !== after.slug
    ? [
        violation(
          1,
          null,
          `the slug of this thread stays ${before.slug}; change the first line back to "# ${before.slug}: ${after.title ?? "<title>"}"`,
        ),
      ]
    : [];

export const checkUpdate = (oldText: string, newText: string): Violation[] => {
  const before = parseDocument(oldText);
  const after = parseDocument(newText);
  const removedLines = removedLinesOf(newText, after);
  const beforeIds = new Set(before.items.map((item) => item.id));
  const afterIds = new Set(after.items.map((item) => item.id));
  const oldNext = before.nextIds ?? highestIds(oldText);
  return inLineOrder([
    ...slugViolations(before, after),
    ...firstOccurrences(before.items)
      .filter((item) => !afterIds.has(item.id))
      .flatMap((item) => removalViolations(item, after, removedLines)),
    ...removedLineViolations(removedLines, beforeIds, after),
    ...criterionViolations(before, after),
    ...newIdViolations(after, beforeIds, oldNext),
  ]);
};

export const checkClose = (oldText: string, newText: string): Violation[] => {
  const before = parseDocument(oldText);
  const after = parseDocument(newText);
  if (after.status?.kind !== "done" || before.status?.kind === "done")
    return [];
  return after.items
    .filter(
      (item) => item.letter === "c" && item.box !== "x" && item.box !== "~",
    )
    .map((item) =>
      violation(
        item.line,
        item.id,
        `${item.id} is still open; before the thread is done, tick it [x] with " evidence: <what proves it>" or strike it [~] with " struck: <reason>"`,
      ),
    );
};

export const checkVersion = (
  oldText: string,
  newText: string,
  slug: string,
): Violation[] => [
  ...checkStructure(newText, slug),
  ...checkUpdate(oldText, newText),
  ...checkClose(oldText, newText),
];

export const removedIds = (oldText: string, newText: string): string[] => {
  const kept = new Set(parseDocument(newText).items.map((item) => item.id));
  return [
    ...new Set(parseDocument(oldText).items.map((item) => item.id)),
  ].filter((id) => !kept.has(id));
};

export const formatViolation = (entry: Violation): string =>
  `line ${entry.line}: ${entry.message}`;
