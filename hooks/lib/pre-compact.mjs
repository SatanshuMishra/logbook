import { join } from 'node:path';
import { atomicWrite } from '../../src/util/atomic-write.mjs';
import { projectKey } from '../../src/util/project-key.mjs';
import { serializeRecord } from '../../src/drivers/layout.mjs';

export async function handlePreCompact(ctx) {
  const { input, env, projectDir } = ctx;
  const dataRoot = env.CLAUDE_PLUGIN_DATA;
  if (typeof dataRoot !== 'string' || dataRoot.length === 0) {
    return {};
  }
  const record = {
    event: 'precompact',
    session_id: input.session_id ?? null,
    transcript_path: input.transcript_path ?? null,
    trigger: input.trigger ?? null,
    custom_instructions: input.custom_instructions ?? null,
    recorded_at: new Date().toISOString(),
  };
  const safeTs = record.recorded_at.replace(/[:.]/g, '-');
  const safeSession = String(record.session_id ?? 'unknown').replace(/[^a-zA-Z0-9._-]/g, '-');
  const path = join(dataRoot, projectKey(projectDir), 'checkpoints', `${safeTs}--${safeSession}.json`);
  await atomicWrite(path, serializeRecord(record));
  return {};
}
