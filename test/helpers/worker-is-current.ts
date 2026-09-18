import { readdirSync, statSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

/**
 * The rule loads its worker from `dist/`, while the suites import `src/`.
 * Running them against a stale build tests code that is no longer in the
 * repository and reports it as a pass - which happened once already, and is
 * exactly the kind of unbacked pass this package exists to prevent.
 */
export function assertWorkerIsCurrent(): void {
  const worker = fileURLToPath(new URL('../../dist/worker.mjs', import.meta.url))
  const source = fileURLToPath(new URL('../../src', import.meta.url))

  const builtAt = statSync(worker).mtimeMs
  const newestSource = readdirSync(source, { recursive: true, encoding: 'utf8' })
    .filter((entry) => entry.endsWith('.ts'))
    .map((entry) => statSync(`${source}/${entry}`).mtimeMs)
    .reduce((newest, at) => Math.max(newest, at), 0)

  if (newestSource > builtAt) {
    throw new Error(
      'dist/worker.mjs is older than src/. This suite would have tested the '
      + 'previous build - run `pnpm build`, or `pnpm test`, which builds first.',
    )
  }
}
