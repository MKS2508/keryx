/**
 * Provider barrel — factories, listings, and all provider classes.
 *
 * v3.1 split: text providers (agy + 4 legacy) and decision providers
 * (jev) are two separate registries with two separate factories.
 * See `src/types/provider.types.ts` for the interface distinction.
 *
 * @module providers
 */

import type {
    DecisionProviderName,
    IAIProvider,
    IDecisionProvider,
    ProviderName,
} from '../types/index.js';
import { AgyProvider } from './agy.js';
import { GeminiCliProvider } from './gemini-cli.js';
import { GeminiSdkProvider } from './gemini-sdk.js';
import { GroqProvider } from './groq.js';
import { JevProvider } from './jev.js';
import { OpenRouterProvider } from './openrouter.js';

export { AgyProvider } from './agy.js';
export { GeminiCliProvider } from './gemini-cli.js';
export { GeminiSdkProvider } from './gemini-sdk.js';
export { GroqProvider } from './groq.js';
export { JevProvider } from './jev.js';
export { OpenRouterProvider } from './openrouter.js';

/** Text provider factory map. One entry per name. */
const PROVIDER_MAP: Record<ProviderName, (model?: string) => IAIProvider> = {
    'agy': () => new AgyProvider(),
    'gemini-cli': () => new GeminiCliProvider(),
    'gemini-sdk': (model) => new GeminiSdkProvider(model),
    'groq': (model) => new GroqProvider(model),
    'openrouter': (model) => new OpenRouterProvider(model),
};

/** Decision provider factory map. One entry per name. */
const DECISION_PROVIDER_MAP: Record<
    DecisionProviderName,
    (model?: string) => IDecisionProvider
> = {
    'jev': (model) => new JevProvider(model),
};

/**
 * Auto-detection priority for text providers when no `--provider` is
 * given. `agy` is first because it is the v3.1 default. The gemini /
 * groq / openrouter entries are kept for backward compatibility and
 * as fallbacks when agy is not installed.
 */
const AUTO_DETECT_ORDER: ProviderName[] = [
    'agy',
    'gemini-sdk',
    'groq',
    'openrouter',
    'gemini-cli',
];

/**
 * Auto-detection priority for decision providers when no
 * `--decision-provider` is given. Today there is only one entry, but
 * the loop stays so adding a second decision provider is mechanical.
 */
const DECISION_AUTO_DETECT_ORDER: DecisionProviderName[] = ['jev'];

/**
 * Human-readable requirement for a missing text provider.
 * @param name - Provider identifier
 * @returns Requirement description
 */
function getProviderRequirement(name: ProviderName): string {
    switch (name) {
        case 'agy':
            return 'Install the agy CLI and ensure it is in your PATH.';
        case 'gemini-cli':
            return 'Install the Gemini CLI: https://ai.google.dev/gemini-api/docs/gemini-cli';
        case 'gemini-sdk':
            return 'Set the GEMINI_API_KEY environment variable.';
        case 'groq':
            return 'Set the GROQ_API_KEY environment variable.';
        case 'openrouter':
            return 'Set the OPENROUTER_API_KEY environment variable.';
    }
}

/**
 * Human-readable requirement for a missing decision provider.
 * @param name - Provider identifier
 * @returns Requirement description
 */
function getDecisionProviderRequirement(name: DecisionProviderName): string {
    switch (name) {
        case 'jev':
            return 'Set JEV_API_KEY (or TYPESAFE_API_KEY) — your TypeSafe AI API key.';
    }
}

/**
 * Create a text provider instance by name, or auto-detect the best
 * available one. Mirrors the v2.0 behavior.
 *
 * @param name - Provider name, or undefined for auto-detection
 * @param model - Optional model override
 * @returns Configured IAIProvider instance
 * @throws Error if no provider is available or the requested one is unavailable
 */
export function createProvider(name?: string, model?: string): IAIProvider {
    if (name) {
        const providerName = name as ProviderName;
        const factory = PROVIDER_MAP[providerName];
        if (!factory) {
            const available = Object.keys(PROVIDER_MAP).join(', ');
            throw new Error(
                `Unknown provider "${name}". Available providers: ${available}`,
            );
        }

        const provider = factory(model);
        if (!provider.isAvailable()) {
            throw new Error(
                `Provider "${name}" is not available. ${getProviderRequirement(providerName)}`,
            );
        }

        return provider;
    }

    for (const providerName of AUTO_DETECT_ORDER) {
        const factory = PROVIDER_MAP[providerName];
        const provider = factory(model);
        if (provider.isAvailable()) {
            return provider;
        }
    }

    throw new Error(
        `No AI provider available. Set one of these environment variables:\n` +
        `  - JEV_API_KEY (or TYPESAFE_API_KEY) -> jev decision provider (v3.1 default)\n` +
        `  - GEMINI_API_KEY    -> Gemini SDK\n` +
        `  - GROQ_API_KEY      -> Groq\n` +
        `  - OPENROUTER_API_KEY -> OpenRouter\n` +
        `  Or install the agy or gemini CLI and ensure it is in your PATH.`,
    );
}

/**
 * Create a decision provider instance by name, or auto-detect the
 * best available one. Returns `null` when no decision provider is
 * available (the hybrid pipeline is opt-in; keryx keeps working in
 * text-only mode when jev is not configured).
 *
 * @param name - Provider name, or undefined for auto-detection
 * @param model - Optional model override
 * @returns Configured IDecisionProvider instance, or null if unavailable
 */
export function createDecisionProvider(
    name?: string,
    model?: string,
): IDecisionProvider | null {
    if (name) {
        const providerName = name as DecisionProviderName;
        const factory = DECISION_PROVIDER_MAP[providerName];
        if (!factory) {
            const available = Object.keys(DECISION_PROVIDER_MAP).join(', ');
            throw new Error(
                `Unknown decision provider "${name}". Available decision providers: ${available}`,
            );
        }

        const provider = factory(model);
        if (!provider.isAvailable()) {
            throw new Error(
                `Decision provider "${name}" is not available. ${getDecisionProviderRequirement(providerName)}`,
            );
        }

        return provider;
    }

    for (const providerName of DECISION_AUTO_DETECT_ORDER) {
        const factory = DECISION_PROVIDER_MAP[providerName];
        const provider = factory(model);
        if (provider.isAvailable()) {
            return provider;
        }
    }

    return null;
}

/**
 * List all text providers with their availability status.
 * @returns Array of provider info objects
 */
export function listProviders(): Array<{
    name: string;
    id: ProviderName;
    available: boolean;
    requirement: string;
}> {
    return (Object.keys(PROVIDER_MAP) as ProviderName[]).map((id) => {
        const provider = PROVIDER_MAP[id]();
        return {
            name: provider.name,
            id,
            available: provider.isAvailable(),
            requirement: provider.isAvailable() ? '-' : getProviderRequirement(id),
        };
    });
}

/**
 * List all decision providers with their availability status.
 * @returns Array of decision provider info objects
 */
export function listDecisionProviders(): Array<{
    name: string;
    id: DecisionProviderName;
    available: boolean;
    requirement: string;
}> {
    return (Object.keys(DECISION_PROVIDER_MAP) as DecisionProviderName[]).map((id) => {
        const provider = DECISION_PROVIDER_MAP[id]();
        return {
            name: provider.name,
            id,
            available: provider.isAvailable(),
            requirement: provider.isAvailable() ? '-' : getDecisionProviderRequirement(id),
        };
    });
}
