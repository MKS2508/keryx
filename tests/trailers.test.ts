/**
 * Tests for the release-note trailer module.
 *
 * Covers:
 * - parseTrailers: line scanning, key filtering, order preservation
 * - formatTrailersBlock: round-trip rendering
 * - missingReleaseNoteWarnings: feat/fix lint (advisory, not blocking)
 * - Parser integration: <trailers> sections in AI proposals
 *
 * @module tests/trailers
 */
import { describe, expect, it } from 'vitest';
import {
    TRAILER_KEYS,
    parseTrailers,
    formatTrailersBlock,
    missingReleaseNoteWarnings,
} from '../src/trailers';
import { GeminiResponseParser } from '../src/prompt-templates';

describe('parseTrailers', () => {
    it('extracts the four known keys from a commit body', () => {
        const body = [
            'feat(daemon): probe sources',
            '',
            'Adds open/close lifecycle.',
            '',
            'Release-Note: el daemon ahora expone fuentes de sonda',
            'Breaking: firma de ProbeSource.open cambia',
            'Upgrade-Step: regenerar contracts.generated.zig',
            'Security: none',
        ].join('\n');
        const trailers = parseTrailers(body);
        expect(trailers).toEqual([
            { key: 'Release-Note', value: 'el daemon ahora expone fuentes de sonda' },
            { key: 'Breaking', value: 'firma de ProbeSource.open cambia' },
            { key: 'Upgrade-Step', value: 'regenerar contracts.generated.zig' },
            { key: 'Security', value: 'none' },
        ]);
    });

    it('ignores unknown keys and non-trailer lines', () => {
        const body = [
            'Co-Authored-By: someone', // unknown key — not a release trailer
            'Reviewed-By: someone else',
            'plain prose line',
            'Release-Note: counts',
        ].join('\n');
        expect(parseTrailers(body)).toEqual([{ key: 'Release-Note', value: 'counts' }]);
    });

    it('requires a value after the colon', () => {
        expect(parseTrailers('Release-Note:')).toEqual([]);
        expect(parseTrailers('Release-Note:   ')).toEqual([]);
    });

    it('round-trips through formatTrailersBlock', () => {
        const body = 'Breaking: rompe X\nRelease-Note: añade Y';
        const parsed = parseTrailers(body);
        expect(parseTrailers(formatTrailersBlock(parsed))).toEqual(parsed);
    });

    it('exposes exactly the keys the changelog pipeline understands', () => {
        expect([...TRAILER_KEYS]).toEqual(['Release-Note', 'Breaking', 'Upgrade-Step', 'Security']);
    });
});

describe('missingReleaseNoteWarnings', () => {
    it('warns on feat/fix proposals without Release-Note', () => {
        const warnings = missingReleaseNoteWarnings([
            { title: 'feat(core): add thing', trailers: [] },
            { title: 'fix(ui): repair thing', trailers: [] },
        ]);
        expect(warnings).toHaveLength(2);
        expect(warnings[0]).toContain('feat(core): add thing');
        expect(warnings[1]).toContain('fix(ui): repair thing');
    });

    it('does not warn when Release-Note is present', () => {
        const warnings = missingReleaseNoteWarnings([
            { title: 'feat(core): add thing', trailers: [{ key: 'Release-Note', value: 'x' }] },
        ]);
        expect(warnings).toHaveLength(0);
    });

    it('does not warn for non user-facing types', () => {
        const warnings = missingReleaseNoteWarnings([
            { title: 'chore(deps): bump stuff', trailers: [] },
            { title: 'docs: readme', trailers: [] },
            { title: 'refactor(core): move code', trailers: [] },
        ]);
        expect(warnings).toHaveLength(0);
    });

    it('handles scoped and banged titles', () => {
        const warnings = missingReleaseNoteWarnings([
            { title: 'feat(api)!: breaking feature', trailers: [] },
            { title: 'feat!: unscoped breaking feature', trailers: [] },
        ]);
        expect(warnings).toHaveLength(2);
    });
});

describe('GeminiResponseParser — <trailers> section', () => {
    const response = (trailersBlock: string): string => `
### **ANÁLISIS PRINCIPAL**

Dos cambios.

---

### **Propuesta de Commit #1**

\`\`\`markdown
feat(daemon): expose probe sources

Añade ciclo open/close.

<technical>
- ProbeSource.open/close
</technical>
${trailersBlock}
\`\`\`

### **Archivos de la Propuesta #1** (OBLIGATORIO)

\`\`\`files
src/daemon.ts
\`\`\`
`;

    it('parses trailers from the <trailers> section', () => {
        const proposals = GeminiResponseParser.parseCommitProposals(response(`
<trailers>
Release-Note: el daemon expone fuentes de sonda
Breaking: firma de ProbeSource.open
</trailers>`));
        expect(proposals).toHaveLength(1);
        expect(proposals[0]!.trailers).toEqual([
            { key: 'Release-Note', value: 'el daemon expone fuentes de sonda' },
            { key: 'Breaking', value: 'firma de ProbeSource.open' },
        ]);
        // Files still attach alongside trailers
        expect(proposals[0]!.files).toEqual(['src/daemon.ts']);
    });

    it('yields empty trailers when the section is absent', () => {
        const proposals = GeminiResponseParser.parseCommitProposals(response(''));
        expect(proposals).toHaveLength(1);
        expect(proposals[0]!.trailers).toEqual([]);
    });

    it('ignores unknown keys inside the section', () => {
        const proposals = GeminiResponseParser.parseCommitProposals(response(`
<trailers>
Changelog-Note: not a thing
Security: endurece la verificación de tokens
</trailers>`));
        expect(proposals[0]!.trailers).toEqual([
            { key: 'Security', value: 'endurece la verificación de tokens' },
        ]);
    });
});
