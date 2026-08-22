/**
 * Project configuration type definitions.
 * @module types/config
 */

import { type } from 'arktype';
import type { ProviderName } from './provider.types.js';

/**
 * A project component used as a commit scope area.
 */
export interface IProjectComponent {
    /** Unique component identifier */
    id: string;
    /** Filesystem path to the component */
    path: string;
    /** Human-readable component name */
    name: string;
}

/**
 * Commit message format configuration.
 */
export interface ICommitFormat {
    /** Language for commit title (e.g., 'en', 'es') */
    titleLanguage?: string;
    /** Language for commit body */
    bodyLanguage?: string;
    /** Whether to include technical details section */
    includeTechnical?: boolean;
    /** Whether to include changelog section */
    includeChangelog?: boolean;
}

/**
 * Project configuration loaded from .commit-wizard.json or package.json.
 */
export interface IProjectConfig {
    /** Project name */
    name: string;
    /** Project description */
    description: string;
    /** Current version string */
    version: string;
    /** Technology stack (e.g., ['TypeScript', 'Bun', 'React']) */
    techStack: string[];
    /** Target platform (e.g., 'Node.js', 'Browser', 'CLI') */
    targetPlatform: string;
    /** Project components for commit scoping */
    components?: IProjectComponent[];
    /** Commit format preferences */
    commitFormat?: ICommitFormat;
    /** Preferred AI provider */
    provider?: ProviderName;
    /** Preferred AI model */
    model?: string;
    /**
     * Extended wizard configuration loaded from `.commit-wizard.json`.
     *
     * Hierarchical: walk from cwd up to git root, merge with cwd-wins
     * semantics on scalars and union on arrays. Loaded by
     * `loadProjectConfigHierarchical()` in project-config.ts.
     *
     * This field is OPTIONAL — projects without `.commit-wizard.json`
     * still get a valid `IProjectConfig` with the legacy fields only.
     *
     * @see loadProjectConfigHierarchical
     */
    commitWizard?: ICommitWizardConfig;
}

/**
 * Extended wizard configuration schema (v2.2.0+).
 *
 * Sourced from `.commit-wizard.json` at the git root and/or any directory
 * between cwd and root. cwd wins on scalars, arrays are unioned.
 *
 * All fields are optional — a missing or empty file is a no-op.
 *
 * @example
 * ```json
 * {
 *   "projectContext": "Styx = media runtime e2e owned.",
 *   "scope": "sources-svc",
 *   "scopes": ["sources-svc", "catalog-svc"],
 *   "contextFiles": ["docs/specs/sources-svc.md"],
 *   "excludePatterns": ["star-dot-test-dot-ts", "dist-dir-double-star"],
 *   "includePatterns": ["apps-sources-svc-double-star-dot-ts"],
 *   "provider": "gemini",
 *   "model": "gemini-2.5-flash",
 *   "commitFormat": {
 *     "titleLanguage": "english",
 *     "bodyLanguage": "english"
 *   }
 * }
 * ```
 */
export const CommitWizardConfigSchema = type({
    /** Free-form project description injected into the AI prompt. */
    'projectContext?': 'string',
    /** Single scope hint (e.g. 'sources-svc'). */
    'scope?': 'string',
    /** Multiple scope hints; unioned across hierarchy levels. */
    'scopes?': 'string[]',
    /** File paths whose contents are concatenated into the prompt. */
    'contextFiles?': 'string[]',
    /** Glob patterns for files the wizard must NOT stage/commit. */
    'excludePatterns?': 'string[]',
    /** Glob patterns restricting which files may be staged. */
    'includePatterns?': 'string[]',
    /** Override AI provider. */
    'provider?': "'gemini' | 'groq' | 'openrouter'",
    /** Override AI model for the selected provider. */
    'model?': 'string',
    'commitFormat?': {
        'titleLanguage?': "'english' | 'spanish'",
        'bodyLanguage?': "'english' | 'spanish'",
    },
});

/**
 * Inferred TypeScript type from {@link CommitWizardConfigSchema}.
 *
 * Use this everywhere instead of redeclaring the shape — the schema is
 * the single source of truth.
 */
export type ICommitWizardConfig = typeof CommitWizardConfigSchema.infer;
