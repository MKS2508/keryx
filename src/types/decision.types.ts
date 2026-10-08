/**
 * Decision-provider output types — jev (System One Model) returns these.
 *
 * v3.1 hybrid pipeline: jev classifies the diff in one `systemOne` call with
 * a fixed set of questions; the typed answers shape the prompt that agy
 * (text provider) uses to write the commit body. The 4 legacy text
 * providers (gemini/groq/openrouter) keep working as fallback when jev
 * is not configured.
 *
 * @module types/decision
 */

/**
 * Conventional commit type. The `feat-phase` value is keryx's own
 * (incomplete feature shipped as a phase); `ci` and `chore` are common
 * additions to the standard set.
 */
export type CommitType =
    | 'feat'
    | 'fix'
    | 'refactor'
    | 'docs'
    | 'test'
    | 'feat-phase'
    | 'ci'
    | 'chore';

/**
 * Typed decisions jev emits for one commit classification.
 *
 * All numeric fields are jev's calibrated probabilities (0..1) for
 * noul questions, or weighted scores (0..N) for score questions. They
 * are guides for the body writer, not overrides — agy can disagree
 * with a written reason.
 */
export interface ICommitDecisions {
    /** Conventional commit type. */
    commit_type: CommitType;
    /** Component id (from `IProjectConfig.components[].id`) or 'general'. */
    scope: string;
    /** Probability the change breaks a contract or expected behavior. 0..1 */
    breaking: number;
    /** Probability the change has user-visible impact worth a changelog entry. 0..1 */
    changelog_worthy: number;
    /** Probability the diff is a single logical commit. 1 = single, 0 = multi. 0..1 */
    single_vs_multi: number;
    /** Score over the rubric [trivial, simple, standard, complex, architectural]. 0..5 */
    complexity: number;
}

/**
 * Per-commit trailer decisions jev emits in the release-notes subcommand.
 * Merge with the regex-based `detectMissingTrailers` to refine which
 * trailers the body writer (agy) should propose.
 */
export interface ITrailerDecisions {
    /** Map of commit SHA -> confirmed/dropped trailer keys. */
    bySha: Record<
        string,
        {
            confirmed: string[];
            dropped: string[];
        }
    >;
}

/**
 * Default scoring rubric jev is asked to use for `complexity`.
 * Kept as a constant so the prompt and the `ICommitDecisions.complexity`
 * interpretation stay in sync.
 */
export const COMPLEXITY_RUBRIC: readonly string[] = [
    'trivial',
    'simple',
    'standard',
    'complex',
    'architectural',
] as const;
