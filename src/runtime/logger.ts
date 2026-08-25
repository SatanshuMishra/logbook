export type LogLevel = 'debug' | 'info' | 'warn' | 'error'

const LEVEL_RANK: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3
}

const asLogLevel = (value: unknown): LogLevel | null =>
  value === 'debug' || value === 'info' || value === 'warn' || value === 'error' ? value : null

export const resolveLogLevel = (env: Readonly<Record<string, string | undefined>>): LogLevel =>
  asLogLevel(env.LOGBOOK_LOG_LEVEL) ?? 'warn'

export const createStderrLogger = (
  env: Readonly<Record<string, string | undefined>>
): ((record: Record<string, unknown>) => void) => {
  const threshold = resolveLogLevel(env)
  return (record: Record<string, unknown>): void => {
    const level = asLogLevel(record.level) ?? 'info'
    if (LEVEL_RANK[level] < LEVEL_RANK[threshold]) return
    process.stderr.write(`${JSON.stringify(record)}\n`)
  }
}
