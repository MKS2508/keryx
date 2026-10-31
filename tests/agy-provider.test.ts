/**
 * Tests for the AgyProvider (v3.1 default text provider).
 *
 * Hermetic: `Bun.spawnSync` is stubbed via `vi.spyOn` so the test
 * does not need a real `agy` binary on PATH.
 *
 * @module tests/agy-provider
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AgyProvider } from '../src/providers/agy';

interface SpawnResult {
    exitCode: number;
    stdout: Buffer | null;
    stderr: Buffer | null;
}

function makeSpawn(exitCode: number, stdout: string, stderr = ''): SpawnResult {
    return {
        exitCode,
        stdout: Buffer.from(stdout),
        stderr: Buffer.from(stderr),
    };
}

let spy: ReturnType<typeof vi.spyOn> | undefined;

beforeEach(() => {
    // Bun.spawnSync has heavy overloads that confuse vi.spyOn inference;
    // cast through `any` for the test surface.
    spy = vi.spyOn(Bun, 'spawnSync') as any;
});

afterEach(() => {
    spy?.mockRestore();
    spy = undefined;
});

describe('AgyProvider.isAvailable', () => {
    it('returns true when `which agy` exits 0', () => {
        (spy as any).mockImplementation(() => makeSpawn(0, '/usr/local/bin/agy\n'));
        expect(new AgyProvider().isAvailable()).toBe(true);
    });

    it('returns false when `which agy` exits non-zero', () => {
        (spy as any).mockImplementation(() => makeSpawn(1, ''));
        expect(new AgyProvider().isAvailable()).toBe(false);
    });

    it('returns false when spawnSync throws (no shell)', () => {
        (spy as any).mockImplementation(() => {
            throw new Error('spawnSync not available');
        });
        expect(new AgyProvider().isAvailable()).toBe(false);
    });
});

describe('AgyProvider.generate', () => {
    it('returns stdout when agy exits 0', async () => {
        (spy as any).mockImplementation(() => makeSpawn(0, 'feat: hello world\n'));
        const out = await new AgyProvider().generate('the prompt');
        expect(out).toBe('feat: hello world\n');
    });

    it('throws with stderr text when agy exits non-zero', async () => {
        (spy as any).mockImplementation(() =>
            makeSpawn(2, '', 'auth failed: no API key'),
        );
        await expect(new AgyProvider().generate('x')).rejects.toThrow(
            /auth failed: no API key/,
        );
    });

    it('returns empty string when stdout is null', async () => {
        (spy as any).mockImplementation(() => makeSpawn(0, ''));
        const out = await new AgyProvider().generate('x');
        expect(out).toBe('');
    });
});
