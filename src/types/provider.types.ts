/**
 * Provider type definitions for AI commit generation backends.
 * @module types/provider
 */

/**
 * Supported AI provider identifiers.
 *
 * ## Adding future providers (agy, Jev)
 *
 * The factory (`src/providers/index.ts` `PROVIDER_MAP`) is the only
 * registration point — one entry per name mapping to a
 * `(model?) => IAIProvider` factory. Two providers are planned for v3.x:
 *
 * - **`agy`** — the Gemini CLI-based agent runtime. CLI-provider shape:
 *   copy the `GeminiCliProvider` pattern (`src/providers/gemini-cli.ts`) —
 *   `isAvailable()` probes the binary, `generate()` pipes the prompt to
 *   the CLI over stdin via `Bun.spawnSync` and returns stdout.
 * - **`jev`** — typesafe.ai. SDK-provider shape: copy the
 *   `GeminiSdkProvider` pattern (`src/providers/gemini-sdk.ts`) —
 *   `isAvailable()` checks the env key, `generate()` awaits the SDK call.
 *
 * In both cases: add the id to this union, the class to `src/providers/`,
 * the entry in `PROVIDER_MAP` + `AUTO_DETECT_ORDER` (if it should
 * auto-detect), and a `getProviderRequirement` string so the failure
 * message tells the user what to install.
 */
export type ProviderName = 'gemini-cli' | 'gemini-sdk' | 'groq' | 'openrouter';

/**
 * Common interface for all AI providers.
 *
 * @example
 * ```typescript
 * const provider: IAIProvider = createProvider('groq');
 * if (provider.isAvailable()) {
 *   const response = await provider.generate(prompt);
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
     * Generate a response from the AI model.
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
