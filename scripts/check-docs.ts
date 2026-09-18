/**
 * `pnpm check:docs` - does the README still tell the truth about the package?
 *
 * A README is a pile of assertions written once and trusted forever: an option
 * table that was accurate when the option was added, a Node floor that was
 * accurate before the last bump, a set of exports nobody re-read after a
 * rename. Each check below reads the claim off the page and the fact off the
 * package, and reports when they stop agreeing.
 *
 * Three outcomes, never two. A claim this script cannot evaluate - because the
 * build it would read is not on disk - is `unverifiable`, which is not a pass.
 *
 * Exit codes: 0 clean - 1 at least one error.
 */
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'
import rule from '../src/rule'

type Level = 'pass' | 'error' | 'unverifiable'

interface Finding {
  level: Level
  claim: string
  detail: string
}

const root = join(fileURLToPath(new URL('.', import.meta.url)), '..')
const readme = readFileSync(join(root, 'README.md'), 'utf8')
const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')) as {
  name: string
  engines?: { node?: string }
  peerDependencies?: Record<string, string>
  dependencies?: Record<string, string>
  exports?: Record<string, unknown>
}

const verdict = (ok: boolean, claim: string, passed: string, failed: string): Finding =>
  ({ level: ok ? 'pass' : 'error', claim, detail: ok ? passed : failed })

/** The option names and defaults the README's table states. */
function documentedOptions(): Map<string, string> {
  const options = new Map<string, string>()
  for (const line of readme.split('\n')) {
    const row = /^\|\s*`(\w+)`\s*\|\s*(`[^`]*`|-)\s*\|/.exec(line)
    if (row) options.set(row[1], row[2].replace(/`/g, ''))
  }
  return options
}

function optionChecks(): Finding[] {
  const documented = documentedOptions()
  const schema = (rule.meta?.schema as [{ properties: Record<string, unknown> }])[0]
  const implemented = new Set(Object.keys(schema.properties))
  const defaults = (rule.meta as { defaultOptions?: [Record<string, unknown>] }).defaultOptions?.[0] ?? {}

  const undocumented = [...implemented].filter((name) => !documented.has(name))
  const invented = [...documented.keys()].filter((name) => !implemented.has(name))

  const findings: Finding[] = [
    verdict(
      undocumented.length === 0,
      'every option the rule accepts is in the README table',
      `${implemented.size} options, all documented`,
      `missing from the table: ${undocumented.join(', ')}`,
    ),
    verdict(
      invented.length === 0,
      'every option in the README table exists',
      'no invented options',
      `documented but not accepted: ${invented.join(', ')}`,
    ),
  ]

  const wrong = Object.entries(defaults)
    .filter(([name, value]) => documented.has(name) && documented.get(name) !== String(value))
    .map(([name, value]) => `${name}: table says ${documented.get(name)}, rule says ${String(value)}`)

  findings.push(verdict(
    wrong.length === 0,
    'the defaults in the README table are the rule\'s defaults',
    `${Object.keys(defaults).length} defaults agree`,
    wrong.join('; '),
  ))

  return findings
}

function packageChecks(): Finding[] {
  const findings: Finding[] = []

  const nodeFloor = /Requires Node (\d+) or newer/.exec(readme)?.[1]
  const declaredFloor = /(\d+)/.exec(pkg.engines?.node ?? '')?.[1]
  findings.push(verdict(
    Boolean(nodeFloor) && nodeFloor === declaredFloor,
    'the Node version on the page is the one package.json requires',
    `both say ${declaredFloor}`,
    `README says ${nodeFloor ?? '(nothing)'}, engines.node says ${pkg.engines?.node ?? '(nothing)'}`,
  ))

  const eslintFloor = /ESLint (\d+) or newer/.exec(readme)?.[1]
  const declaredEslint = /(\d+)/.exec(pkg.peerDependencies?.eslint ?? '')?.[1]
  findings.push(verdict(
    Boolean(eslintFloor) && eslintFloor === declaredEslint,
    'the ESLint version on the page is the peer range',
    `both say ${declaredEslint}`,
    `README says ${eslintFloor ?? '(nothing)'}, peerDependencies.eslint says ${pkg.peerDependencies?.eslint ?? '(nothing)'}`,
  ))

  findings.push(verdict(
    readme.includes(`npm install --save-dev ${pkg.name}`),
    'the install command names the package that gets published',
    pkg.name,
    `the README does not install ${pkg.name}`,
  ))

  return findings
}

function buildChecks(): Finding[] {
  const files = Object.values(pkg.exports ?? {})
    .flatMap((entry) => (typeof entry === 'string' ? [entry] : Object.values(entry as Record<string, string>)))
    .filter((file) => file.startsWith('./dist/'))

  if (!existsSync(join(root, 'dist'))) {
    return [{
      level: 'unverifiable',
      claim: 'every path in `exports` is in the build',
      detail: 'dist/ is not on disk, so this could not be checked - run `pnpm build`',
    }]
  }

  const missing = files.filter((file) => !existsSync(join(root, file)))
  return [verdict(
    missing.length === 0,
    'every path in `exports` is in the build',
    `${files.length} paths, all present`,
    `missing from dist/: ${missing.join(', ')}`,
  )]
}

const findings = [...optionChecks(), ...packageChecks(), ...buildChecks()]
const symbol: Record<Level, string> = { pass: 'PASS ', error: 'FAIL ', unverifiable: '?????' }

console.log('\nREADME claims, checked against the package')
console.log('-'.repeat(42))
for (const finding of findings) {
  console.log(`${symbol[finding.level]} ${finding.claim}`)
  console.log(`      ${finding.detail}`)
}

const errors = findings.filter((finding) => finding.level === 'error').length
const unverifiable = findings.filter((finding) => finding.level === 'unverifiable').length
console.log('')
console.log(`${findings.length} claims - ${errors} failed - ${unverifiable} unverifiable`)
console.log('')
process.exit(errors === 0 ? 0 : 1)
