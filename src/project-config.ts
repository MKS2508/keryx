#!/usr/bin/env bun

/**
 * Loadable project configuration for gemini-commit-wizard.
 *
 * Loads config from (in priority order):
 * 1. `.commit-wizard.json` in project root
 * 2. `package.json` → `"commitWizard": { ... }` key
 * 3. Fallback to auto-detected config (scan package.json name/description)
 *
 * @module project-config
 */

import { readFileSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { type } from 'arktype';
import logger from '@mks2508/better-logger';
// Alias so the file's existing `log.xxx(...)` call sites stay unchanged.
const log = logger;
import { CommitWizardConfigSchema } from './types/config.types.js';
import type { IProjectConfig, ICommitWizardConfig } from './types/index.js';


/**
 * Load project configuration from the project root.
 *
 * Priority order:
 * 1. `.commit-wizard.json` in projectRoot
 * 2. `package.json` → `commitWizard` key
 * 3. Auto-detect from `package.json` fields
 *
 * @param projectRoot - Path to the project root directory
 * @returns Resolved project configuration
 */
export function loadProjectConfig(projectRoot: string): IProjectConfig {
    // 1. Try .commit-wizard.json
    const wizardConfigPath = join(projectRoot, '.commit-wizard.json');
    if (existsSync(wizardConfigPath)) {
        try {
            const raw = readFileSync(wizardConfigPath, 'utf-8');
            const config = JSON.parse(raw) as Partial<IProjectConfig>;
            log.info('Loaded config from .commit-wizard.json');
            return fillDefaults(config);
        } catch (error) {
            log.warn(`Failed to parse .commit-wizard.json: ${error}`);
        }
    }

    // 2. Try package.json → commitWizard key
    const packageJsonPath = join(projectRoot, 'package.json');
    if (existsSync(packageJsonPath)) {
        try {
            const raw = readFileSync(packageJsonPath, 'utf-8');
            const pkg = JSON.parse(raw);

            if (pkg.commitWizard && typeof pkg.commitWizard === 'object') {
                log.info('Loaded config from package.json → commitWizard');
                return fillDefaults(pkg.commitWizard as Partial<IProjectConfig>);
            }

            // 3. Auto-detect from package.json fields
            return autoDetectConfig(pkg, projectRoot);
        } catch (error) {
            log.warn(`Failed to parse package.json: ${error}`);
        }
    }

    // 4. Ultimate fallback
    return fallbackConfig(projectRoot);
}

/**
 * Fill missing fields with sensible defaults.
 * @param partial - Partial project configuration
 * @returns Full project configuration with defaults applied
 */
function fillDefaults(partial: Partial<IProjectConfig>): IProjectConfig {
    return {
        name: partial.name || 'Unknown Project',
        description: partial.description || 'Software project',
        version: partial.version || '0.0.0',
        techStack: partial.techStack || ['TypeScript'],
        targetPlatform: partial.targetPlatform || 'Cross-platform',
        components: partial.components,
        commitFormat: {
            titleLanguage: partial.commitFormat?.titleLanguage || 'english',
            bodyLanguage: partial.commitFormat?.bodyLanguage || 'spanish',
            includeTechnical: partial.commitFormat?.includeTechnical !== false,
            includeChangelog: partial.commitFormat?.includeChangelog !== false,
        },
        provider: partial.provider,
        model: partial.model,
    };
}

/**
 * Auto-detect project config from package.json fields.
 * @param pkg - Parsed package.json content
 * @param projectRoot - Project root directory
 * @returns Detected project configuration
 */
function autoDetectConfig(pkg: any, projectRoot: string): IProjectConfig {
    const techStack = detectTechStack(pkg);
    log.info(`Auto-detected config from package.json (${pkg.name || 'unknown'})`);

    return fillDefaults({
        name: pkg.name || 'Unknown Project',
        description: pkg.description || `Project at ${projectRoot}`,
        version: pkg.version || '0.0.0',
        techStack,
        targetPlatform: detectPlatform(pkg),
    });
}

/**
 * Detect tech stack from package.json dependencies.
 * @param pkg - Parsed package.json content
 * @returns Array of detected technology names
 */
function detectTechStack(pkg: any): string[] {
    const stack: string[] = [];
    const allDeps = {
        ...pkg.dependencies,
        ...pkg.devDependencies,
    };

    if (pkg.engines?.bun || allDeps['bun-types']) stack.push('Bun');
    else if (pkg.engines?.node) stack.push('Node.js');

    if (allDeps['typescript'] || allDeps['@types/node']) stack.push('TypeScript');
    else stack.push('JavaScript');

    if (allDeps['react'] || allDeps['react-dom']) stack.push('React');
    if (allDeps['next']) stack.push('Next.js');
    if (allDeps['vue']) stack.push('Vue');
    if (allDeps['svelte']) stack.push('Svelte');
    if (allDeps['express']) stack.push('Express');
    if (allDeps['elysia']) stack.push('Elysia');
    if (allDeps['hono']) stack.push('Hono');

    if (allDeps['vitest']) stack.push('Vitest');
    if (allDeps['tailwindcss']) stack.push('Tailwind CSS');
    if (allDeps['prisma'] || allDeps['@prisma/client']) stack.push('Prisma');
    if (allDeps['drizzle-orm']) stack.push('Drizzle');

    if (stack.length === 0) stack.push('JavaScript');

    return stack;
}

/**
 * Detect target platform from package.json hints.
 * @param pkg - Parsed package.json content
 * @returns Platform description string
 */
function detectPlatform(pkg: any): string {
    const allDeps = { ...pkg.dependencies, ...pkg.devDependencies };

    if (allDeps['react-native'] || allDeps['expo']) return 'Mobile (React Native)';
    if (allDeps['electron']) return 'Desktop (Electron)';
    if (allDeps['@tauri-apps/api']) return 'Desktop (Tauri)';
    if (allDeps['next'] || allDeps['nuxt']) return 'Web (Full-stack)';
    if (allDeps['react'] || allDeps['vue'] || allDeps['svelte']) return 'Web (Frontend)';
    if (allDeps['express'] || allDeps['elysia'] || allDeps['hono']) return 'Server (Backend)';

    return 'Cross-platform';
}

/**
 * Ultimate fallback when no package.json exists.
 *
 * Scans the project root for tell-tale files (Cargo.toml, pyproject.toml,
 * go.mod, etc.) to detect the tech stack and platform, rather than
 * defaulting to "Unknown Project" + "Cross-platform".
 *
 * @param projectRoot - Project root directory
 * @returns Fallback project configuration
 */
function fallbackConfig(projectRoot: string): IProjectConfig {
    const { existsSync } = require('fs') as typeof import('fs');
    const { join } = require('path') as typeof import('path');

    const dirName = projectRoot.split('/').pop() || 'project';
    log.info(`Using fallback config for "${dirName}"`);

    const techStack: string[] = [];
    let targetPlatform: 'Web (Frontend)' | 'Server (Backend)' | 'Desktop (Tauri)' | 'CLI' | 'Library' | 'Cross-platform' = 'Cross-platform';

    if (existsSync(join(projectRoot, 'Cargo.toml'))) {
        techStack.push('Rust');
    }
    if (existsSync(join(projectRoot, 'pyproject.toml')) || existsSync(join(projectRoot, 'requirements.txt'))) {
        techStack.push('Python');
    }
    if (existsSync(join(projectRoot, 'go.mod'))) {
        techStack.push('Go');
    }
    if (existsSync(join(projectRoot, 'bun.lock')) || existsSync(join(projectRoot, 'bun.lockb'))) {
        techStack.push('Bun');
    } else if (existsSync(join(projectRoot, 'package-lock.json')) || existsSync(join(projectRoot, 'yarn.lock'))) {
        techStack.push('Node.js');
    }
    if (existsSync(join(projectRoot, 'tsconfig.json'))) {
        techStack.push('TypeScript');
    }
    if (existsSync(join(projectRoot, 'src-tauri', 'Cargo.toml'))) {
        techStack.push('Tauri');
        targetPlatform = 'Desktop (Tauri)';
    }
    if (existsSync(join(projectRoot, 'index.html')) || existsSync(join(projectRoot, 'public'))) {
        if (targetPlatform === 'Cross-platform') targetPlatform = 'Web (Frontend)';
    }

    if (techStack.length === 0) techStack.push('Unknown');
    if (techStack.length === 1 && techStack[0] === 'TypeScript') {
        // TS alone is ambiguous. Default to Library when src/ exists.
        if (targetPlatform === 'Cross-platform') {
            targetPlatform = existsSync(join(projectRoot, 'src')) ? 'Library' : 'Cross-platform';
        }
    }

    return fillDefaults({
        name: dirName,
        description: `Project at ${projectRoot}`,
        techStack,
        targetPlatform,
    });
}

// ============================================================================
// v2.2.0 — Hierarchical .commit-wizard.json loader (additive, opt-in)
// ============================================================================

/**
 * Name of the per-directory wizard config file.
 *
 * Used by {@link loadProjectConfigHierarchical} to walk up the tree from
 * cwd to the git root, loading one config per directory that has it.
 *
 * Public so consumers can write tests against a fixture directory using
 * the same filename the wizard expects.
 */
export const WIZARD_CONFIG_FILENAME = '.commit-wizard.json';

/**
 * Find the git repository root by walking up looking for a `.git` entry.
 *
 * Stops at the first directory that contains `.git` (file or directory —
 * both `git` worktrees and submodules are supported). Returns `null` if
 * no git root is found before reaching the filesystem root.
 *
 * @param startDir - Directory to start the walk from
 * @returns Absolute path to the git root, or `null`
 */
export function findGitRoot(startDir: string): string | null {
    let current = startDir;
    const seen = new Set<string>();
    while (true) {
        if (seen.has(current)) return null; // safety against symlink loops
        seen.add(current);
        if (existsSync(join(current, '.git'))) return current;
        const parent = dirname(current);
        if (parent === current) return null; // reached filesystem root
        current = parent;
    }
}

/**
 * Raw shape of a `.commit-wizard.json` file on disk.
 *
 * Mirrors {@link ICommitWizardConfig} but everything is optional and
 * `unknown`-shaped — we validate with arktype before returning the
 * typed shape.
 */
type RawWizardConfig = Record<string, unknown>;

/**
 * Read and validate a single `.commit-wizard.json` file.
 *
 * On missing file → returns `null` (silent — that just means "no config
 * at this level"). On invalid JSON or schema violation → logs a warning
 * and returns `null` (does NOT throw, because a typo'd config file
 * shouldn't kill the whole commit flow).
 *
 * @param dirPath - Absolute path to the directory to read from
 * @returns Validated {@link ICommitWizardConfig} or `null`
 */
export function readWizardConfigAt(dirPath: string): ICommitWizardConfig | null {
    const configPath = join(dirPath, WIZARD_CONFIG_FILENAME);
    if (!existsSync(configPath)) return null;

    let raw: RawWizardConfig;
    try {
        raw = JSON.parse(readFileSync(configPath, 'utf-8')) as RawWizardConfig;
    } catch (err) {
        log.warn(`Failed to parse ${configPath}: ${(err as Error).message}`);
        return null;
    }

    const result = CommitWizardConfigSchema(raw);
    if (result instanceof type.errors) {
        log.warn(`Invalid ${configPath}: ${result.summary}`);
        return null;
    }
    return result as ICommitWizardConfig;
}

/**
 * Walk from `cwd` up to the git root, collecting every `.commit-wizard.json`
 * along the way (cwd included, root included).
 *
 * Order of returned configs: deepest (cwd) FIRST, root LAST. The merge
 * function uses this order so that cwd wins on scalar conflicts.
 *
 * @param cwd - Directory to start walking from
 * @returns Array of configs from deepest to shallowest
 */
export function collectWizardConfigs(cwd: string): ICommitWizardConfig[] {
    const gitRoot = findGitRoot(cwd) ?? cwd;
    const collected: ICommitWizardConfig[] = [];
    let current = cwd;
    const seen = new Set<string>();
    while (true) {
        if (seen.has(current)) break;
        seen.add(current);
        const cfg = readWizardConfigAt(current);
        if (cfg) collected.push(cfg);
        if (current === gitRoot) break;
        const parent = dirname(current);
        if (parent === current) break;
        current = parent;
    }
    return collected;
}

/**
 * Merge multiple {@link ICommitWizardConfig} objects with deep-cwd-wins
 * semantics.
 *
 * - **Scalars** (strings, provider, model, commitFormat): the FIRST config
 *   to define a key wins. Since `collectWizardConfigs` returns cwd-first,
 *   that means cwd overrides root.
 * - **Arrays** (`scopes`, `contextFiles`, `excludePatterns`, `includePatterns`):
 *   unioned in discovery order, deduplicated. cwd arrays come first.
 *
 * Pure function — safe to test without filesystem.
 *
 * @param configs - Configs from deepest to shallowest (cwd-first)
 * @returns Merged config, or empty object if `configs` is empty
 */
export function mergeWizardConfigs(
    configs: ICommitWizardConfig[],
): ICommitWizardConfig {
    if (configs.length === 0) return {};
    const merged: ICommitWizardConfig = {};
    const seenArrays: Record<keyof Pick<ICommitWizardConfig, 'scopes' | 'contextFiles' | 'excludePatterns' | 'includePatterns'>, Set<string>> = {
        scopes: new Set(),
        contextFiles: new Set(),
        excludePatterns: new Set(),
        includePatterns: new Set(),
    };

    for (const cfg of configs) {
        if (cfg.projectContext !== undefined && merged.projectContext === undefined) {
            merged.projectContext = cfg.projectContext;
        }
        if (cfg.scope !== undefined && merged.scope === undefined) {
            merged.scope = cfg.scope;
        }
        if (cfg.provider !== undefined && merged.provider === undefined) {
            merged.provider = cfg.provider;
        }
        if (cfg.model !== undefined && merged.model === undefined) {
            merged.model = cfg.model;
        }
        if (cfg.commitFormat !== undefined && merged.commitFormat === undefined) {
            merged.commitFormat = cfg.commitFormat;
        }

        // Arrays: union with cwd-first ordering preserved
        for (const key of ['scopes', 'contextFiles', 'excludePatterns', 'includePatterns'] as const) {
            const items = cfg[key];
            if (!items) continue;
            const seen = seenArrays[key];
            for (const item of items) {
                if (!seen.has(item)) {
                    seen.add(item);
                    if (!merged[key]) merged[key] = [];
                    (merged[key] as string[]).push(item);
                }
            }
        }
    }

    return merged;
}

/**
 * Load the project config AND merge in the hierarchical `.commit-wizard.json`
 * discovery (v2.2.0+).
 *
 * Strategy:
 * 1. Resolve `projectRoot` from `cwd` via `findGitRoot` (falls back to cwd).
 * 2. Call the existing `loadProjectConfig(projectRoot)` to populate the
 *    legacy fields (name, description, techStack, …).
 * 3. Walk from `cwd` up to `projectRoot`, collect every `.commit-wizard.json`,
 *    merge with cwd-wins semantics.
 * 4. Attach the merged wizard config to `result.commitWizard`.
 *
 * Backwards compatible: when no `.commit-wizard.json` exists anywhere in
 * the tree, `commitWizard` is left undefined and the legacy `IProjectConfig`
 * shape is preserved exactly.
 *
 * @param cwd - Directory to start the discovery walk from (defaults to process.cwd())
 * @returns Project config with optional `commitWizard` field populated
 */
export function loadProjectConfigHierarchical(cwd: string = process.cwd()): IProjectConfig {
    const projectRoot = findGitRoot(cwd) ?? cwd;
    const baseConfig = loadProjectConfig(projectRoot);

    const configs = collectWizardConfigs(cwd);
    if (configs.length === 0) {
        log.debug(`No ${WIZARD_CONFIG_FILENAME} found from ${cwd} up to ${projectRoot}`);
        return baseConfig;
    }

    const mergedWizard = mergeWizardConfigs(configs);
    log.info(
        `Merged ${configs.length} ${WIZARD_CONFIG_FILENAME} file(s) ` +
        `(cwd=${cwd}, root=${projectRoot})`,
    );

    return {
        ...baseConfig,
        commitWizard: mergedWizard,
    };
}
