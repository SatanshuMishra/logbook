import type { Runtime } from '../runtime/runtime.ts'
import { layoutFor } from '../store/layout.ts'
import { readPointer } from '../domain/pointer.ts'
import { readProjectHead } from '../store/git.ts'
import { openStore } from '../store/records.ts'

const COMMIT_SHAPED_PATTERN = /\bgit\s+(commit|merge|rebase|cherry-pick|revert|pull|am)\b/
const COMMIT_NOTE_ACTOR = 'logbook-post-tool-use'

export const isCommitShapedCommand = (toolName: unknown, command: unknown): boolean =>
  toolName === 'Bash' && typeof command === 'string' && COMMIT_SHAPED_PATTERN.test(command)

export const noteProjectCommit = (rt: Runtime, cwd: string, sessionId: string): void => {
  const layout = layoutFor(rt, cwd)
  if (!layout.ok) return

  const pointerRead = readPointer(rt, layout.value)
  if (pointerRead.kind !== 'pointer' || pointerRead.value.session_id !== sessionId) return

  const sha = readProjectHead(rt, cwd)
  if (sha === null) {
    rt.log({ level: 'warn', event: 'post-tool-use.head-sha-unavailable', cwd })
    return
  }

  const opened = openStore(rt, cwd)
  if (!opened.ok) {
    rt.log({ level: 'warn', event: 'post-tool-use.store-unavailable', message: opened.message })
    return
  }

  const result = opened.value.commit(
    [
      {
        kind: 'session',
        record: {
          id: rt.ulid(),
          thread_id: pointerRead.value.thread_id,
          actor: COMMIT_NOTE_ACTOR,
          body: `Recorded commit ${sha}.`,
          created_at: rt.now()
        }
      }
    ],
    `logbook: note commit ${sha}`
  )
  if (!result.ok) {
    rt.log({ level: 'warn', event: 'post-tool-use.commit-note-failed', reason: result.reason, detail: result.detail })
  }
}
