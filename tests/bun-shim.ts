/**
 * Vitest global setup — declares a minimal `Bun` shim so the
 * production code paths that use `Bun.spawnSync` are reachable
 * when vitest runs in node env. The shim is a no-op stub by
 * default; individual tests replace it via `vi.spyOn`.
 *
 * Without this shim, every test file that imports a keryx provider
 * (which uses `Bun.spawnSync`) crashes with `Bun is not defined`.
 *
 * @module tests/bun-shim
 */

declare global {
    // The shim is intentionally minimal — only what keryx providers use.
    // Add fields here if more `Bun.*` APIs get used in production code.
    // eslint-disable-next-line no-var
    var Bun: {
        spawnSync: (
            cmd: string[] | { cmd: string[]; [key: string]: unknown },
            options?: { stdin?: unknown; stdout?: unknown; stderr?: unknown; cwd?: string; [key: string]: unknown },
        ) => { exitCode: number; stdout: Buffer | null; stderr: Buffer | null };
    };
}

if (typeof globalThis.Bun === 'undefined') {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (globalThis as any).Bun = {
        spawnSync: () => ({ exitCode: 0, stdout: Buffer.from(''), stderr: Buffer.from('') }),
    };
}

export {};
