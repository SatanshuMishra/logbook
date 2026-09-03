export const GIT_VERB = 'git'

const GIT_READ_SUBCOMMANDS = new Set([
  'show',
  'ls-tree',
  'cat-file',
  'rev-parse',
  'log',
  'for-each-ref',
  'show-ref',
  'ls-files',
  'rev-list',
  'diff-tree',
  'describe',
  'blame',
  'shortlog',
  'name-rev',
  'count-objects'
])

const GIT_GLOBAL_FLAGS_TAKING_A_VALUE = new Set(['-C', '--namespace', '--git-dir', '--work-tree'])

const GIT_GLOBAL_FLAGS_CARRYING_A_VALUE = ['--namespace=', '--git-dir=', '--work-tree=']

const GIT_GLOBAL_BOOLEAN_FLAGS = new Set([
  '-p',
  '-P',
  '--paginate',
  '--no-pager',
  '--bare',
  '--literal-pathspecs',
  '--glob-pathspecs',
  '--noglob-pathspecs',
  '--icase-pathspecs',
  '--no-replace-objects',
  '--no-optional-locks',
  '--no-lazy-fetch',
  '--no-advice'
])

const GIT_SHARED_READ_FLAGS = ['-z', '-q', '--quiet', '--no-color', '--no-pager']

const GIT_READ_FLAG_PREFIXES = [
  '--abbrev=',
  '--author=',
  '--color=',
  '--contains=',
  '--date=',
  '--decorate=',
  '--format=',
  '--grep=',
  '--max-count=',
  '--pretty=',
  '--since=',
  '--sort=',
  '--until='
]

const GIT_SUBCOMMAND_READ_FLAGS: ReadonlyMap<string, readonly string[]> = new Map([
  [
    'show',
    ['-s', '-p', '--patch', '--no-patch', '--stat', '--numstat', '--shortstat', '--raw', '--name-only', '--name-status', '--oneline', '--abbrev-commit', '--first-parent', '--no-notes']
  ],
  ['ls-tree', ['-d', '-r', '-t', '-l', '--long', '--name-only', '--name-status', '--full-name', '--full-tree', '--abbrev']],
  ['cat-file', ['-p', '-t', '-s', '-e']],
  [
    'rev-parse',
    ['--verify', '--short', '--abbrev-ref', '--symbolic', '--symbolic-full-name', '--show-toplevel', '--git-dir', '--absolute-git-dir', '--is-inside-work-tree', '--is-bare-repository', '--all']
  ],
  [
    'log',
    ['-s', '-p', '--patch', '--oneline', '--stat', '--numstat', '--shortstat', '--raw', '--name-only', '--name-status', '--abbrev-commit', '--no-abbrev-commit', '--graph', '--decorate', '--no-decorate', '--reverse', '--all', '--first-parent', '--no-merges', '--merges', '--follow', '--topo-order', '--date-order']
  ],
  ['for-each-ref', ['--count', '--sort', '--contains', '--merged', '--no-merged', '--points-at']],
  ['show-ref', ['--head', '--heads', '--tags', '--dereference', '--verify', '--hash', '--abbrev']],
  [
    'ls-files',
    ['-c', '--cached', '-o', '--others', '-m', '--modified', '-d', '--deleted', '-s', '--stage', '--exclude-standard', '--full-name', '--error-unmatch']
  ],
  [
    'rev-list',
    ['--count', '--all', '--max-count', '--no-merges', '--merges', '--first-parent', '--reverse', '--objects', '--topo-order', '--date-order']
  ],
  ['diff-tree', ['-r', '-t', '--no-commit-id', '--name-only', '--name-status', '--raw', '--numstat', '--abbrev']],
  ['describe', ['--tags', '--all', '--always', '--long', '--abbrev', '--contains', '--exact-match', '--dirty']],
  ['blame', ['-L', '-l', '-s', '-w', '--porcelain', '--line-porcelain', '--root', '--show-name', '--show-number']],
  ['shortlog', ['-s', '-n', '-e', '--summary', '--numbered', '--email', '--all']],
  ['name-rev', ['--tags', '--all', '--name-only', '--refs']],
  ['count-objects', ['-v', '--verbose', '-H', '--human-readable']]
])

const gitSubcommandIndexOf = (args: readonly string[]): number | null => {
  let index = 0
  while (index < args.length) {
    const arg = args[index] as string
    if (!arg.startsWith('-')) return index
    if (GIT_GLOBAL_FLAGS_TAKING_A_VALUE.has(arg)) {
      index += 2
      continue
    }
    if (GIT_GLOBAL_FLAGS_CARRYING_A_VALUE.some((prefix) => arg.startsWith(prefix))) {
      index += 1
      continue
    }
    if (GIT_GLOBAL_BOOLEAN_FLAGS.has(arg)) {
      index += 1
      continue
    }
    return null
  }
  return null
}

const isAllowedGitReadArgument = (subcommand: string, token: string): boolean => {
  if (!token.startsWith('-')) return true
  if (GIT_SHARED_READ_FLAGS.includes(token)) return true
  if ((GIT_SUBCOMMAND_READ_FLAGS.get(subcommand) ?? []).includes(token)) return true
  return GIT_READ_FLAG_PREFIXES.some((prefix) => token.startsWith(prefix))
}

export const isGitReadSegment = (tokens: readonly string[]): boolean => {
  const args = tokens.slice(1)
  const subcommandAt = gitSubcommandIndexOf(args)
  if (subcommandAt === null) return false
  const subcommand = args[subcommandAt] as string
  if (!GIT_READ_SUBCOMMANDS.has(subcommand)) return false
  return args.slice(subcommandAt + 1).every((token) => isAllowedGitReadArgument(subcommand, token))
}
