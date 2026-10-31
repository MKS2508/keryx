/**
 * Release-note trailers for commit messages.
 *
 * keryx proposes these trailers so a deterministic changelog pipeline
 * (styx's `scripts/release/version.ts`) can turn commit bodies into
 * changelog prose without any AI in the release path. The key set and
 * the line format (`Key: value`, one per line) mirror that consumer —
 * do not diverge from it.
 *
 * @module trailers
 */

/** Trailer keys that the changelog pipeline understands. */
export const TRAILER_KEYS = ['Release-Note', 'Breaking', 'Upgrade-Step', 'Security'] as const;

export type TrailerKey = (typeof TRAILER_KEYS)[number];

/** A single `Key: value` trailer. */
export interface ITrailer {
    key: TrailerKey;
    value: string;
}

const TRAILER_LINE = new RegExp(`^(${TRAILER_KEYS.join('|')}):\\s*(.+)$`);

/**
 * Extract trailers from free text, one per matching line.
 *
 * Same semantics as the changelog pipeline's parser: every line of the
 * body is a candidate; any line shaped `Known-Key: text` counts.
 *
 * @param text - Commit body (or any section) to scan
 * @returns Trailers in order of appearance
 */
export function parseTrailers(text: string): ITrailer[] {
    const out: ITrailer[] = [];
    for (const line of text.split('\n')) {
        const m = TRAILER_LINE.exec(line.trim());
        if (m) out.push({ key: m[1] as TrailerKey, value: m[2]!.trim() });
    }
    return out;
}

/**
 * Render trailers as git-trailer lines (`Key: value`), one per line.
 *
 * @param trailers - Trailers to render
 * @returns Block to append at the end of a commit message
 */
export function formatTrailersBlock(trailers: ITrailer[]): string {
    return trailers.map(t => `${t.key}: ${t.value}`).join('\n');
}

/**
 * Human-readable warnings for user-facing proposals missing a
 * `Release-Note` trailer. Advisory only — never blocks the commit.
 *
 * @param proposals - Parsed proposals to lint
 * @returns Warning strings, one per offending proposal
 */
export function missingReleaseNoteWarnings(
    proposals: Array<{ title: string; trailers?: ITrailer[] }>,
): string[] {
    const warnings: string[] = [];
    for (const p of proposals) {
        const isUserFacing = /^(feat|fix)(\([^)]*\))?!?:\s/.test(p.title);
        const hasReleaseNote = p.trailers?.some(t => t.key === 'Release-Note') ?? false;
        if (isUserFacing && !hasReleaseNote) {
            warnings.push(
                `"${p.title.split('\n')[0]}" — feat/fix sin trailer Release-Note ` +
                '(el changelog de release se quedaría sin prosa para este commit)',
            );
        }
    }
    return warnings;
}
