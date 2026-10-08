/**
 * Project configuration type definitions.
 * @module types/config
 */

import type { DecisionProviderName, ProviderName } from './provider.types.js';

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
    /** Whether to propose release-note trailers (Release-Note, Breaking, ...) */
    includeTrailers?: boolean;
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
    /** Preferred AI provider (text — body writer) */
    provider?: ProviderName;
    /** Preferred AI model (text) */
    model?: string;
    /**
     * Preferred decision / classification provider.
     * v3.1 hybrid pipeline: the decision provider classifies the diff
     * BEFORE the text provider writes the commit body. Opt-in: when
     * unset or unavailable, keryx falls back to text-only.
     */
    decisionProvider?: DecisionProviderName;
    /** Target repos for subcommands (e.g. the styx checkout for release-notes) */
    styx?: {
        /** Absolute or cwd-relative path to the styx checkout */
        root?: string;
    };
}
