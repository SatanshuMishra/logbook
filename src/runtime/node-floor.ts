export const NODE_FLOOR_MAJOR = 22
export const NODE_FLOOR_MINOR = 18

const REQUIRED_LABEL = `${NODE_FLOOR_MAJOR}.${NODE_FLOOR_MINOR}`
const VERSION_PATTERN = /^(\d+)\.(\d+)(?:\.\d+)?$/

type ParsedVersion = { major: number; minor: number }

const parseVersion = (version: string): ParsedVersion | null => {
  const match = VERSION_PATTERN.exec(version)
  if (match === null) return null
  const majorText = match[1]
  const minorText = match[2]
  if (majorText === undefined || minorText === undefined) return null
  const major = Number.parseInt(majorText, 10)
  const minor = Number.parseInt(minorText, 10)
  if (!Number.isInteger(major) || !Number.isInteger(minor)) return null
  return { major, minor }
}

const meetsFloor = (parsed: ParsedVersion): boolean =>
  parsed.major > NODE_FLOOR_MAJOR || (parsed.major === NODE_FLOOR_MAJOR && parsed.minor >= NODE_FLOOR_MINOR)

const unparseableMessage = (version: string): string =>
  `logbook requires Node.js ${REQUIRED_LABEL} or newer but could not parse the running version string "${version}"; this plugin ships TypeScript source and Node runs it via native type stripping, which is unavailable below Node ${REQUIRED_LABEL}`

const belowFloorMessage = (version: string): string =>
  `logbook requires Node.js ${REQUIRED_LABEL} or newer but found ${version}; this plugin ships TypeScript source and Node runs it via native type stripping, which is unavailable below Node ${REQUIRED_LABEL}`

export const nodeFloorFailure = (version: string): string | null => {
  const parsed = parseVersion(version)
  if (parsed === null) return unparseableMessage(version)
  return meetsFloor(parsed) ? null : belowFloorMessage(version)
}
