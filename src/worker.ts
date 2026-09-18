/**
 * The worker thread, and nothing else.
 *
 * ESLint rules are synchronous; loading a `uno.config.ts`, resolving presets
 * and generating CSS are not. `@unocss/eslint-plugin` solves this with a
 * synckit worker, and this file is the same shape for the same reason - the
 * alternative is a rule that cannot look at the project's own configuration,
 * which is the entire point of this plugin.
 *
 * Everything worth testing lives in `session.ts`; importing this module starts
 * a worker, so nothing else should import it.
 */
import { runAsWorker } from 'synckit'
import { planForConfig } from './session'

export type { PlanOptions, PlanRequest } from './session'

runAsWorker(planForConfig)
