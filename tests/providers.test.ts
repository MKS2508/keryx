/**
 * Tests for the provider factory.
 *
 * Verifies the registry-by-name contract: every name in PROVIDER_MAP
 * resolves to its class, unknown names fail loudly with the available
 * list, and auto-detection follows the documented priority order. Env
 * vars are set/cleared per test so the suite is hermetic.
 *
 * @module tests/providers
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createProvider, listProviders } from '../src/providers/index';
import { GeminiCliProvider } from '../src/providers/gemini-cli';
import { GeminiSdkProvider } from '../src/providers/gemini-sdk';
import { GroqProvider } from '../src/providers/groq';
import { OpenRouterProvider } from '../src/providers/openrouter';

const KEYS = ['GEMINI_API_KEY', 'GROQ_API_KEY', 'OPENROUTER_API_KEY'] as const;
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
});

describe('createProvider — registry by name', () => {
    it('resolves each registered name to its class', () => {
        process.env.GEMINI_API_KEY = 'test-key';
        process.env.GROQ_API_KEY = 'test-key';
        process.env.OPENROUTER_API_KEY = 'test-key';

        expect(createProvider('gemini-sdk')).toBeInstanceOf(GeminiSdkProvider);
        expect(createProvider('groq')).toBeInstanceOf(GroqProvider);
        expect(createProvider('openrouter')).toBeInstanceOf(OpenRouterProvider);
    });

    it('honors the model override', () => {
        process.env.GROQ_API_KEY = 'test-key';
        const p = createProvider('groq', 'llama-3.1-8b-instant');
        expect(p.model).toBe('llama-3.1-8b-instant');
    });

    it('fails loudly on an unknown name, listing the available ones', () => {
        expect(() => createProvider('agy')).toThrow(/Unknown provider "agy"/);
        expect(() => createProvider('agy')).toThrow(/gemini-cli/);
        expect(() => createProvider('agy')).toThrow(/openrouter/);
    });

    it('refuses a registered provider whose requirement is missing', () => {
        expect(() => createProvider('groq')).toThrow(/GROQ_API_KEY/);
    });
});

describe('createProvider — auto-detection order', () => {
    it('prefers gemini-sdk when its key is set', () => {
        process.env.GEMINI_API_KEY = 'k';
        process.env.GROQ_API_KEY = 'k';
        expect(createProvider().id).toBe('gemini-sdk');
    });

    it('falls back to groq, then openrouter', () => {
        process.env.GROQ_API_KEY = 'k';
        expect(createProvider().id).toBe('groq');

        delete process.env.GROQ_API_KEY;
        process.env.OPENROUTER_API_KEY = 'k';
        expect(createProvider().id).toBe('openrouter');
    });
});

describe('listProviders', () => {
    it('reports availability per provider id', () => {
        const listed = listProviders();
        expect(listed.map(p => p.id)).toEqual(
            expect.arrayContaining(['gemini-cli', 'gemini-sdk', 'groq', 'openrouter']),
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
