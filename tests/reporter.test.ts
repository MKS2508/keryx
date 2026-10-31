/**
 * Tests for the agent-facing reporter module.
 *
 * Covers:
 * - Exit code mapping for every domain error type
 * - JSON envelope shape on success (proposals, commitCount, pushed)
 * - JSON envelope shape on error (type, message)
 * - Dry-run flag is forwarded correctly
 * - --version flag exits with code 0 and writes to stdout
 *
 * @module tests/reporter
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { spawnSync } from 'child_process';
import { existsSync, readFileSync, writeFileSync } from 'fs';
import { join } from 'path';
import { mkdirSync } from 'fs';
import {
    ExitCode,
    mapErrorToExitCode,
    buildJsonEnvelope,
} from '../src/reporter';
import type { ResultError } from '@mks2508/no-throw';
import type { CommitErrorCode, ICommitResult } from '../src/types/index';
import { ok, err, resultError } from '@mks2508/no-throw';
import { CommitGenerator } from '../src/commit-generator';
import type { IAIProvider } from '../src/types/index';
import { createTestRepo, type ITestRepo } from './test-utils';

const WIZARD_PATH = join(__dirname, '..', 'src', 'commit-generator.ts');

/**
 * Hermetic IAIProvider: returns a fixed, well-formed proposal response
 * and optionally captures every prompt it receives.
 */
function stubProvider(opts: { capture?: string[] } = {}): IAIProvider {
    return {
        name: 'Stub Provider',
        id: 'gemini-sdk',
        model: 'stub-1',
        isAvailable: () => true,
        generate: async (prompt: string) => {
            opts.capture?.push(prompt);
            return [
                '### **ANÁLISIS PRINCIPAL**',
                '',
                'Cambio único.',
                '',
                '---',
                '',
                '### **Propuesta de Commit #1**',
                '',
                '```markdown',
                'feat(notes): track notes file',
                '',
                'Añade el fichero de notas al repo.',
                '',
                '<trailers>',
                'Release-Note: notas persistentes en el repo',
                '</trailers>',
                '```',
                '',
                '### **Archivos de la Propuesta #1** (OBLIGATORIO)',
                '',
                '```files',
                'notes.txt',
                '```',
                '',
                '---',
                '',
                '**DECISIÓN**: un solo cambio lógico.',
            ].join('\n');
        },
    };
}

describe('reporter — ExitCode mapping', () => {
    it('maps NO_CHANGES to 2', () => {
        expect(mapErrorToExitCode(resultError('NO_CHANGES', 'no files'))).toBe(2);
    });

    it('maps PROVIDER_ERROR to 3', () => {
        expect(mapErrorToExitCode(resultError('PROVIDER_ERROR', 'rate limit'))).toBe(3);
    });

    it('maps PARSE_ERROR to 4', () => {
        expect(mapErrorToExitCode(resultError('PARSE_ERROR', 'no proposals'))).toBe(4);
    });

    it('maps COMMIT_EXEC_ERROR to 5', () => {
        expect(mapErrorToExitCode(resultError('COMMIT_EXEC_ERROR', 'git failed'))).toBe(5);
    });

    it('maps PUSH_CANCELLED to 6', () => {
        expect(mapErrorToExitCode(resultError('PUSH_CANCELLED', 'user said no'))).toBe(6);
    });

    it('maps GIT_ERROR to 6 (push-side git error)', () => {
        expect(mapErrorToExitCode(resultError('GIT_ERROR', 'push failed'))).toBe(6);
    });

    it('maps STAGING_ERROR to 8', () => {
        expect(mapErrorToExitCode(resultError('STAGING_ERROR', 'add failed'))).toBe(8);
    });

    it('falls back to 1 for unknown codes', () => {
        const weird = { code: 'SOMETHING_NEW', message: 'future error' } as any;
        expect(mapErrorToExitCode(weird)).toBe(1);
    });

    it('also reads legacy `type` field for backwards compatibility', () => {
        const legacy = { type: 'PROVIDER_ERROR', message: 'rate limit' } as any;
        expect(mapErrorToExitCode(legacy)).toBe(3);
    });

    it('exposes stable exit code values', () => {
        expect(ExitCode.SUCCESS).toBe(0);
        expect(ExitCode.NO_CHANGES).toBe(2);
        expect(ExitCode.COMMIT_ERROR).toBe(5);
    });
});

describe('reporter — buildJsonEnvelope', () => {
    const successResult: ICommitResult = {
        proposals: [
            {
                title: 'feat: first',
                description: 'body 1',
                technical: 'tech 1',
                changelog: '',
                files: ['src/a.ts'],
            },
            {
                title: 'feat: second',
                description: '',
                technical: '',
                changelog: '',
                files: [],
            },
        ],
        commitCount: 2,
        pushed: false,
        providerName: 'Gemini SDK',
        modelName: 'gemini-2.5-flash',
        elapsedMs: 1234,
    };

    it('builds success envelope with all fields', () => {
        const env = buildJsonEnvelope(ok(successResult), false);
        expect(env.ok).toBe(true);
        if (env.ok) {
            expect(env.dryRun).toBe(false);
            expect(env.commitCount).toBe(2);
            expect(env.pushed).toBe(false);
            expect(env.proposals).toHaveLength(2);
            expect(env.proposals[0].files).toEqual(['src/a.ts']);
            expect(env.proposals[1].files).toEqual([]);
            expect(env.providerName).toBe('Gemini SDK');
            expect(env.modelName).toBe('gemini-2.5-flash');
            expect(env.elapsedMs).toBe(1234);
        }
    });

    it('forwards dryRun=true to the envelope', () => {
        const env = buildJsonEnvelope(ok(successResult), true);
        expect(env.ok).toBe(true);
        if (env.ok) expect(env.dryRun).toBe(true);
    });

    it('builds error envelope with type + message', () => {
        const env = buildJsonEnvelope(
            err(resultError('NO_CHANGES', 'nothing to commit')),
            false,
        );
        expect(env.ok).toBe(false);
        if (!env.ok) {
            expect(env.error.type).toBe('NO_CHANGES');
            expect(env.error.message).toBe('nothing to commit');
            expect(env.dryRun).toBe(false);
        }
    });

    it('omits success fields on error envelope', () => {
        const env = buildJsonEnvelope(
            err(resultError('PROVIDER_ERROR', 'rate limit')),
            false,
        );
        if (!env.ok) {
            expect((env as any).commitCount).toBeUndefined();
            expect((env as any).proposals).toBeUndefined();
            expect((env as any).pushed).toBeUndefined();
        }
    });
});

describe('CLI — --version flag', () => {
    it('prints version to stdout and exits 0', () => {
        const r = spawnSync('bun', [WIZARD_PATH, '--version'], { encoding: 'utf-8' });
        expect(r.status).toBe(0);
        expect(r.stdout).toMatch(/^keryx v\d+\.\d+\.\d+/);
        // no human noise on stderr
        expect(r.stderr).not.toContain('Commit Wizard');
    });

    it('-V also prints version', () => {
        const r = spawnSync('bun', [WIZARD_PATH, '-V'], { encoding: 'utf-8' });
        expect(r.status).toBe(0);
        expect(r.stdout).toMatch(/^keryx v\d+\.\d+\.\d+/);
    });
});

describe('CLI — --json output', () => {
    let tmpDir: string;

    beforeEach(() => {
        tmpDir = join('/tmp', `gcw-json-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`);
        mkdirSync(tmpDir, { recursive: true });
        // Init a clean repo with one committed file
        spawnSync('git', ['init', '--initial-branch', 'master', '--quiet'], { cwd: tmpDir });
        spawnSync('git', ['config', 'user.email', 'test@example.com'], { cwd: tmpDir });
        spawnSync('git', ['config', 'user.name', 'Test'], { cwd: tmpDir });
        spawnSync('git', ['config', 'commit.gpgsign', 'false'], { cwd: tmpDir });
        writeFileSync(join(tmpDir, 'README.md'), '# T\n');
        spawnSync('git', ['add', '--', 'README.md'], { cwd: tmpDir });
        spawnSync('git', ['commit', '-m', 'init', '--quiet'], { cwd: tmpDir });
    });

    afterEach(() => {
        spawnSync('rm', ['-rf', tmpDir]);
    });

    it('--json on a clean repo emits an envelope on stdout and exits 2 (NO_CHANGES)', () => {
        // Clean tree → NO_CHANGES
        const r = spawnSync('bun', [
            WIZARD_PATH,
            '--json', '--agent', '--all',
        ], { cwd: tmpDir, encoding: 'utf-8' });

        expect(r.status).toBe(2);
        // Stdout must be parseable JSON
        const envelope = JSON.parse(r.stdout.trim());
        expect(envelope.ok).toBe(false);
        expect(envelope.error.type).toBe('NO_CHANGES');
        expect(envelope.dryRun).toBe(false);
    });

    // Hermetic rewrite: the AI response comes from an injected provider
    // (providerInstance seam) instead of a real API, so this runs without
    // keys or network while still exercising staging → analysis → parse →
    // envelope over a real tmp git repo.
    it('dry-run on a dirty repo parses a proposal list without committing', async () => {
        const repo: ITestRepo = createTestRepo();
        try {
            repo.writeFile('notes.txt', 'hello\n');

            const generator = new CommitGenerator({
                projectRoot: repo.path,
                isAgent: true,
                stagingMode: 'all',
                dryRun: true,
                silent: true,
                providerInstance: stubProvider(),
            });
            const result = await generator.generate();

            const envelope = buildJsonEnvelope(result, true);
            expect(envelope.ok).toBe(true);
            if (envelope.ok) {
                expect(envelope.dryRun).toBe(true);
                expect(Array.isArray(envelope.proposals)).toBe(true);
                expect(envelope.proposals.length).toBeGreaterThan(0);
                expect(envelope.proposals[0]!.files).toEqual(['notes.txt']);
                expect(envelope.proposals[0]!.trailers).toEqual([
                    { key: 'Release-Note', value: 'notas persistentes en el repo' },
                ]);
                expect(envelope.commitCount).toBe(0);
            }

            // And no commit was actually created
            expect(repo.git(['log', '--oneline']).split('\n').length).toBe(1);
        } finally {
            repo.cleanup();
        }
    });
});

describe('CLI — --context-file', () => {
    let tmpDir: string;

    beforeEach(() => {
        // Note: do NOT write a context file inside tmpDir. The wizard's
        // --all mode would stage any untracked file it finds there,
        // turning this "clean tree" test into a dirty one.
        tmpDir = join('/tmp', `gcw-ctx-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`);
        mkdirSync(tmpDir, { recursive: true });
        spawnSync('git', ['init', '--initial-branch', 'master', '--quiet'], { cwd: tmpDir });
        spawnSync('git', ['config', 'user.email', 'test@example.com'], { cwd: tmpDir });
        spawnSync('git', ['config', 'user.name', 'Test'], { cwd: tmpDir });
        spawnSync('git', ['config', 'commit.gpgsign', 'false'], { cwd: tmpDir });
        writeFileSync(join(tmpDir, 'README.md'), '# T\n');
        spawnSync('git', ['add', '--', 'README.md'], { cwd: tmpDir });
        spawnSync('git', ['commit', '-m', 'init', '--quiet'], { cwd: tmpDir });
    });

    afterEach(() => {
        spawnSync('rm', ['-rf', tmpDir]);
    });

    it('accepts a missing context file gracefully (NO_CHANGES on clean tree)', () => {
        const r = spawnSync('bun', [
            WIZARD_PATH,
            '--json', '--agent', '--all',
            '--context-file', '/nonexistent/path.md',
        ], { cwd: tmpDir, encoding: 'utf-8' });

        expect(r.status).toBe(2);
        const envelope = JSON.parse(r.stdout.trim());
        expect(envelope.ok).toBe(false);
        expect(envelope.error.type).toBe('NO_CHANGES');
    });

    // Hermetic rewrite: instead of probing the CLI's --context-file flag
    // over a subprocess (which needed a live provider to get past the AI
    // step), assert on the effect — the context text reaching the prompt.
    it('passes the caller context through to the AI prompt', async () => {
        const repo: ITestRepo = createTestRepo();
        try {
            repo.writeFile('src.txt', 'src\n');
            const prompts: string[] = [];

            const generator = new CommitGenerator({
                projectRoot: repo.path,
                isAgent: true,
                stagingMode: 'all',
                dryRun: true,
                silent: true,
                context: 'refactor: extract validation into helper',
                providerInstance: stubProvider({ capture: prompts }),
            });
            const result = await generator.generate();
            expect(result.ok).toBe(true);

            expect(prompts.length).toBe(1);
            expect(prompts[0]).toContain('refactor: extract validation into helper');
        } finally {
            repo.cleanup();
        }
    });
});