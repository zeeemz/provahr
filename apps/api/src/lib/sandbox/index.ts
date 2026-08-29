// Sandbox module front door (PLAN.md Phase 7). Production wiring picks
// 'docker'; tests and Phase 8 evaluation fixtures pick 'fake' with an optional
// script. Constructing the DockerExecutor is pure fail-fast: it probe-builds
// the hardened argv for every language and runs assertHardenedArgs ONCE at
// boot (no docker daemon is contacted — live execution is Phase 10 territory).

import { DockerExecutor } from './docker';
import { FakeExecutor, type FakeScript } from './fake';
import type { SandboxExecutor } from './types';

export function createExecutor(kind: 'docker' | 'fake' = 'docker', fakeScript?: FakeScript): SandboxExecutor {
  if (kind === 'fake') return new FakeExecutor(fakeScript);
  return new DockerExecutor();
}

// ─── Re-exports: one import site for the whole sandbox surface ────────────────

export type { CaseOutcome, SandboxCase, SandboxExecutor, SandboxRequest, SandboxResponse } from './types';
export { OUTPUT_CAP_BYTES, PER_CASE_TIMEOUT_MS } from './types';
export { IMAGE_ALLOW_LIST, assertHardenedArgs, buildRunArgs, stdinPayload, stopTimeoutSeconds } from './builder';
export { compareCase, excerpt, EXCERPT_CAP, normalizeStdout, stdinUnsupportedOutcome, summarize } from './judge';
export { DockerExecutor } from './docker';
export { FakeExecutor, type FakeScript } from './fake';
