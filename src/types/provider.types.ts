/**
 * Provider type definitions for AI commit generation backends.
 *
 * v3.1 split: text providers (`IAIProvider`) and decision providers
 * (`IDecisionProvider`) are two distinct interfaces. A text provider
 * returns prose (used for the commit body). A decision provider returns
 * typed answers — no prose — and is used to classify the diff before
 * the text provider writes. The factory in `src/providers/index.ts`
 * is the only registration point for both kinds.
 *
 * @module types/provider
 */

/**
 * Text provider identifiers. The registry lives in
 * `src/providers/index.ts` `PROVIDER_MAP`.
 *
 * `agy` (v3.1) is the new default — a heavy CLI-backed LLM. The
 * gemini/groq/openrouter entries are kept for backward compatibility
 * and as fallbacks when agy is not installed.
 */
export type ProviderName =
    | 'gemini-cli'
    | 'gemini-sdk'
    | 'groq'
    | 'openrouter'
    | 'agy';

/**
 * Decision provider identifiers. Today only `jev` (TypeSafe's System
 * One Model). Adding a second decision provider (e.g. an LLM-as-judge
 * fallback) means extending this union + `DECISION_PROVIDER_MAP`.
 */
export type DecisionProviderName = 'jev';

/**
 * Common interface for text-generating AI providers.
 *
 * Used by `CommitGenerator` to write the commit body and by
 * `runReleaseNotes` to write trailer proposals. The body is markdown
 * that the downstream `GeminiResponseParser` understands.
 *
 * @example
 * ```typescript
 * const provider: IAIProvider = createProvider('groq');
 * if (provider.isAvailable()) {
 *     const response = await provider.generate(prompt);
 * }
 * ```
 */
export interface IAIProvider {
    /** Human-readable provider name */
    name: string;
    /** Provider identifier */
    id: ProviderName;
    /** Model being used */
    model: string;
    /**
     * Generate a text response from the AI model.
     * @param prompt - The prompt to send
     * @returns The AI-generated text response
     */
    generate(prompt: string): Promise<string>;
    /**
     * Check if this provider is available (API key set, binary found, etc.).
     * @returns Whether the provider can be used
     */
    isAvailable(): boolean;
}

/**
 * Common interface for decision / classification providers.
 *
 * A decision provider does NOT write prose. It receives a state and a
 * map of typed questions and returns typed answers with calibrated
 * probabilities. The hybrid pipeline injects those answers into the
 * text provider's prompt as structured context.
 *
 * Today only `JevProvider` (System One Model from TypeSafe AI) implements
 * this. The question shape matches the `@typesafe-ai/sdk` SDK's
 * `systemOne` input: `noul` (yes/no with probability), `choice`
 * (one of N options with probabilities), `score` (weighted over a
 * rubric).
 *
 * @example
 * ```typescript
 * const jev: IDecisionProvider = createDecisionProvider('jev');
 * if (jev.isAvailable()) {
 *     const out = await jev.decide(diff, {
 *         commit_type: { type: 'choice', ... },
 *         breaking: { type: 'noul', ... },
 *     });
 * }
 * ```
 */
export interface IDecisionProvider {
    /** Human-readable provider name */
    name: string;
    /** Provider identifier */
    id: DecisionProviderName;
    /** Model being used */
    model: string;
    /**
     * Submit a state + typed questions and get back typed answers.
     * @param state - Any JSON-serializable payload (string, object, or
     *                array). Typed as `unknown` because keryx passes
     *                structured analysis objects to jev, and the SDK
     *                accepts whatever serializes.
     * @param questions - Map of question key -> SDK-shaped question
     *                    (e.g. `{ type: 'noul', instructions, criteria }`)
     * @returns Provider-specific typed answer; callers narrow the shape
     *          via the generic parameter to match the questions they sent
     */
    decide<T = unknown>(
        state: unknown,
        questions: Record<string, unknown>,
    ): Promise<T>;
    /**
     * Check if this provider is available (API key set, etc.).
     * @returns Whether the provider can be used
     */
    isAvailable(): boolean;
}
