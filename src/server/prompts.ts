import { z } from 'zod'
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { completable } from '@modelcontextprotocol/sdk/server/completable.js'
import type { GetPromptResult } from '@modelcontextprotocol/sdk/types.js'
import type { Runtime } from '../runtime/runtime.ts'
import { escapeStored } from '../render/escape.ts'
import { completeThreadIdentifiers } from './completions.ts'

const PREFLIGHT_DEFAULT_TEXT =
  'Call list_threads (or read logbook://roster), present the roster, and wait for me to choose which thread to resume. Once I choose, call resume_thread with that thread id and show me the returned briefing verbatim.'

const preflightMessage = (thread: string | undefined): GetPromptResult => ({
  description: 'Present the resumable roster and let the human choose a thread before resuming it.',
  messages: [
    {
      role: 'user',
      content: {
        type: 'text',
        text:
          thread === undefined
            ? PREFLIGHT_DEFAULT_TEXT
            : `Call resume_thread for "${escapeStored(thread, 'double-quoted')}" and show me the returned briefing verbatim.`
      }
    }
  ]
})

const debriefMessage = (): GetPromptResult => ({
  description: "Hand this session's thread off, recording only what the ledger does not already hold.",
  messages: [
    {
      role: 'user',
      content: {
        type: 'text',
        text: 'Record anything this session established that the ledger does not already hold, find the records the next action needs with search_ledger, then call park_thread with next_step and next_step_records, sending no summary of the session. Read the reply before moving on: park_thread refuses and stores nothing when no thread is being worked or the thread it would write to is gone, terminal, quarantined, or held by another session, and the next step then has to be sent again.'
      }
    }
  ]
})

export const registerPrompts = (server: McpServer, rt: Runtime): void => {
  server.registerPrompt(
    'preflight',
    {
      title: 'Preflight',
      description: 'Present the resumable roster and let the human choose a thread before resuming it.',
      argsSchema: {
        thread: completable(
          z.string().optional().describe('optionally, the id or slug of the thread already chosen to resume'),
          (value, context) => completeThreadIdentifiers(rt, context, value ?? '')
        )
      }
    },
    (args) => preflightMessage(args.thread)
  )

  server.registerPrompt(
    'debrief',
    {
      title: 'Debrief',
      description: "Hand this session's thread off, recording only what the ledger does not already hold."
    },
    () => debriefMessage()
  )
}
