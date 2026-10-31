/**
 * Decision-provider question builders + response mappers.
 *
 * v3.1 hybrid pipeline. The keryx side builds the question map and
 * interprets the response; the provider side (typically jev) just
 * runs `systemOne` and returns whatever shape the SDK exposes.
 *
 * Keeping the questions and mapping in one module makes the
 * "what keryx asks jev" contract explicit and reviewable. Both
 * the main commit path (`CommitGenerator.analyzeWithAI`) and the
 * `release-notes` subcommand use this file.
 *
 * @module decisions
 */

import { COMPLEXITY_RUBRIC, type CommitType, type ICommitDecisions, type ITrailerDecisions } from './types/decision.types.js';
import type { IProjectConfig } from './types/config.types.js';

/**
 * The keryx question set for commit classification. Six parallel
 * questions in a single `systemOne` call (jev runs them in parallel
 * per the article — one round-trip, six decisions).
 *
 * The shape matches the `@typesafe-ai/sdk` `systemOne` input:
 * each value is either `{ type: 'noul', instructions, criteria }`,
 * `{ type: 'choice', instructions, criteria }`, or
 * `{ type: 'score', instructions, criteria }`.
 *
 * @param config - Loaded project config (used to seed `scope` choices
 *                 from the project's component list)
 * @returns Questions map keyed by answer name
 */
export function commitDecisionsQuestions(config: IProjectConfig): Record<string, unknown> {
    const componentIds = (config.components ?? [])
        .map((c) => c.id)
        .filter((id) => id && id !== 'general');

    const scopeCriteria: Record<string, string> = {
        general: 'Cross-cutting change or no specific component',
    };
    for (const id of componentIds) {
        scopeCriteria[id] = `Changes scoped to the ${id} component`;
    }

    return {
        commit_type: {
            type: 'choice',
            instructions: 'What Conventional Commits type best fits these changes?',
            criteria: {
                feat: 'New user-facing functionality',
                fix: 'Bug fix or behavior correction',
                refactor: 'Code change without behavior change',
                docs: 'Documentation only',
                test: 'Tests added or modified (no production code)',
                'feat-phase': 'Partial feature shipped as a phase',
                ci: 'CI/CD configuration',
                chore: 'Maintenance, dependencies, tooling',
            },
        },
        scope: {
            type: 'choice',
            instructions: 'Which component or area do these changes belong to?',
            criteria: scopeCriteria,
        },
        breaking: {
            type: 'noul',
            instructions:
                'Do these changes break a public API contract in the semver-major sense? ' +
                'Existing external callers, CLI users, or downstream consumers will fail or ' +
                'get observably different results and MUST change their code to upgrade.',
            criteria: {
                true: 'Semver-major: external callers will break or get different results without code changes',
                false: 'Backward compatible, internal-only, or output-format polish without behavior change',
            },
        },
        changelog_worthy: {
            type: 'noul',
            instructions: 'Are these changes worth a user-facing changelog entry?',
            criteria: {
                true: 'User-visible feature, fix, or behavior change',
                false: 'Internal refactor, test, or chore',
            },
        },
        single_vs_multi: {
            type: 'noul',
            instructions: 'Are these changes a single logical commit, or should they be split?',
            criteria: {
                true: 'One concern, one commit',
                false: 'Multiple unrelated concerns that should be split',
            },
        },
        complexity: {
            type: 'score',
            instructions: 'How complex are these changes?',
            criteria: [...COMPLEXITY_RUBRIC],
        },
    };
}

/**
 * Shape jev returns for the commit decisions question set. Matches
 * the SDK's `systemOne` response: `{ model, answers, usage? }`.
 */
interface IJevSystemOneResponse {
    answers?: Record<string, IJevAnswer>;
}

type IJevAnswer =
    | { type: 'noul'; noul?: number }
    | { type: 'choice'; choice?: string; probabilities?: Record<string, number>; confidence?: number }
    | { type: 'score'; score?: number; legend?: Record<string, string>; probabilities?: Record<string, number>; confidence?: number };

/**
 * Map a jev `systemOne` response to a flat `ICommitDecisions`.
 *
 * Defensive: every field has a safe default so a partial response
 * (e.g. jev timed out on one question) does not blow up the body
 * writer. The defaults are deliberately pessimistic — text providers
 * will fill in the rest from the diff.
 */
export function mapJevToCommitDecisions(raw: unknown): ICommitDecisions {
    const response = (raw ?? {}) as IJevSystemOneResponse;
    const answers = response.answers ?? {};

    const getNoul = (key: string, fallback: number): number => {
        const a = answers[key] as { noul?: number } | undefined;
        return typeof a?.noul === 'number' ? a.noul : fallback;
    };

    const getChoice = (key: string, fallback: string): string => {
        const a = answers[key] as { choice?: string } | undefined;
        return typeof a?.choice === 'string' ? a.choice : fallback;
    };

    const getScore = (key: string, fallback: number): number => {
        const a = answers[key] as { score?: number } | undefined;
        return typeof a?.score === 'number' ? a.score : fallback;
    };

    const commitType = getChoice('commit_type', 'chore') as CommitType;
    const validTypes: CommitType[] = [
        'feat', 'fix', 'refactor', 'docs', 'test', 'feat-phase', 'ci', 'chore',
    ];
    const safeCommitType: CommitType = validTypes.includes(commitType) ? commitType : 'chore';

    return {
        commit_type: safeCommitType,
        scope: getChoice('scope', 'general'),
        breaking: clamp01(getNoul('breaking', 0)),
        changelog_worthy: clamp01(getNoul('changelog_worthy', 0)),
        single_vs_multi: clamp01(getNoul('single_vs_multi', 1)),
        complexity: clamp(getScore('complexity', 0), 0, COMPLEXITY_RUBRIC.length),
    };
}

/** The keryx question set for trailer decisions in release-notes. */
export function trailerDecisionsQuestions(
    candidates: Array<{ sha: string; type: string; missingTrailers: string[]; title: string }>,
): Record<string, unknown> {
    const questionKeyToSha: Record<string, string> = {};
    const questions: Record<string, unknown> = {};

    for (const c of candidates) {
        const key = `confirm_${c.sha.substring(0, 7)}`;
        questionKeyToSha[key] = c.sha;

        questions[key] = {
            type: 'choice',
            instructions:
                `For commit ${c.sha.substring(0, 7)} (${c.type}): "${c.title}". ` +
                `Which trailers (if any) does it ACTUALLY need? ` +
                `Regex flagged: ${c.missingTrailers.length === 0 ? 'none' : c.missingTrailers.join(', ')}.`,
            criteria: {
                confirm_regex: `Keep the regex-flagged trailers as-is: ${c.missingTrailers.join(', ') || '(none)'}`,
                drop_regex: 'The regex was wrong; none of the flagged trailers apply',
                add_security: 'This commit hardens security; add Security: even if regex missed it',
            },
        };
    }

    return questions;
}

/**
 * Map jev's trailer decisions response into a `ITrailerDecisions`.
 * Falls back to an empty `bySha` when the response is malformed.
 */
export function mapJevToTrailerDecisions(
    raw: unknown,
    candidateShas: string[],
): ITrailerDecisions {
    const response = (raw ?? {}) as IJevSystemOneResponse;
    const answers = response.answers ?? {};
    const bySha: ITrailerDecisions['bySha'] = {};

    for (const sha of candidateShas) {
        const key = `confirm_${sha.substring(0, 7)}`;
        const a = answers[key] as { choice?: string } | undefined;
        const choice = a?.choice ?? 'confirm_regex';

        bySha[sha] = {
            confirmed: choice === 'drop_regex' ? [] : ['regex'],
            dropped: choice === 'drop_regex' ? ['regex'] : [],
        };
    }

    return { bySha };
}

/**
 * Build a compact, jev-friendly state from a full `ICommitAnalysis`.
 *
 * The text provider (agy) gets the full analysis and full diff
 * because it has to write a precise commit body. jev, by contrast,
 * only needs the structure of the diff to classify it — and jev's
 * per-request token budget blows up on commits over ~1.5k lines
 * (real failure observed on styx commit cb5efc6: 1416 lines,
 * `feat(ingest)!:`).
 *
 * Truncation strategy:
 *   - Always keep the file list with paths, statuses, and line counts.
 *   - Per-file `diff_preview` is capped at `perFileChars` (default 500).
 *   - If the resulting state still exceeds `maxBytes`, drop the
 *     `diff_preview` from the largest files first until under budget.
 *   - Project context (name, description, tech_stack) is preserved.
 *
 * The diff is still available in full to the text provider — this
 * function only trims what jev sees.
 */
export function truncateForDecisionProvider(
    analysis: unknown,
    opts: { perFileChars?: number; maxBytes?: number } = {},
): unknown {
    const perFileChars = opts.perFileChars ?? 300;
    const maxBytes = opts.maxBytes ?? 8_000;

    const a = (analysis ?? {}) as { files?: unknown[]; stats?: unknown; project_context?: unknown; commit_patterns?: string };
    const files = Array.isArray(a.files) ? a.files : [];

    // First pass: cap per-file diff_preview
    const capped = files.map((f) => {
        const file = f as { path?: string; status?: string; lines_added?: number; lines_removed?: number; is_binary?: boolean; diff_preview?: string };
        if (file.is_binary) {
            return { ...file, diff_preview: '[binary file]' };
        }
        const dp = file.diff_preview ?? '';
        if (dp.length > perFileChars) {
            return {
                ...file,
                diff_preview: dp.substring(0, perFileChars) + `\n... [truncated, ${dp.length - perFileChars} more chars]`,
            };
        }
        return file;
    });

    let out = {
        ...(a.project_context ? { project_context: a.project_context } : {}),
        stats: a.stats,
        files: capped,
    };

    // Second pass: if still too big, drop diff_preview from the
    // largest files first (keep the structural metadata).
    const json = JSON.stringify(out);
    if (json.length <= maxBytes) return out;

    // Sort by diff_preview length desc, drop until under budget
    const indexed = capped.map((f, i) => ({ i, len: ((f as { diff_preview?: string }).diff_preview ?? '').length }));
    indexed.sort((a, b) => b.len - a.len);
    let budget = json.length;
    for (const { i, len } of indexed) {
        if (budget <= maxBytes) break;
        (capped[i] as { diff_preview?: string }).diff_preview = '[omitted: large diff]';
        budget -= len - ('[omitted: large diff]'.length);
    }

    return {
        ...(a.project_context ? { project_context: a.project_context } : {}),
        stats: a.stats,
        files: capped,
    };
}

function clamp01(n: number): number {
    if (Number.isNaN(n)) return 0;
    if (n < 0) return 0;
    if (n > 1) return 1;
    return n;
}

function clamp(n: number, lo: number, hi: number): number {
    if (Number.isNaN(n)) return lo;
    if (n < lo) return lo;
    if (n > hi) return hi;
    return n;
}
