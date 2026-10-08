/**
 * Tests for the provider factory.
 *
 * v3.1 split: text providers and decision providers are two separate
 * registries. Each test sets/clears the relevant env vars hermetically.
 *
 * @module tests/providers
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
    createProvider,
    createDecisionProvider,
    listProviders,
    listDecisionProviders,
} from '../src/providers/index';
import { AgyProvider } from '../src/providers/agy';
import { GeminiCliProvider } from '../src/providers/gemini-cli';
import { GeminiSdkProvider } from '../src/providers/gemini-sdk';
import { GroqProvider } from '../src/providers/groq';
import { JevProvider } from '../src/providers/jev';
import { OpenRouterProvider } from '../src/providers/openrouter';

const KEYS = [
    'GEMINI_API_KEY',
    'GROQ_API_KEY',
    'OPENROUTER_API_KEY',
    'JEV_API_KEY',
    'TYPESAFE_API_KEY',
] as const;
let saved: Record<string, string | undefined>;
let spawnSpy: ReturnType<typeof vi.spyOn> | undefined;

beforeEach(() => {
    saved = {};
    for (const k of KEYS) {
        saved[k] = process.env[k];
        delete process.env[k];
    }
    // Pretend every CLI binary is installed so createProvider does
    // not throw on the `which` check.
    spawnSpy = vi.spyOn(Bun, 'spawnSync').mockReturnValue({
        exitCode: 0,
        stdout: Buffer.from('/usr/local/bin/agy\n'),
        stderr: Buffer.from(''),
    }) as any;
});

afterEach(() => {
    for (const k of KEYS) {
        if (saved[k] === undefined) delete process.env[k];
        else process.env[k] = saved[k];
    }
    spawnSpy?.mockRestore();
    spawnSpy = undefined;
});

describe('createProvider — registry by name (text)', () => {
    it('resolves each registered name to its class', () => {
        process.env.GEMINI_API_KEY = 'test-key';
        process.env.GROQ_API_KEY = 'test-key';
        process.env.OPENROUTER_API_KEY = 'test-key';

        expect(createProvider('gemini-sdk')).toBeInstanceOf(GeminiSdkProvider);
        expect(createProvider('groq')).toBeInstanceOf(GroqProvider);
        expect(createProvider('openrouter')).toBeInstanceOf(OpenRouterProvider);
        expect(createProvider('gemini-cli')).toBeInstanceOf(GeminiCliProvider);
    });

    it('resolves agy to the AgyProvider class', () => {
        const p = createProvider('agy');
        expect(p).toBeInstanceOf(AgyProvider);
    });

    it('honors the model override', () => {
        process.env.GROQ_API_KEY = 'test-key';
        const p = createProvider('groq', 'llama-3.1-8b-instant');
        expect(p.model).toBe('llama-3.1-8b-instant');
    });

    it('fails loudly on an unknown name, listing the available ones', () => {
        expect(() => createProvider('claude')).toThrow(/Unknown provider "claude"/);
        expect(() => createProvider('claude')).toThrow(/gemini-cli/);
        expect(() => createProvider('claude')).toThrow(/agy/);
        expect(() => createProvider('claude')).toThrow(/openrouter/);
    });

    it('refuses a registered provider whose requirement is missing', () => {
        expect(() => createProvider('groq')).toThrow(/GROQ_API_KEY/);
    });
});

describe('createProvider — auto-detection order', () => {
    it('prefers agy when its binary is available (v3.1 default)', () => {
        // spawnSpy makes `which agy` return exit 0, so agy wins.
        process.env.GEMINI_API_KEY = 'k';
        process.env.GROQ_API_KEY = 'k';
        expect(createProvider().id).toBe('agy');
    });

    it('falls back to gemini-sdk, then groq, then openrouter', () => {
        // Make agy unavailable for this case.
        (spawnSpy as any).mockReturnValue({
            exitCode: 1,
            stdout: Buffer.from(''),
            stderr: Buffer.from(''),
        });
        process.env.GEMINI_API_KEY = 'k';
        expect(createProvider().id).toBe('gemini-sdk');

        delete process.env.GEMINI_API_KEY;
        process.env.GROQ_API_KEY = 'k';
        expect(createProvider().id).toBe('groq');

        delete process.env.GROQ_API_KEY;
        process.env.OPENROUTER_API_KEY = 'k';
        expect(createProvider().id).toBe('openrouter');
    });
});

describe('listProviders', () => {
    it('reports availability per text provider id', () => {
        const listed = listProviders();
        expect(listed.map(p => p.id)).toEqual(
            expect.arrayContaining(['gemini-cli', 'gemini-sdk', 'groq', 'openrouter', 'agy']),
        );
        process.env.GROQ_API_KEY = 'k';
        const groq = listProviders().find(p => p.id === 'groq');
        const sdk = listProviders().find(p => p.id === 'gemini-sdk');
        expect(groq?.available).toBe(true);
        expect(sdk?.available).toBe(false);
        expect(sdk?.requirement).toContain('GEMINI_API_KEY');
    });
});

describe('GeminiCliProvider', () => {
    it('is constructible without any env (binary-checked at generate time)', () => {
        const p = new GeminiCliProvider();
        expect(p.id).toBe('gemini-cli');
        expect(typeof p.generate).toBe('function');
    });
});

// ─── Decision providers (v3.1) ──────────────────────────────────

describe('createDecisionProvider — registry by name', () => {
    it('resolves jev to the JevProvider class when TYPESAFE_API_KEY is set', () => {
        process.env.TYPESAFE_API_KEY = 'test-key';
        const p = createDecisionProvider('jev');
        expect(p).toBeInstanceOf(JevProvider);
    });

    it('honors the model override', () => {
        process.env.TYPESAFE_API_KEY = 'test-key';
        const p = createDecisionProvider('jev', 'jev-2026-09-15');
        expect(p?.model).toBe('jev-2026-09-15');
    });

    it('throws on an unknown decision provider name', () => {
        expect(() => createDecisionProvider('gemini')).toThrow(
            /Unknown decision provider "gemini"/,
        );
        expect(() => createDecisionProvider('gemini')).toThrow(/jev/);
    });

    it('throws when the requested decision provider is unavailable', () => {
        expect(() => createDecisionProvider('jev')).toThrow(/JEV_API_KEY/);
    });

    it('auto-detect returns null when no decision provider is configured', () => {
        expect(createDecisionProvider()).toBeNull();
    });

    it('auto-detect returns jev when JEV_API_KEY is set', () => {
        process.env.JEV_API_KEY = 'test-key';
        const p = createDecisionProvider();
        expect(p).toBeInstanceOf(JevProvider);
    });
});

describe('listDecisionProviders', () => {
    it('reports availability per decision provider id', () => {
        const listed = listDecisionProviders();
        expect(listed.map(p => p.id)).toEqual(expect.arrayContaining(['jev']));

        const jev = listDecisionProviders().find(p => p.id === 'jev');
        expect(jev?.available).toBe(false);
        expect(jev?.requirement).toContain('JEV_API_KEY');

        process.env.JEV_API_KEY = 'k';
        const jevReady = listDecisionProviders().find(p => p.id === 'jev');
        expect(jevReady?.available).toBe(true);
    });
});
