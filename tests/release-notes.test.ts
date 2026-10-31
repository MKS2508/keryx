/**
 * Tests for `keryx release-notes`.
 *
 * All styx interaction is faked: the plan is an embedded fixture with the
 * exact JSON shape `bun run release:plan --json` emits, and the deps
 * (runPlan / gitBody / gitFiles / createProvider) are injected fakes. No
 * subprocess, no network, no styx checkout needed.
 *
 * @module tests/release-notes
 */
import { describe, expect, it } from 'vitest';
import {
    planCommits,
    missingTrailersFor,
    detectMissingTrailers,
    buildTrailerPrompt,
    parseTrailerProposals,
    runReleaseNotes,
    renderReleaseNotesMarkdown,
    type IStyxPlan,
    type IReleaseNotesDeps,
} from '../src/release-notes';
import type { IAIProvider } from '../src/types/index';

// ─── fixture: plan JSON exactly as styx emits it ───────────────

const PLAN: IStyxPlan = {
    from: 'v0.0.0-alpha.17',
    to: 'HEAD',
    prerelease: 'alpha',
    trainCurrent: 'v0.0.0-alpha.17',
    trainLevel: 'minor',
    trainNext: 'v0.0.0-alpha.18',
    components: [
        {
            component: 'media-daemon',
            current: '0.1.0',
            level: 'minor',
            next: '0.1.0',
            reasons: [
                {
                    level: 'minor',
                    source: 'commit',
                    detail: 'feat(daemon)!: cambia la firma de ProbeSource — open/close',
                    commit: 'aaa111',
                },
                {
                    level: 'patch',
                    source: 'commit',
                    detail: 'fix(daemon): arregla el hang al cerrar la sesión',
                    commit: 'bbb222',
                },
                {
                    level: 'none',
                    source: 'commit',
                    detail: 'docs(daemon): documenta ProbeSource',
                    commit: 'ccc333',
                },
            ],
            upgradeSteps: [],
        },
        {
            component: 'catalog-svc',
            current: '0.2.0',
            level: 'patch',
            next: '0.2.1',
            reasons: [
                {
                    level: 'patch',
                    source: 'commit',
                    detail: 'sec(catalog): endurece la verificación de tokens',
                    commit: 'ddd444',
                },
                { level: 'patch', source: 'detector', detail: 'repin: bun.lock' },
            ],
            upgradeSteps: [],
        },
    ],
    errors: [],
};

/** Commit bodies as `git log -1 --format=%B` would return them. */
const BODIES = new Map<string, string>([
    ['aaa111', 'feat(daemon)!: cambia la firma de ProbeSource — open/close\n\nOpen ahora\nrecibe un alocador.\n'],
    // Already carries its Release-Note → not a candidate
    ['bbb222', 'fix(daemon): arregla el hang al cerrar la sesión\n\nCierra el\nrecurso antes de esperar.\n\nRelease-Note: el daemon ya no se cuelga al cerrar sesión\n'],
    ['ccc333', 'docs(daemon): documenta ProbeSource\n'],
    ['ddd444', 'sec(catalog): endurece la verificación de tokens\n'],
]);

const FILES = new Map<string, string[]>([
    ['aaa111', ['native/zig/media-daemon/probe.zig']],
    ['bbb222', ['native/zig/media-daemon/session.zig']],
    ['ccc333', ['docs/references/probe.md']],
    ['ddd444', ['apps/catalog-svc/src/tokens.ts']],
]);

// ─── fakes ─────────────────────────────────────────────────────

const AI_RESPONSE = `### Trailer Proposal #1
sha: aaa111
Release-Note: el daemon expone el ciclo de vida de las fuentes de sonda
Breaking: la firma de ProbeSource.open cambia para recibir un alocador
Security: no aplica pero el modelo lo intenta

### Trailer Proposal #2
sha: ddd444
Security: verifica la firma de los tokens de capability antes de aceptarlos

### Trailer Proposal #3
sha: fff999
Release-Note: sha que no está entre los candidatos`;

function mockProvider(response: string): IAIProvider {
    return {
        name: 'Mock Provider',
        id: 'gemini-sdk',
        model: 'mock-1',
        generate: async () => response,
        isAvailable: () => true,
    };
}

function makeDeps(opts: {
    plan?: IStyxPlan | Error;
    response?: string | Error;
    seenPlanArgs?: string[];
} = {}): IReleaseNotesDeps {
    return {
        runPlan: (_root, extraArgs) => {
            opts.seenPlanArgs?.push(...extraArgs);
            if (opts.plan instanceof Error) throw opts.plan;
            return JSON.stringify(opts.plan ?? PLAN, null, 2);
        },
        gitBody: (_root, sha) => BODIES.get(sha) ?? '',
        gitFiles: (_root, sha) => FILES.get(sha) ?? [],
        createProvider: () => mockProvider(
            opts.response instanceof Error ? (() => { throw opts.response!; })() : (opts.response ?? AI_RESPONSE),
        ),
        // v3.1 hybrid pipeline: tests opt out of jev by default (return
        // null). The new jev-active test passes a stub via makeDeps.
        createDecisionProvider: () => null,
    };
}

// ─── pure detection ────────────────────────────────────────────

describe('planCommits', () => {
    it('collects commit-sourced reasons deduped by sha', () => {
        const commits = planCommits(PLAN);
        const shas = commits.map(c => c.sha);
        expect(shas).toEqual(['aaa111', 'bbb222', 'ccc333', 'ddd444']);
        expect(new Set(shas).size).toBe(shas.length);
    });

    it('ignores detector reasons without a commit', () => {
        const commits = planCommits(PLAN);
        expect(commits.every(c => c.sha.length > 0)).toBe(true);
    });

    it('keeps the max level across components for the same sha', () => {
        const plan: IStyxPlan = {
            ...PLAN,
            components: [
                {
                    component: 'a',
                    current: '0', level: 'patch', next: '0.0.1', upgradeSteps: [],
                    reasons: [{ level: 'patch', source: 'commit', detail: 'feat: x', commit: 'abc' }],
                },
                {
                    component: 'b',
                    current: '0', level: 'minor', next: '0.1.0', upgradeSteps: [],
                    reasons: [{ level: 'minor', source: 'commit', detail: 'feat: x', commit: 'abc' }],
                },
            ],
        };
        expect(planCommits(plan)[0]!.level).toBe('minor');
    });
});

describe('missingTrailersFor', () => {
    it('feat without trailers wants Release-Note', () => {
        expect(missingTrailersFor({ subject: 'feat(x): a', existing: [], files: [] }))
            .toEqual(['Release-Note']);
    });

    it('bang wants Breaking on top of Release-Note', () => {
        expect(missingTrailersFor({ subject: 'feat(x)!: a', existing: [], files: [] }))
            .toEqual(['Release-Note', 'Breaking']);
    });

    it('existing trailers are respected', () => {
        expect(missingTrailersFor({
            subject: 'feat(x)!: a',
            existing: [
                { key: 'Release-Note', value: 'y' },
                { key: 'Breaking', value: 'z' },
            ],
            files: [],
        })).toEqual([]);
    });

    it('sec wants Security', () => {
        expect(missingTrailersFor({ subject: 'sec(x): a', existing: [], files: [] }))
            .toEqual(['Security']);
    });

    it('added migration .sql wants Upgrade-Step', () => {
        expect(missingTrailersFor({
            subject: 'chore(db): migra',
            existing: [],
            files: ['apps/catalog-svc/migrations/0007.sql'],
        })).toEqual(['Upgrade-Step']);
    });

    it('non-SQL or nested-deeper files under migrations/ do not count', () => {
        expect(missingTrailersFor({
            subject: 'chore(db): toca migraciones',
            existing: [],
            files: ['apps/catalog-svc/migrations/notes.md', 'db/migrations/sub/dir.sql'],
        })).toEqual([]);
    });

    it('non-CC and quiet types want nothing', () => {
        expect(missingTrailersFor({ subject: 'docs: readme', existing: [], files: [] })).toEqual([]);
        expect(missingTrailersFor({ subject: 'no conventional subject', existing: [], files: [] })).toEqual([]);
    });
});

describe('detectMissingTrailers', () => {
    it('flags exactly the deserving commits of the fixture', () => {
        const candidates = detectMissingTrailers(PLAN, BODIES, FILES);
        expect(candidates.map(c => c.sha)).toEqual(['aaa111', 'ddd444']);
        expect(candidates[0]!.missing).toEqual(['Release-Note', 'Breaking']);
        expect(candidates[0]!.component).toBe('media-daemon');
        expect(candidates[0]!.level).toBe('minor');
        expect(candidates[1]!.missing).toEqual(['Security']);
    });
});

// ─── prompt + response parsing ─────────────────────────────────

describe('buildTrailerPrompt', () => {
    it('includes shas, subjects and missing keys', () => {
        const candidates = detectMissingTrailers(PLAN, BODIES, FILES);
        const prompt = buildTrailerPrompt(candidates, BODIES);
        expect(prompt).toContain('sha: aaa111');
        expect(prompt).toContain('feat(daemon)!: cambia la firma de ProbeSource');
        expect(prompt).toContain('Release-Note, Breaking');
        expect(prompt).toContain('nivel del plan: minor');
    });
});

describe('parseTrailerProposals', () => {
    it('parses sections with sha + known trailer lines', () => {
        const parsed = parseTrailerProposals(AI_RESPONSE);
        expect(parsed).toHaveLength(3);
        expect(parsed[0]).toEqual({
            sha: 'aaa111',
            trailers: [
                { key: 'Release-Note', value: 'el daemon expone el ciclo de vida de las fuentes de sonda' },
                { key: 'Breaking', value: 'la firma de ProbeSource.open cambia para recibir un alocador' },
                // "Security: no aplica..." is a known key — parser keeps it;
                // the run filters it against the missing list
                { key: 'Security', value: 'no aplica pero el modelo lo intenta' },
            ],
        });
        expect(parsed[1]!.sha).toBe('ddd444');
    });

    it('returns empty for an unparseable response', () => {
        expect(parseTrailerProposals('lorem ipsum sin formato')).toEqual([]);
    });
});

// ─── orchestration (faked deps) ────────────────────────────────

describe('runReleaseNotes', () => {
    it('errors with CONFIG_ERROR when no styx root is configured', async () => {
        const result = await runReleaseNotes({ cwd: '/tmp' }, makeDeps());
        expect(result.ok).toBe(false);
        if (!result.ok) {
            expect(result.error.type).toBe('CONFIG_ERROR');
            expect(result.error.message).toContain('--styx-root');
        }
    });

    it('errors with PLAN_ERROR when release:plan fails', async () => {
        const result = await runReleaseNotes(
            { styxRoot: '/tmp/fake-styx' },
            makeDeps({ plan: new Error('exit 1') }),
        );
        expect(result.ok).toBe(false);
        if (!result.ok) expect(result.error.type).toBe('PLAN_ERROR');
    });

    it('errors with PLAN_ERROR on non-JSON stdout', async () => {
        const deps = makeDeps();
        deps.runPlan = () => 'not json at all';
        const result = await runReleaseNotes({ styxRoot: '/tmp/fake-styx' }, deps);
        expect(result.ok).toBe(false);
        if (!result.ok) expect(result.error.type).toBe('PLAN_ERROR');
    });

    it('errors with PROVIDER_ERROR when the provider throws', async () => {
        const result = await runReleaseNotes(
            { styxRoot: '/tmp/fake-styx' },
            makeDeps({ response: new Error('rate limit') }),
        );
        expect(result.ok).toBe(false);
        if (!result.ok) expect(result.error.type).toBe('PROVIDER_ERROR');
    });

    it('proposes only the trailers each commit is missing', async () => {
        const result = await runReleaseNotes(
            { styxRoot: '/tmp/fake-styx' },
            makeDeps(),
        );
        expect(result.ok).toBe(true);
        if (!result.ok) return;
        const report = result.value;

        expect(report.analyzed).toBe(4);
        expect(report.candidates.map(c => c.sha)).toEqual(['aaa111', 'ddd444']);
        expect(report.proposals).toHaveLength(2);

        const first = report.proposals[0]!;
        expect(first.candidate.sha).toBe('aaa111');
        // Security was proposed by the AI but is NOT missing → filtered out
        expect(first.trailers.map(t => t.key)).toEqual(['Release-Note', 'Breaking']);

        const second = report.proposals[1]!;
        expect(second.candidate.sha).toBe('ddd444');
        expect(second.trailers).toEqual([
            { key: 'Security', value: 'verifica la firma de los tokens de capability antes de aceptarlos' },
        ]);

        // fff999 is not among the candidates → ignored entirely
        expect(report.proposals.some(p => p.candidate.sha === 'fff999')).toBe(false);
        expect(report.withoutProposal).toEqual([]);
        expect(report.providerName).toBe('Mock Provider');
    });

    it('records candidates the provider left without a proposal', async () => {
        const result = await runReleaseNotes(
            { styxRoot: '/tmp/fake-styx' },
            makeDeps({ response: '### Trailer Proposal #1\nsha: ddd444\nSecurity: algo\n' }),
        );
        expect(result.ok).toBe(true);
        if (!result.ok) return;
        expect(result.value.proposals.map(p => p.candidate.sha)).toEqual(['ddd444']);
        expect(result.value.withoutProposal.map(c => c.sha)).toEqual(['aaa111']);
    });

    it('passes --from/--to/--prerelease through to release:plan', async () => {
        const seen: string[] = [];
        await runReleaseNotes(
            { styxRoot: '/tmp/fake-styx', from: 'v0.0.0-alpha.17', to: 'HEAD', prerelease: 'alpha' },
            makeDeps({ seenPlanArgs: seen }),
        );
        expect(seen).toEqual(['--from', 'v0.0.0-alpha.17', '--to', 'HEAD', '--prerelease', 'alpha']);
    });

    it('reports zero candidates when every commit carries its trailers', async () => {
        const plan: IStyxPlan = {
            ...PLAN,
            components: [{
                ...PLAN.components[0]!,
                reasons: [{
                    level: 'patch',
                    source: 'commit',
                    detail: 'fix(daemon): arregla el hang al cerrar la sesión',
                    commit: 'bbb222',
                }],
            }],
        };
        const result = await runReleaseNotes(
            { styxRoot: '/tmp/fake-styx' },
            makeDeps({ plan }),
        );
        expect(result.ok).toBe(true);
        if (!result.ok) return;
        expect(result.value.candidates).toEqual([]);
        expect(result.value.proposals).toEqual([]);
    });
});

describe('renderReleaseNotesMarkdown', () => {
    it('renders headers, trailers and the never-writes footer', async () => {
        const result = await runReleaseNotes(
            { styxRoot: '/tmp/fake-styx' },
            makeDeps(),
        );
        expect(result.ok).toBe(true);
        if (!result.ok) return;
        const md = renderReleaseNotesMarkdown(result.value);
        expect(md).toContain('# Keryx — release notes (dry run)');
        expect(md).toContain('## aaa111 ');
        expect(md).toContain('Faltan: Release-Note, Breaking');
        expect(md).toContain('Breaking: la firma de ProbeSource.open cambia para recibir un alocador');
        expect(md).toContain('keryx no escribe nada');
    });
});
