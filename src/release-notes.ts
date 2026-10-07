#!/usr/bin/env bun

/**
 * `keryx release-notes` — propose missing release-note trailers for the
 * commits of a styx release plan.
 *
 * Contract with styx is JSON-over-subprocess, NEVER imported code:
 * keryx shells out to `bun run release:plan --json` in the styx root and
 * reads the emitted `IReleasePlan`. Commit bodies/files are read with
 * plain `git` in that same root.
 *
 * This command is propose-only (`--dry-run` is the documented posture and
 * the only mode): keryx never amends commits and never writes changelogs.
 * The prose enters styx through a release PR reviewed by a human.
 *
 * Usage:
 *   keryx release-notes [--styx-root <path>] [--json] [--dry-run]
 *                       [--provider <name>] [--model <id>]
 *
 * @module release-notes
 */

import { spawnSync } from 'child_process';
import { resolve } from 'path';
import logger from '@mks2508/better-logger';
const log = logger;
import { isErr, ok, err, tryCatchAsync, type Result, type ResultError } from '@mks2508/no-throw';
import { createProvider as defaultCreateProvider } from './providers/index.js';
import { loadProjectConfig } from './project-config.js';
import { parseTrailers, TRAILER_KEYS, type ITrailer, type TrailerKey } from './trailers.js';
import { ExitCode } from './reporter.js';
import type { IAIProvider } from './types/index.js';

// ─── styx plan contract (mirrored, not imported) ──────────────

/** Bump level as computed by styx's planner. */
export type StyxLevel = 'none' | 'patch' | 'minor';

/** One reason a component's level went up. */
export interface IStyxPlanReason {
    level: StyxLevel;
    source: 'detector' | 'commit' | 'override';
    detail: string;
    commit?: string;
}

/** One component's plan slice. */
export interface IStyxPlanComponent {
    component: string;
    current: string;
    level: StyxLevel;
    next: string;
    reasons: IStyxPlanReason[];
    upgradeSteps: string[];
}

/** The JSON emitted by `bun run release:plan --json`. */
export interface IStyxPlan {
    from: string;
    to: string;
    prerelease: string | null;
    trainCurrent: string;
    trainLevel: StyxLevel;
    trainNext: string;
    components: IStyxPlanComponent[];
    errors: string[];
}

// ─── detection ────────────────────────────────────────────────

/** Same shape styx's planner uses to grade Conventional Commits. */
const CC = /^(?<type>[a-z]+)(?:\((?<scope>[^)]*)\))?(?<bang>!)?:\s/;

/** A commit the plan says is version-relevant, with what it's missing. */
export interface ITrailerCandidate {
    sha: string;
    subject: string;
    level: StyxLevel;
    component: string;
    existing: ITrailer[];
    files: string[];
    missing: TrailerKey[];
}

/**
 * Collect commit-sourced reasons from the plan, deduped by sha with the
 * max level any component attributed to it.
 */
export function planCommits(plan: IStyxPlan): Array<{ sha: string; subject: string; level: StyxLevel; component: string }> {
    const bySha = new Map<string, { sha: string; subject: string; level: StyxLevel; component: string }>();
    const rank: Record<StyxLevel, number> = { none: 0, patch: 1, minor: 2 };
    for (const c of plan.components) {
        for (const r of c.reasons) {
            if (r.source !== 'commit' || r.commit === undefined) continue;
            const prev = bySha.get(r.commit);
            if (!prev) {
                bySha.set(r.commit, { sha: r.commit, subject: r.detail, level: r.level, component: c.component });
            } else {
                if (rank[r.level] > rank[prev.level]) prev.level = r.level;
            }
        }
    }
    return [...bySha.values()];
}

/**
 * Decide which trailers a commit deserves but doesn't carry.
 *
 * Mirrors how styx consumes trailers: `feat`/`fix` feed the release prose
 * (want `Release-Note`), a `!` bang means a break (want `Breaking`), `sec`
 * feeds the security block (want `Security`), and a commit adding a
 * migration file demands an upgrade step (want `Upgrade-Step`).
 *
 * @param commit - Plan commit with body trailers and added files
 * @returns Missing trailer keys (may be empty)
 */
export function missingTrailersFor(commit: {
    subject: string;
    existing: ITrailer[];
    files: string[];
}): TrailerKey[] {
    const has = (key: TrailerKey): boolean => commit.existing.some(t => t.key === key);
    const m = CC.exec(commit.subject);
    const missing: TrailerKey[] = [];

    if (m?.groups !== undefined) {
        const type = m.groups['type']!;
        if ((type === 'feat' || type === 'fix') && !has('Release-Note')) missing.push('Release-Note');
        if (m.groups['bang'] === '!' && !has('Breaking')) missing.push('Breaking');
        if (type === 'sec' && !has('Security')) missing.push('Security');
    }
    // Same shape styx's detector accepts as "migración nueva": an ADDED
    // .sql directly under migrations/ — not any commit that merely
    // touches/moves migration files.
    if (commit.files.some(f => /\/migrations\/[^/]+\.sql$/.test(f)) && !has('Upgrade-Step')) {
        missing.push('Upgrade-Step');
    }
    return missing;
}

/**
 * Full detection pass: plan commits + bodies/files → candidates that
 * deserve at least one trailer they don't have.
 *
 * @param plan - The parsed styx release plan
 * @param bodies - Commit sha → full commit body
 * @param files - Commit sha → touched files
 * @returns Candidates with their missing trailer keys
 */
export function detectMissingTrailers(
    plan: IStyxPlan,
    bodies: ReadonlyMap<string, string>,
    files: ReadonlyMap<string, string[]>,
): ITrailerCandidate[] {
    const out: ITrailerCandidate[] = [];
    for (const c of planCommits(plan)) {
        const body = bodies.get(c.sha) ?? '';
        const existing = parseTrailers(body);
        const touched = files.get(c.sha) ?? [];
        const missing = missingTrailersFor({ subject: c.subject, existing, files: touched });
        if (missing.length > 0) {
            out.push({ ...c, existing, files: touched, missing });
        }
    }
    return out;
}

// ─── provider prompt + response parsing ───────────────────────

/**
 * Build the AI prompt for the missing trailers.
 * @param candidates - Candidates from detectMissingTrailers
 * @param bodies - Commit sha → full commit body (for context)
 * @returns The prompt text
 */
export function buildTrailerPrompt(
    candidates: ITrailerCandidate[],
    bodies: ReadonlyMap<string, string>,
): string {
    const sections = candidates.map((c, i) => {
        const existingBlock = c.existing.length > 0
            ? c.existing.map(t => `${t.key}: ${t.value}`).join('\n')
            : '(ninguno)';
        return `### Commit #${i + 1}
sha: ${c.sha}
subject: ${c.subject}
componente: ${c.component}
nivel del plan: ${c.level}
trailers actuales:
${existingBlock}
trailers que faltan: ${c.missing.join(', ')}
body completo:
---
${(bodies.get(c.sha) ?? '').trim() || '(vacío)'}
---`;
    }).join('\n\n');

    return `# PROPUESTA DE TRAILERS DE RELEASE

Eres un asistente que redacta trailers de release para commits de un plan
de versión. El changelog se genera de forma DETERMINISTA a partir de estos
trailers: cada línea \`Clave: valor\` se convierte en prosa de release tal cual.

## Commits del plan a los que faltan trailers

${sections}

---

## FORMATO DE RESPUESTA REQUERIDO

Para CADA commit de arriba, exactamente una sección, en el mismo orden:

### Trailer Proposal #N
sha: <sha exacto del commit>
Clave-que-falta: <una línea con el valor>

Reglas:
- SOLO las claves listadas en "trailers que faltan" de cada commit.
- Una línea por trailer, formato exacto \`Clave: valor\` (Clave en inglés, tal cual).
- Release-Note: una frase con cara de usuario, en español, sin prefijo de tipo.
- Breaking: qué se rompe y para quién.
- Upgrade-Step: el paso concreto para migrar (imperativo).
- Security: qué se corrige o endurece.
- No inventes shas ni repitas secciones.`;
}

/** An AI-proposed trailer set for one commit. */
export interface ITrailerProposalParsed {
    sha: string;
    trailers: ITrailer[];
}

/**
 * Parse the AI's trailer proposals. Unknown keys are dropped and shas not
 * among the candidates are ignored — the proposal is a suggestion, the
 * detection pass decides what is actually missing.
 *
 * @param response - Raw AI response
 * @returns Parsed proposals in order of appearance
 */
export function parseTrailerProposals(response: string): ITrailerProposalParsed[] {
    const out: ITrailerProposalParsed[] = [];
    const pattern = /###\s*Trailer Proposal #\d+/g;
    const matches = Array.from(response.matchAll(pattern));
    for (let i = 0; i < matches.length; i++) {
        const start = matches[i]!.index!;
        const end = matches[i + 1]?.index ?? response.length;
        const section = response.substring(start, end);
        const sha = /^sha:\s*(\S+)/m.exec(section)?.[1];
        if (!sha) continue;
        out.push({ sha, trailers: parseTrailers(section) });
    }
    return out;
}

// ─── orchestration ────────────────────────────────────────────

/** Report of a release-notes run. */
export interface IReleaseNotesReport {
    styxRoot: string;
    plan: Pick<IStyxPlan, 'from' | 'to' | 'trainCurrent' | 'trainNext'>;
    analyzed: number;
    candidates: ITrailerCandidate[];
    proposals: Array<{ candidate: ITrailerCandidate; trailers: ITrailer[] }>;
    withoutProposal: ITrailerCandidate[];
    providerName: string;
    modelName: string;
    elapsedMs: number;
}

/** Options for runReleaseNotes. */
export interface IReleaseNotesOptions {
    /** --styx-root flag (wins over config) */
    styxRoot?: string;
    /** Directory whose .commit-wizard.json provides styx.root + provider defaults */
    cwd?: string;
    provider?: string;
    model?: string;
    json?: boolean;
    dryRun?: boolean;
    /** Range start passed through to release:plan (e.g. last train tag) */
    from?: string;
    /** Range end passed through to release:plan (default HEAD) */
    to?: string;
    /** Prerelease mode passed through to release:plan (e.g. 'alpha') */
    prerelease?: string;
}

/** Injectable subprocess seams (tests pass fakes). */
export interface IReleaseNotesDeps {
    /** Run `bun run release:plan --json <extra>` in the styx root, return stdout */
    runPlan: (styxRoot: string, extraArgs: string[]) => string;
    /** Full commit body for a sha (`git log -1 --format=%B <sha>`) */
    gitBody: (styxRoot: string, sha: string) => string;
    /** Files ADDED by a sha (`git show --diff-filter=A --name-only --format= <sha>`) */
    gitFiles: (styxRoot: string, sha: string) => string;
    /** Provider factory */
    createProvider: (name?: string, model?: string) => IAIProvider;
}

/** Default deps: real subprocesses. */
export const defaultDeps: IReleaseNotesDeps = {
    runPlan: (styxRoot, extraArgs) => {
        const r = spawnSync('bun', ['run', 'release:plan', '--json', ...extraArgs], {
            cwd: styxRoot,
            encoding: 'utf-8',
            stdio: ['ignore', 'pipe', 'pipe'],
            // A styx plan over the full history emits several MiB of JSON;
            // the 1 MiB default truncates it into an unparseable stdout.
            maxBuffer: 64 * 1024 * 1024,
        });
        if (r.error) {
            throw new Error(`release:plan could not run in ${styxRoot}: ${r.error.message}`);
        }
        if (r.status !== 0) {
            throw new Error(
                `release:plan failed (exit ${r.status}) in ${styxRoot}: ${(r.stderr || '').trim()}`,
            );
        }
        return r.stdout ?? '';
    },
    gitBody: (styxRoot, sha) => {
        const r = spawnSync('git', ['log', '-1', '--format=%B', sha], {
            cwd: styxRoot, encoding: 'utf-8', stdio: ['ignore', 'pipe', 'pipe'],
        });
        return r.status === 0 ? (r.stdout ?? '') : '';
    },
    gitFiles: (styxRoot, sha) => {
        const r = spawnSync('git', ['show', '--diff-filter=A', '--name-only', '--format=', sha], {
            cwd: styxRoot, encoding: 'utf-8', stdio: ['ignore', 'pipe', 'pipe'],
        });
        return r.status === 0 ? (r.stdout ?? '').split('\n').map(l => l.trim()).filter(Boolean) : [];
    },
    createProvider: defaultCreateProvider,
};

/**
 * Run the release-notes proposal flow. Pure orchestration — all side
 * channels live in `deps`, all output decisions live in the CLI wrapper.
 *
 * @param options - Run options
 * @param deps - Subprocess seams (defaults to real ones)
 * @returns Report, or a typed error (CONFIG_ERROR / PLAN_ERROR / PROVIDER_ERROR / PARSE_ERROR)
 */
export async function runReleaseNotes(
    options: IReleaseNotesOptions,
    deps: IReleaseNotesDeps = defaultDeps,
): Promise<Result<IReleaseNotesReport, ResultError<string> & { type: string }>> {
    const startTime = Date.now();
    const cwd = options.cwd ?? process.cwd();
    const config = loadProjectConfig(cwd);
    const styxRootRaw = options.styxRoot ?? config.styx?.root;
    if (!styxRootRaw) {
        return err({
            type: 'CONFIG_ERROR',
            message: 'No styx root configured. Pass --styx-root <path> or set "styx.root" in .commit-wizard.json.',
        } as any);
    }
    const styxRoot = resolve(cwd, styxRootRaw);
    // Range passthrough: on tag-less histories the default plan spans the
    // whole repo (every commit ever), which makes the candidate set and
    // the AI prompt unusably large. Bound it like the release train would.
    const planArgs: string[] = [];
    if (options.from !== undefined) planArgs.push('--from', options.from);
    if (options.to !== undefined) planArgs.push('--to', options.to);
    if (options.prerelease !== undefined) planArgs.push('--prerelease', options.prerelease);

    let plan: IStyxPlan;
    try {
        const stdout = deps.runPlan(styxRoot, planArgs);
        plan = JSON.parse(stdout) as IStyxPlan;
        if (!Array.isArray(plan.components)) throw new Error('plan JSON has no components[]');
    } catch (e) {
        return err({
            type: 'PLAN_ERROR',
            message: `Could not obtain a release plan from ${styxRoot}: ${(e as Error).message}`,
        } as any);
    }

    const planCommitList = planCommits(plan);
    const bodies = new Map<string, string>();
    const files = new Map<string, string[]>();
    for (const c of planCommitList) {
        bodies.set(c.sha, deps.gitBody(styxRoot, c.sha));
        files.set(c.sha, deps.gitFiles(styxRoot, c.sha));
    }
    const candidates = detectMissingTrailers(plan, bodies, files);

    let proposals: Array<{ candidate: ITrailerCandidate; trailers: ITrailer[] }> = [];
    let provider: IAIProvider;
    try {
        provider = deps.createProvider(options.provider ?? config.provider, options.model ?? config.model);
    } catch (e) {
        return err({ type: 'PROVIDER_ERROR', message: (e as Error).message } as any);
    }

    if (candidates.length > 0) {
        const aiResult = await tryCatchAsync(async () => {
            const prompt = buildTrailerPrompt(candidates, bodies);
            return await provider.generate(prompt);
        }, 'PROVIDER_ERROR');
        if (isErr(aiResult)) return aiResult as any;

        const parsed = parseTrailerProposals(aiResult.value);
        const bySha = new Map(parsed.map(p => [p.sha, p.trailers]));
        proposals = candidates
            .map(candidate => {
                const proposed = bySha.get(candidate.sha) ?? [];
                // Only known keys the commit is actually missing — the
                // AI proposal is a suggestion, detection is the gate.
                const trailers = proposed.filter(t =>
                    (TRAILER_KEYS as readonly string[]).includes(t.key) &&
                    candidate.missing.includes(t.key),
                );
                return { candidate, trailers };
            })
            .filter(p => p.trailers.length > 0);
    }

    const proposedShas = new Set(proposals.map(p => p.candidate.sha));
    return ok({
        styxRoot,
        plan: {
            from: plan.from,
            to: plan.to,
            trainCurrent: plan.trainCurrent,
            trainNext: plan.trainNext,
        },
        analyzed: planCommitList.length,
        candidates,
        proposals,
        withoutProposal: candidates.filter(c => !proposedShas.has(c.sha)),
        providerName: provider.name,
        modelName: provider.model,
        elapsedMs: Date.now() - startTime,
    });
}

// ─── rendering ────────────────────────────────────────────────

/**
 * Render the report as human-readable markdown (stdout when not --json).
 * @param report - A successful run's report
 * @returns Markdown text
 */
export function renderReleaseNotesMarkdown(report: IReleaseNotesReport): string {
    const lines: string[] = [
        '# Keryx — release notes (dry run)',
        '',
        `Styx: ${report.styxRoot}`,
        `Plan: tren ${report.plan.trainCurrent} → ${report.plan.trainNext} · rango ${report.plan.from || '<raíz>'}..${report.plan.to}`,
        `Commits del plan: ${report.analyzed} · a los que faltan trailers: ${report.candidates.length}`,
        '',
    ];
    if (report.candidates.length === 0) {
        lines.push('Ningún commit del plan necesita trailers. El changelog tendrá prosa para todo lo user-facing.');
        return lines.join('\n');
    }
    for (const p of report.proposals) {
        const c = p.candidate;
        lines.push(`## ${c.sha.slice(0, 8)} ${c.subject} [${c.level}]`);
        lines.push(`Faltan: ${c.missing.join(', ')}`);
        for (const t of p.trailers) lines.push(`${t.key}: ${t.value}`);
        lines.push('');
    }
    for (const c of report.withoutProposal) {
        lines.push(`## ${c.sha.slice(0, 8)} ${c.subject} [${c.level}]`);
        lines.push(`Faltan: ${c.missing.join(', ')} — sin propuesta del provider, revísalo a mano.`);
        lines.push('');
    }
    lines.push('---', '', 'keryx no escribe nada: aplica los trailers con `git rebase` + `--amend` y entra la prosa al changelog por el PR de release.');
    return lines.join('\n');
}

// ─── CLI wrapper ──────────────────────────────────────────────

/**
 * CLI entry for `keryx release-notes`. Prints markdown (or the JSON
 * envelope with --json) and exits — this function does not return.
 *
 * @param args - Arguments after the `release-notes` subcommand
 */
export async function runReleaseNotesCli(args: string[]): Promise<never> {
    const get = (flag: string): string | undefined => {
        const idx = args.indexOf(flag);
        return idx > -1 && args[idx + 1] ? args[idx + 1] : undefined;
    };

    if (args.includes('--help') || args.includes('-h')) {
        log.header('Keryx release-notes', 'propose missing release-note trailers');
        log.blank();
        log.info('Usage: keryx release-notes [options]');
        log.blank();
        log.info('Options:');
        log.info('  --styx-root <path>    styx checkout to analyze (or "styx.root" in .commit-wizard.json)');
        log.info('  --from <rev>          range start passed to release:plan (bound it on tag-less histories)');
        log.info('  --to <rev>            range end passed to release:plan (default HEAD)');
        log.info('  --prerelease <kind>   prerelease mode passed to release:plan (e.g. alpha)');
        log.info('  --json                JSON envelope on stdout (suppresses human output)');
        log.info('  --dry-run             accepted for explicitness: this command never writes');
        log.info('  --provider <name>     Provider: gemini-cli|gemini-sdk|groq|openrouter');
        log.info('  --model <model-id>    Model override');
        log.info('  --help, -h            Show this help');
        process.exit(ExitCode.SUCCESS);
    }

    const json = args.includes('--json');
    if (json) log.setVerbosity('silent');

    const result = await runReleaseNotes({
        styxRoot: get('--styx-root'),
        provider: get('--provider'),
        model: get('--model'),
        from: get('--from'),
        to: get('--to'),
        prerelease: get('--prerelease'),
        json,
        dryRun: args.includes('--dry-run'),
    });

    if (isErr(result)) {
        if (json) {
            process.stdout.write(JSON.stringify({
                ok: false,
                error: { type: result.error.type, message: result.error.message },
            }, null, 2) + '\n');
        } else {
            // process.stderr.write, not log.error: better-logger's async
            // write is dropped by the immediate process.exit when stderr
            // is a pipe (reproduced: piped runs exit 1 with no message).
            process.stderr.write(`${result.error.message}\n`);
        }
        process.exit(ExitCode.ERROR);
    }

    const report = result.value;
    if (json) {
        process.stdout.write(JSON.stringify({
            ok: true,
            dryRun: true,
            styxRoot: report.styxRoot,
            plan: report.plan,
            analyzed: report.analyzed,
            proposals: report.proposals.map(p => ({
                sha: p.candidate.sha,
                subject: p.candidate.subject,
                level: p.candidate.level,
                component: p.candidate.component,
                missing: p.candidate.missing,
                trailers: p.trailers,
            })),
            withoutProposal: report.withoutProposal.map(c => ({
                sha: c.sha, subject: c.subject, missing: c.missing,
            })),
            providerName: report.providerName,
            modelName: report.modelName,
            elapsedMs: report.elapsedMs,
        }, null, 2) + '\n');
    } else {
        process.stdout.write(renderReleaseNotesMarkdown(report) + '\n');
    }
    process.exit(ExitCode.SUCCESS);
}

if (import.meta.main) {
    await runReleaseNotesCli(process.argv.slice(2));
}
