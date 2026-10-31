/**
 * Smoke: run jev on a real styx commit's diff (no agy).
 * Reads the diff from /tmp/dfe148f_diff.txt, calls JevProvider.decide,
 * prints the typed decisions. Hermetic to the classification step.
 */
import { readFileSync } from 'fs';
import { JevProvider } from '/tmp/keryx/src/providers/jev';
import { commitDecisionsQuestions, mapJevToCommitDecisions } from '/tmp/keryx/src/decisions';

async function main() {
    const diff = readFileSync('/tmp/dfe148f_diff.txt', 'utf-8');
    const jev = new JevProvider();
    if (!jev.isAvailable()) {
        console.error('JEV not available — set JEV_API_KEY');
        process.exit(1);
    }

    const t0 = Date.now();
    const raw = await jev.decide<unknown>(diff, commitDecisionsQuestions({
        name: 'styx',
        description: 'styx',
        version: '0',
        techStack: ['typescript'],
        targetPlatform: 'node',
    } as any));
    const dt = Date.now() - t0;

    const decisions = mapJevToCommitDecisions(raw);
    console.log('elapsed_ms:', dt);
    console.log('commit_type:    ', decisions.commit_type);
    console.log('scope:          ', decisions.scope);
    console.log('breaking:       ', decisions.breaking);
    console.log('changelog_worthy:', decisions.changelog_worthy);
    console.log('single_vs_multi: ', decisions.single_vs_multi);
    console.log('complexity:      ', decisions.complexity);

    // Also print the raw probabilities for transparency
    const answers = (raw as { answers?: Record<string, unknown> }).answers ?? {};
    for (const [k, v] of Object.entries(answers)) {
        const trimmed = { ...(v as Record<string, unknown>) };
        // Drop the full probabilities map to keep output short
        if (trimmed.probabilities) trimmed.probabilities = '<' + Object.keys(trimmed.probabilities as object).length + ' options>';
        console.log(`  raw[${k}]:`, JSON.stringify(trimmed));
    }
}

main().catch((e) => {
    console.error('FATAL:', e);
    process.exit(1);
});
