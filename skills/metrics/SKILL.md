---
name: metrics
description: Use when asked how logbook is performing, or how its threads, tool calls, state-document edits, pickups after a compaction or /clear, or update requests went, answered from logbook's own records in the metrics store with DuckDB.
---

## Where the records are

Logbook writes its metrics to the metrics store. The store root is the value of PLUGIN_METRICS_DIR when it is set and non-empty, otherwise ~/.plugin-metrics. Every block below names the root as the placeholder <root>; replace it with that folder before running a block.

- `<root>/plugin=logbook/catalogue.json` describes every event and field logbook writes.
- `<root>/plugin=logbook/kind=event/repo=<repo>/<run>.jsonl` holds one run's events, one JSON line each.
- `<root>/plugin=logbook/kind=summary/repo=<repo>/<run>.json` holds one run's summary line.

Logbook's run is one thread, named `<slug>.<UTC start as YYYYMMDDTHHMMSSZ>`. Its events are tool.call, doc.edit, doc.commit, doc.request, thread.pickup and thread.handover, and its summary is written when the thread is parked, closed, or held at a session's end.

## Sequence

1. Run `command -v duckdb`. When DuckDB is not found, tell the user to install it with `brew install duckdb` and stop.
2. Read the catalogue at `<root>/plugin=logbook/catalogue.json` first. Its purpose and objectives say what logbook must achieve and which fields measure each objective; pick the fields that answer the question from each field's description and reading.
3. Count each kind's files with the probe block, run with `duckdb -json`. Use glob for this count: read_json fails with No files found when its glob matches nothing, while glob returns 0.

Probe:
```sql
set TimeZone = 'UTC';
select (select count(*) from glob('<root>/plugin=logbook/kind=event/**/*.jsonl')) as events, (select count(*) from glob('<root>/plugin=logbook/kind=summary/**/*.json')) as summaries;
```

4. Define the events and summaries views. For a kind the probe counted at least one file for, take its line from the present block; for a kind with no files, take its line from the empty block.

Present:
```sql
create or replace view events as select * from read_json('<root>/plugin=logbook/kind=event/**/*.jsonl', hive_partitioning = true, union_by_name = true);
create or replace view summaries as select * from read_json('<root>/plugin=logbook/kind=summary/**/*.json', hive_partitioning = true, union_by_name = true);
```

Empty:
```sql
create or replace view events as select null::varchar as plugin, null::varchar as kind, null::varchar as repo, null::varchar as run, null::varchar as parent, null::varchar as session, null::timestamptz as ts, null::varchar as event, null::varchar as tool, null::varchar as outcome, null::varchar as refusal_field, null::varchar[] as rules, null::varchar as source where false;
create or replace view summaries as select null::varchar as plugin, null::varchar as kind, null::varchar as repo, null::varchar as run, null::varchar as parent, null::varchar as session, null::timestamptz as ts, null::varchar as status, null::double as lifetime_seconds where false;
```

5. Run each query with `duckdb -json` in one call whose input is `set TimeZone = 'UTC';`, the two view lines you chose and then the query, because the views last only as long as that call. Use the catalogue's named queries under `queries` when one answers the question, or write your own SQL over the events and summaries views, filtered to `plugin = 'logbook'`.
6. Answer with the figures, the runs in scope and the period they cover, from the earliest to the latest ts read. Answer from the store alone: do not read transcripts. Report what the figures say without judging them as good or bad.

## Rules

- Answer about logbook alone, from logbook's own records.
- Logbook calls no model, so never add usd or tokens for logbook; the context it adds to a session is in context_chars, counted in characters.
- A null value means unknown, never zero.
