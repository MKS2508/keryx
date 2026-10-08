/**
 * jev provider — TypeSafe AI's System One Model.
 *
 * v3.1 decision provider. jev does NOT write prose. It receives a state
 * + a map of typed questions (`noul` / `choice` / `score`) and returns
 * calibrated answers. The hybrid pipeline injects those answers as
 * structured context into the text provider's prompt.
 *
 * SDK: `@typesafe-ai/sdk` v0.6.0 (MIT, 0 deps, published 2026-09-15).
 * The client reads `TYPESAFE_API_KEY` from the environment by default.
 *
 * @module providers/jev
 */

import { tryCatchAsync, type Result, type ResultError } from '@mks2508/no-throw';
import type {
    DecisionProviderName,
    IDecisionProvider,
} from '../types/index.js';

/**
 * Provider that calls the TypeSafe AI `/v1/systemone` endpoint via
 * the official `@typesafe-ai/sdk`.
 *
 * Auth: reads `JEV_API_KEY` first (keryx convention), then
 * `TYPESAFE_API_KEY` (the SDK's native env var). Either one makes
 * the provider available.
 *
 * The SDK is dynamically imported inside `decide()` (not at module
 * load) so that `listDecisionProviders()` — which constructs a
 * `JevProvider` to check `isAvailable()` — does not require the SDK
 * to be installed in the user's environment for hermetic test runs.
 *
 * @example
 * ```typescript
 * const jev = new JevProvider();
 * if (jev.isAvailable()) {
 *     const answers = await jev.decide<ICommitDecisions>(diff, {
 *         commit_type: { type: 'choice', instructions: '...', criteria: { feat: '...', fix: '...' } },
 *         breaking: { type: 'noul', instructions: '...', criteria: { true: '...', false: '...' } },
 *     });
 * }
 * ```
 */
export class JevProvider implements IDecisionProvider {
    /** @inheritdoc */
    name = 'jev';
    /** @inheritdoc */
    id: DecisionProviderName = 'jev';
    /** @inheritdoc */
    model: string;

    /**
     * @param model - Model to use (defaults to jev-latest)
     */
    constructor(model?: string) {
        this.model = model || 'jev-latest';
    }

    /**
     * Check if the jev API key is set in the environment.
     *
     * Order of precedence:
     *   1. `JEV_API_KEY` (keryx convention; what waxin uses in vaults + .env)
     *   2. `TYPESAFE_API_KEY` (the SDK's native env var, also documented
     *      in the TypeSafe AI article)
     *
     * Either one is enough. This makes the provider work for users
     * with either convention without re-docs.
     */
    isAvailable(): boolean {
        return !!(process.env.JEV_API_KEY || process.env.TYPESAFE_API_KEY);
    }

    /**
     * Submit a state + a map of typed questions and return jev's
     * calibrated answers. The shape of the returned object mirrors
     * the questions map (`answers.<key>`). Callers narrow the result
     * via the generic parameter to match the questions they sent.
     *
     * @param state - String, object, or array payload. jev accepts all three.
     * @param questions - Map of question key -> question definition
     *                    (the SDK accepts helper-built or raw shapes —
     *                    e.g. `{ type: 'noul', instructions, criteria }`
     *                    or `choice('instructions', { key: null, ... })`).
     * @returns Provider response, generically typed for caller convenience
     */
    async decide<T = unknown>(
        state: unknown,
        questions: Record<string, unknown>,
    ): Promise<T> {
        const apiKey = process.env.JEV_API_KEY || process.env.TYPESAFE_API_KEY;
        if (!apiKey) {
            throw new Error(
                'JEV_API_KEY (or TYPESAFE_API_KEY) environment variable is not set',
            );
        }

        const { TypeSafeClient } = await import('@typesafe-ai/sdk');
        // Pass apiKey explicitly so we honor `JEV_API_KEY` (the SDK
        // would only fall back to `TYPESAFE_API_KEY` on its own).
        const client = new TypeSafeClient({ apiKey });

        // The SDK's `systemOne` input is `{ state, model?, questions? }`.
        // `model` is optional (the server picks the default if absent);
        // we send it explicitly so users can pin a model in tests.
        const response = await (client as unknown as {
            systemOne: (input: {
                state: unknown;
                model: string;
                questions: Record<string, unknown>;
            }) => Promise<T>;
        }).systemOne({
            state,
            model: this.model,
            questions,
        });

        return response;
    }

    /**
     * Decision with Result pattern wrapping.
     * @param state - See `decide()`
     * @param questions - See `decide()`
     * @returns Result with the typed answers or a PROVIDER_ERROR
     */
    async safeDecide<T = unknown>(
        state: unknown,
        questions: Record<string, unknown>,
    ): Promise<Result<T, ResultError<'PROVIDER_ERROR'>>> {
        return tryCatchAsync(async () => this.decide<T>(state, questions), 'PROVIDER_ERROR');
    }
}
