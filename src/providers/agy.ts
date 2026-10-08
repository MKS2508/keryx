/**
 * agy provider — calls the `agy` CLI binary in non-interactive mode.
 *
 * v3.1 default text provider. agy is a heavy, general-purpose LLM CLI
 * (the "LLM Gordo" in the project notes); we use it for the commit
 * body, mirroring the `gemini-cli` pattern.
 *
 * No API key required — just needs the `agy` binary in PATH.
 *
 * @module providers/agy
 */

import { tryCatchAsync, type Result, type ResultError } from '@mks2508/no-throw';
import type { IAIProvider, ProviderName } from '../types/index.js';

/**
 * Provider that pipes prompts to the local `agy` CLI binary in
 * `--print` mode. Mirrors `GeminiCliProvider` but is the v3.1 default
 * for new projects.
 *
 * @example
 * ```typescript
 * const provider = new AgyProvider();
 * if (provider.isAvailable()) {
 *     const result = await provider.generate(prompt);
 * }
 * ```
 */
export class AgyProvider implements IAIProvider {
    /** @inheritdoc */
    name = 'agy';
    /** @inheritdoc */
    id: ProviderName = 'agy';
    /** @inheritdoc */
    model = 'agy-default';

    /**
     * Check if the `agy` binary is available in PATH.
     * @returns Whether the agy CLI binary was found
     */
    isAvailable(): boolean {
        try {
            const result = Bun.spawnSync(['which', 'agy'], {
                stdout: 'pipe',
                stderr: 'pipe',
            });
            return result.exitCode === 0;
        } catch {
            return false;
        }
    }

    /**
     * Generate a response by running `agy -p <prompt>` (non-interactive
     * single-prompt mode) and returning stdout.
     *
     * `--dangerously-skip-permissions` is required because agy (like
     * Claude Code) prompts the user for permission on any tool call
     * (Bash, Read, etc.) — in headless mode, the prompt auto-denies,
     * and agy exits with "no output produced". This skips the prompt
     * gate. Keryx only feeds it a single prompt and discards all tool
     * use, so the safety surface is minimal (no shell, no filesystem).
     *
     * @param prompt - The prompt text to send
     * @returns The CLI output text
     */
    async generate(prompt: string): Promise<string> {
        const result = Bun.spawnSync(
            ['agy', '-p', prompt, '--dangerously-skip-permissions'],
            {
                cwd: process.cwd(),
                stdout: 'pipe',
                stderr: 'pipe',
            },
        );

        if (result.exitCode !== 0) {
            const error = result.stderr?.toString() || 'agy CLI failed';
            throw new Error(`agy CLI error: ${error}`);
        }

        return result.stdout?.toString() || '';
    }

    /**
     * Generate with Result pattern wrapping.
     * @param prompt - The prompt text to send
     * @returns Result with the generated text or a PROVIDER_ERROR
     */
    async safeGenerate(prompt: string): Promise<Result<string, ResultError<'PROVIDER_ERROR'>>> {
        return tryCatchAsync(async () => this.generate(prompt), 'PROVIDER_ERROR');
    }
}
