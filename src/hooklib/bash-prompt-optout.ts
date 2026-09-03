import type { Runtime } from '../runtime/runtime.ts'

const MODES_THAT_OPTED_OUT_OF_PROMPTS = new Set(['bypassPermissions'])

export const DISABLE_BASH_GUARD_ENV_KEY = 'CLAUDE_PLUGIN_OPTION_DISABLE_BASH_GUARD'

const OPTION_ON = 'true'

export const permissionModeOptedOutOfPrompts = (permissionMode: unknown): boolean =>
  typeof permissionMode === 'string' && MODES_THAT_OPTED_OUT_OF_PROMPTS.has(permissionMode)

export const bashGuardDisabledByOption = (rt: Runtime): boolean => rt.env[DISABLE_BASH_GUARD_ENV_KEY] === OPTION_ON

export const hasOptedOutOfBashPrompts = (rt: Runtime, permissionMode: unknown): boolean =>
  permissionModeOptedOutOfPrompts(permissionMode) || bashGuardDisabledByOption(rt)
