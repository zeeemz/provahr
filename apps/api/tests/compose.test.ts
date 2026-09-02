import { describe, it, expect, vi, beforeEach } from 'vitest';
import { composeSystem, MAIN_PROMPT_HEADER, JOB_PROMPT_HEADER } from '../src/prompts/compose';
import { JD_SYSTEM_PROMPT } from '../src/prompts/jd';

// The second half of this file (runJdGeneration composition) mocks prisma /
// lib/llm / lib/urlFetch at the file level; the pure composeSystem suites
// below never import those modules, so the mocks are inert for them.

// ─── Pure composition (founder requirement: main → job → base) ────────────────

describe('composeSystem', () => {
  it('appends main, then job, then the base prompt (base stays LAST)', () => {
    const out = composeSystem('BASE CONTRACT', 'MAIN RULES', 'ROLE RULES');
    const mainAt = out.indexOf('MAIN RULES');
    const jobAt = out.indexOf('ROLE RULES');
    const baseAt = out.indexOf('BASE CONTRACT');
    expect(mainAt).toBeGreaterThanOrEqual(0);
    expect(jobAt).toBeGreaterThan(mainAt);
    expect(baseAt).toBeGreaterThan(jobAt);
    // The exact assembly: headered tiers, blank-line separated, base verbatim.
    expect(out).toBe(
      [`${MAIN_PROMPT_HEADER}\nMAIN RULES`, `${JOB_PROMPT_HEADER}\nROLE RULES`, 'BASE CONTRACT'].join('\n\n'),
    );
  });

  it('renders each tier under its own header', () => {
    const out = composeSystem('BASE', 'MAIN RULES', 'ROLE RULES');
    expect(out).toContain(MAIN_PROMPT_HEADER);
    expect(out).toContain(JOB_PROMPT_HEADER);
    expect(out.indexOf(MAIN_PROMPT_HEADER)).toBeLessThan(out.indexOf(JOB_PROMPT_HEADER));
  });

  it('returns exactly the base when both tiers are null', () => {
    expect(composeSystem('BASE', null, null)).toBe('BASE');
    expect(composeSystem('BASE', undefined, undefined)).toBe('BASE');
  });

  it('skips empty/whitespace tiers entirely — no orphan headers', () => {
    expect(composeSystem('BASE', '   \n\t ', 'ROLE RULES')).toBe(
      `${JOB_PROMPT_HEADER}\nROLE RULES\n\nBASE`,
    );
    expect(composeSystem('BASE', '', '')).toBe('BASE');
    // A whitespace-only tier must not leave its header behind.
    expect(composeSystem('BASE', '  ', null)).not.toContain(MAIN_PROMPT_HEADER);
    expect(composeSystem('BASE', null, ' \n ')).not.toContain(JOB_PROMPT_HEADER);
  });

  it('trims surrounding whitespace from a tier body but keeps its content', () => {
    const out = composeSystem('BASE', '  MAIN RULES  \n', null);
    expect(out).toBe(`${MAIN_PROMPT_HEADER}\nMAIN RULES\n\nBASE`);
  });

  it('keeps the real JD base prompt byte-for-byte as the suffix', () => {
    const out = composeSystem(JD_SYSTEM_PROMPT, 'MAIN', 'ROLE');
    expect(out.endsWith(JD_SYSTEM_PROMPT)).toBe(true);
  });
});

// ─── Call-site composition: runJdGeneration threads both tiers ────────────────
//
// Cheapest existing seam: jd.service's collaborators (prisma, getActiveAdapter,
// fetchPageText) are plain module imports, so mocking them lets the worker fn
// run end-to-end against a capturing fake adapter — proving the composed
// system prompt (headers, both tiers, base last) actually reaches adapter.chat.

vi.mock('../src/prisma', () => ({
  prisma: {
    job: {
      findUnique: vi.fn(),
      update: vi.fn(),
    },
    platformSettings: {
      findUnique: vi.fn(),
      upsert: vi.fn(),
    },
  },
}));
vi.mock('../src/lib/llm', () => ({
  getActiveAdapter: vi.fn(),
}));
vi.mock('../src/lib/urlFetch', () => ({
  fetchPageText: vi.fn(),
}));

import { prisma } from '../src/prisma';
import { getActiveAdapter } from '../src/lib/llm';
import { runJdGeneration } from '../src/modules/jobs/jd.service';
import { resetMainPromptCacheForTests } from '../src/modules/platform/settings.service';

const chat = vi.fn();

function jobRow(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: 'job-1',
    companyId: 'co-1',
    jdStatus: 'JD_DRAFTING',
    jdSourceUrls: [],
    jdScreenshots: null,
    jdNotes: null,
    jdFetchedText: null,
    jobPrompt: null,
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  resetMainPromptCacheForTests();
  vi.mocked(prisma.job.update).mockResolvedValue({} as never);
  vi.mocked(getActiveAdapter).mockResolvedValue({
    adapter: {
      chat,
      // only chat is exercised by runJdGeneration
    },
  } as never);
});

describe('runJdGeneration — two-tier prompt composition at the LLM call site', () => {
  it('sends MAIN + JOB tiers ahead of the base JD system prompt', async () => {
    vi.mocked(prisma.platformSettings.findUnique).mockResolvedValue({ mainPrompt: 'PLATFORM RULES' } as never);
    vi.mocked(prisma.job.findUnique).mockResolvedValue(jobRow({ jobPrompt: 'ROLE RULES' }) as never);
    chat.mockResolvedValue({
      text: JSON.stringify({ title: 'Staff Engineer', description: 'x'.repeat(220) }),
      model: 'test-model',
    });

    await runJdGeneration('job-1');

    expect(chat).toHaveBeenCalledTimes(1);
    const system = chat.mock.calls[0]![0]!.system as string;
    expect(system).toContain(MAIN_PROMPT_HEADER);
    expect(system).toContain('PLATFORM RULES');
    expect(system).toContain(JOB_PROMPT_HEADER);
    expect(system).toContain('ROLE RULES');
    expect(system.endsWith(JD_SYSTEM_PROMPT)).toBe(true); // base contract stays last
  });

  it('sends the bare base prompt when neither tier is configured', async () => {
    vi.mocked(prisma.platformSettings.findUnique).mockResolvedValue(null as never);
    vi.mocked(prisma.job.findUnique).mockResolvedValue(jobRow() as never);
    chat.mockResolvedValue({
      text: JSON.stringify({ title: 'Staff Engineer', description: 'x'.repeat(220) }),
      model: 'test-model',
    });

    await runJdGeneration('job-1');

    expect(chat.mock.calls[0]![0]!.system).toBe(JD_SYSTEM_PROMPT);
  });
});
