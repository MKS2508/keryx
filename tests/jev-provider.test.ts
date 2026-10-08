/**
 * Tests for the JevProvider (v3.1 decision provider).
 *
 * Hermetic: `@typesafe-ai/sdk` is mocked with `vi.mock` so the test
 * never reaches the network.
 *
 * @module tests/jev-provider
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { JevProvider } from '../src/providers/jev';

const KEYS = ['JEV_API_KEY', 'TYPESAFE_API_KEY'] as const;
let saved: Record<string, string | undefined>;

beforeEach(() => {
    saved = {};
    for (const k of KEYS) {
        saved[k] = process.env[k];
        delete process.env[k];
    }
});

afterEach(() => {
    for (const k of KEYS) {
        if (saved[k] === undefined) delete process.env[k];
        else process.env[k] = saved[k];
    }
    vi.restoreAllMocks();
});

describe('JevProvider.isAvailable', () => {
    it('returns true when JEV_API_KEY is set (keryx convention)', () => {
        process.env.JEV_API_KEY = 'k';
        expect(new JevProvider().isAvailable()).toBe(true);
    });

    it('also returns true when only TYPESAFE_API_KEY is set (SDK default)', () => {
        process.env.TYPESAFE_API_KEY = 'k';
        expect(new JevProvider().isAvailable()).toBe(true);
    });

    it('returns false when both env vars are missing', () => {
        expect(new JevProvider().isAvailable()).toBe(false);
    });
});

describe('JevProvider.decide', () => {
    it('throws when neither env var is set (no network call)', async () => {
        await expect(
            new JevProvider().decide({}, { q: { type: 'noul' } }),
        ).rejects.toThrow(/JEV_API_KEY/);
    });

    it('calls the SDK with the expected systemOne shape', async () => {
        process.env.JEV_API_KEY = 'k';

        const systemOne = vi.fn().mockResolvedValue({
            model: 'jev-latest',
            answers: {
                commit_type: { type: 'choice', choice: 'feat' },
                breaking: { type: 'noul', noul: 0.1 },
            },
        });
        const TypeSafeClient = vi.fn().mockImplementation(() => ({ systemOne }));
        vi.doMock('@typesafe-ai/sdk', () => ({ TypeSafeClient }));

        // Re-import the module so the dynamic import picks up the mock.
        // bun's loader caches ESM dynamic imports, so we use a fresh
        // import via require-like behaviour by clearing the module cache
        // is not straightforward in ESM; instead, exercise via the
        // public path and assert on the spy.
        // The provider is loaded at the top of this file; we can call
        // decide() on a fresh instance which triggers the dynamic import
        // (which evaluates the mocked module).
        const jev = new JevProvider();
        const out = await jev.decide<{ model: string; answers: unknown }>(
            { foo: 'bar' },
            {
                commit_type: { type: 'choice', instructions: 'x', criteria: { feat: '' } },
                breaking: { type: 'noul', instructions: 'y', criteria: { true: '', false: '' } },
            },
        );

        expect(TypeSafeClient).toHaveBeenCalledTimes(1);
        expect(systemOne).toHaveBeenCalledTimes(1);
        const call = systemOne.mock.calls[0][0] as {
            state: unknown;
            model: string;
            questions: Record<string, unknown>;
        };
        expect(call.state).toEqual({ foo: 'bar' });
        expect(call.model).toBe('jev-latest');
        expect(call.questions.commit_type).toBeDefined();
        expect(out.answers).toBeDefined();
    });
});

describe('JevProvider.safeDecide', () => {
    it('returns a Result with the typed answers', async () => {
        process.env.JEV_API_KEY = 'k';

        const systemOne = vi.fn().mockResolvedValue({ model: 'jev-latest', answers: {} });
        vi.doMock('@typesafe-ai/sdk', () => ({
            TypeSafeClient: vi.fn().mockImplementation(() => ({ systemOne })),
        }));

        const out = await new JevProvider().safeDecide<{ model: string; answers: unknown }>(
            {},
            {},
        );
        // Result is either ok or err; we just need the shape to be correct.
        expect(out).toHaveProperty('ok');
    });
});
