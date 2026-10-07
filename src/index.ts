/**
 * keryx — AI-powered Git commit generation with multi-provider support.
 *
 * @example
 * ```typescript
 * import { CommitGenerator, createProvider, loadProjectConfig } from 'keryx';
 *
 * const generator = new CommitGenerator({
 *   provider: 'groq',
 *   autoApprove: true,
 *   noPush: true,
 * });
 *
 * const result = await generator.generate();
 * ```
 *
 * @module keryx
 */

// ─── Core Classes ────────────────────────────────────────────
export { CommitGenerator, WIZARD_VERSION } from './commit-generator.js';
export { VersionManager } from './version-manager.js';

// ─── Release Notes ───────────────────────────────────────────
export {
    runReleaseNotes,
    runReleaseNotesCli,
    detectMissingTrailers,
    planCommits,
    parseTrailerProposals,
    buildTrailerPrompt,
    renderReleaseNotesMarkdown,
    defaultDeps as releaseNotesDefaultDeps,
    type IReleaseNotesOptions,
    type IReleaseNotesDeps,
    type IReleaseNotesReport,
    type ITrailerCandidate,
    type IStyxPlan,
    type IStyxPlanComponent,
    type IStyxPlanReason,
    type StyxLevel,
} from './release-notes.js';

// ─── Provider System ─────────────────────────────────────────
export { createProvider, listProviders } from './providers/index.js';
export { GeminiSdkProvider } from './providers/gemini-sdk.js';
export { GeminiCliProvider } from './providers/gemini-cli.js';
export { GroqProvider } from './providers/groq.js';
export { OpenRouterProvider } from './providers/openrouter.js';

// ─── Configuration ───────────────────────────────────────────
export { loadProjectConfig } from './project-config.js';

// ─── Prompt Templates & Parsing ──────────────────────────────
export {
    createCommitPrompt,
    GeminiResponseParser,
} from './prompt-templates.js';

// ─── Trailers ────────────────────────────────────────────────
export {
    TRAILER_KEYS,
    parseTrailers,
    formatTrailersBlock,
    missingReleaseNoteWarnings,
    type TrailerKey,
    type ITrailer,
} from './trailers.js';

// ─── Types (re-exported from src/types/) ─────────────────────
export type {
    // Provider
    ProviderName,
    IAIProvider,
    // Config
    IProjectConfig,
    IProjectComponent,
    ICommitFormat,
    // Commit
    IFileChange,
    IGitStats,
    ICommitAnalysis,
    ICommitProposal,
    ICommitOptions,
    // Prompt
    IGeminiPromptConfig,
    IStandardResponseFormat,
    // Version
    IChangelogEntry,
    IVersion,
    IChangelogData,
    IVersionCommitInfo,
    // SDK
    ICommitGeneratorOptions,
    ICommitResult,
    CommitErrorCode,
    VersionErrorCode,
} from './types/index.js';
