/**
 * `pnpm release` - bump, tag, push, and let the workflow publish.
 *
 * The claim it makes falsifiable: **"this version is safe to publish."**
 *
 * The tag is the trigger. Pushing one starts a workflow that puts a tarball on
 * a public registry under a version number that can never be reused, so every
 * check below costs seconds here and costs a dead version if it runs afterwards
 * instead.
 *
 * What this deliberately does not do is publish. `pnpm publish` from a laptop
 * cannot produce a provenance attestation - npm only generates one inside a
 * supported CI provider - so a local publish would quietly ship a version that
 * is weaker than every other version, and nothing downstream would say so. The
 * tag is the handoff.
 *
 * Exit codes: 0 pushed - 1 a check or a step failed - 2 bad usage.
 */
import { execSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'

const HELP = `
pnpm release [<bump>] [--dry-run] [--preid <id>] [--skip-checks]

Bumps the version, commits it, tags it, and pushes - which is what starts the
release workflow. Nothing is published from here; the tag does that.

  <bump>         patch (default), minor, major, prepatch, preminor, premajor,
                 prerelease, or an exact version like 1.2.3
  --preid        prerelease identifier, e.g. --preid rc with prerelease
  --dry-run      run every check and print the plan, change nothing
  --skip-checks  skip the repository checks - for a release you already verified

exit 0 = pushed, 1 = a check or a step failed, 2 = bad usage
`

const BUMPS = ['patch', 'minor', 'major', 'prepatch', 'preminor', 'premajor', 'prerelease']
const EXACT_VERSION = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/
const EXIT = { ok: 0, failed: 1, usage: 2 } as const

type Level = 'pass' | 'error' | 'warning' | 'unverifiable'

interface Finding {
  level: Level
  claim: string
  detail: string
}

const root = join(fileURLToPath(new URL('.', import.meta.url)), '..')

/** Run a command for its output, or `null` when it fails - never throwing. */
function capture(command: string): string | null {
  try {
    return execSync(command, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim()
  } catch {
    return null
  }
}

/** Run a command for its exit code, showing the user what it printed. */
function run(command: string): number {
  try {
    execSync(command, { cwd: root, stdio: 'inherit' })
    return 0
  } catch (err) {
    return (err as { status?: number }).status ?? 1
  }
}

const verdict = (ok: boolean, claim: string, passed: string, failed: string): Finding =>
  ({ level: ok ? 'pass' : 'error', claim, detail: ok ? passed : failed })

/**
 * Asked of the remote rather than written down here. A constant would be one
 * more fact about this repository that can quietly stop being true.
 */
function defaultBranch(): string {
  const head = capture('git symbolic-ref --short refs/remotes/origin/HEAD')
  return head ? head.replace(/^origin\//, '') : 'main'
}

/** 404 from the registry is the answer we want: nobody has taken this version. */
async function versionIsFree(name: string, version: string): Promise<Finding> {
  const claim = `${version} is not already on the registry`
  try {
    const response = await fetch(`https://registry.npmjs.org/${name}/${version}`)
    if (response.status === 404) return { level: 'pass', claim, detail: 'the registry has never seen it' }
    if (response.ok) {
      return {
        level: 'error',
        claim,
        detail: 'already published - npm never lets a version number be reused, so pick another',
      }
    }
    return { level: 'unverifiable', claim, detail: `the registry answered ${response.status}` }
  } catch (err) {
    // Being offline is a reason the check could not run, which is not the same
    // as the version being free and must not be reported as one.
    return { level: 'unverifiable', claim, detail: `could not reach the registry: ${(err as Error).message}` }
  }
}

async function preflight(pkg: { name: string }, target: string, skipChecks: boolean): Promise<Finding[]> {
  const findings: Finding[] = []
  const main = defaultBranch()

  const branch = capture('git rev-parse --abbrev-ref HEAD')
  findings.push(verdict(
    branch === main,
    `the release is cut from ${main}`,
    `on ${main}`,
    `on ${branch ?? '(unknown)'} - the workflow builds what the tag points at, not what you meant`,
  ))

  findings.push(verdict(
    capture('git status --porcelain') === '',
    'the working tree is clean',
    'nothing uncommitted',
    'uncommitted changes would not be in the tag, and `pnpm version` refuses to run anyway',
  ))

  // Fetched rather than assumed: a stale remote ref makes the next check pass
  // by looking at yesterday's answer.
  capture('git fetch origin --quiet')
  const local = capture('git rev-parse HEAD')
  const remote = capture(`git rev-parse origin/${main}`)
  if (!local || !remote) {
    // Either ref failing to resolve - an unborn branch, a remote that was never
    // fetched - means this was not checked. Reporting "in sync" here would be a
    // pass for a comparison that never happened, which is the exact failure
    // this script exists to prevent elsewhere.
    findings.push({
      level: 'unverifiable',
      claim: `this commit is the one origin/${main} has`,
      detail: !local
        ? 'HEAD does not resolve yet - nothing is committed on this branch'
        : `origin/${main} does not resolve - the branch has never been pushed or fetched`,
    })
  } else if (local !== remote) {
    const behind = capture(`git rev-list --count HEAD..origin/${main}`)
    const ahead = capture(`git rev-list --count origin/${main}..HEAD`)
    findings.push({
      level: behind !== '0' ? 'error' : 'warning',
      claim: `this commit is the one origin/${main} has`,
      detail: behind !== '0'
        ? `${behind} commit(s) behind origin - pull before releasing, or the tag skips them`
        : `${ahead} commit(s) ahead of origin, and they will be pushed with this release`,
    })
  } else {
    findings.push({ level: 'pass', claim: `this commit is the one origin/${main} has`, detail: 'in sync' })
  }

  findings.push(verdict(
    capture(`git tag -l v${target}`) === '',
    `the tag v${target} does not exist yet`,
    'free',
    `v${target} is already a tag here - delete it deliberately or choose another version`,
  ))

  findings.push(await versionIsFree(pkg.name, target))

  if (skipChecks) {
    findings.push({
      level: 'unverifiable',
      claim: 'the repository checks pass',
      detail: 'skipped by --skip-checks, so nothing here knows whether they do',
    })
  } else {
    // The same sequence the release workflow runs, in the same order, so a
    // failure shows up here rather than after the tag is public.
    const checks = 'pnpm typecheck && pnpm build && pnpm test:unit && pnpm smoke && pnpm check:docs'
    const code = run(checks)
    findings.push(verdict(
      code === 0,
      'typecheck, build, tests, smoke and docs all pass',
      'the full sequence exited 0',
      `the sequence exited ${code}`,
    ))
  }

  return findings
}

function report(title: string, findings: Finding[]): void {
  const symbol: Record<Level, string> = { pass: 'PASS ', error: 'FAIL ', warning: 'WARN ', unverifiable: '?????' }
  console.log(`\n${title}`)
  console.log('-'.repeat(title.length))
  for (const finding of findings) {
    console.log(`${symbol[finding.level]} ${finding.claim}`)
    console.log(`      ${finding.detail}`)
  }
  console.log('')
}

async function main(): Promise<void> {
  const args = process.argv.slice(2)
  if (args.includes('--help') || args.includes('-h')) {
    console.log(HELP)
    process.exit(EXIT.ok)
  }

  const dryRun = args.includes('--dry-run')
  const skipChecks = args.includes('--skip-checks')
  const preid = args[args.indexOf('--preid') + 1]
  const positional = args.filter((arg, index) =>
    !arg.startsWith('--') && args[index - 1] !== '--preid')
  if (positional.length > 1) {
    console.log(HELP)
    process.exit(EXIT.usage)
  }

  const spec = positional[0] ?? 'patch'
  if (!BUMPS.includes(spec) && !EXACT_VERSION.test(spec)) {
    console.log(HELP)
    process.exit(EXIT.usage)
  }

  const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')) as { name: string, version: string }

  // Asked of pnpm rather than computed here: a second implementation of semver
  // arithmetic is a second thing that can disagree with the one that runs.
  const preidFlag = args.includes('--preid') ? ` --preid ${preid}` : ''
  const dryOutput = capture(`pnpm version ${spec}${preidFlag} --dry-run --no-git-checks`)
  const target = dryOutput ? /→\s*(\S+)\s*$/m.exec(dryOutput)?.[1] : undefined
  if (!target) {
    console.error('could not work out the target version.')
    process.exit(EXIT.failed)
  }

  console.log(`\n${pkg.name} ${pkg.version} → ${target}${dryRun ? '  (dry run)' : ''}`)

  const findings = await preflight(pkg, target, skipChecks)
  report(`Before releasing ${pkg.name}@${target}`, findings)

  if (findings.some((finding) => finding.level === 'error')) {
    console.log('Nothing was changed. Fix the above and run it again.\n')
    process.exit(EXIT.failed)
  }

  if (dryRun) {
    console.log('Would then run:')
    console.log(`  pnpm version ${spec}${preidFlag}`)
    console.log('  git push --follow-tags')
    console.log('\nNothing was changed.\n')
    process.exit(EXIT.ok)
  }

  if (run(`pnpm version ${spec}${preidFlag} --message "chore(release): v%s"`) !== 0) {
    process.exit(EXIT.failed)
  }

  // `--follow-tags` pushes the commit and the annotated tag together. Two
  // pushes can leave the tag behind on a failure, and a tag that never arrived
  // is a release that silently did not happen.
  if (run('git push --follow-tags') !== 0) {
    console.error(
      '\nThe version is committed and tagged locally but the push failed.\n'
      + 'Fix the remote and run:  git push --follow-tags\n',
    )
    process.exit(EXIT.failed)
  }

  console.log(`\nPushed v${target}. The release workflow publishes it from here.`)
  console.log('Watch it: https://github.com/AndrewBogdanovTSS/eslint-unocss-normalize-classes/actions\n')
  process.exit(EXIT.ok)
}

await main()
