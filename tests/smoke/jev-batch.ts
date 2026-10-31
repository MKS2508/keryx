/**
 * Batch smoke: jev classifies N real styx commits, prints a comparison
 * table. No agy involved (which is too slow for batch).
 *
 * For each commit we call `git -C STYX diff <parent>..<sha>` to get the
 * exact diff text that would be passed to the text provider, then
 * pass it through keryx's `truncateForDecisionProvider` helper
 * (the same one CommitGenerator uses) to mimic what jev would
 * actually see, then call jev.
 */
import { execSync } from 'child_process';
import { JevProvider } from '/tmp/keryx/src/providers/jev';
import {
    commitDecisionsQuestions,
    mapJevToCommitDecisions,
    truncateForDecisionProvider,
} from '/tmp/keryx/src/decisions';

const STYX = '/Volumes/KODAK1TB/REPOS y PROYECTOS/styx';

interface CommitSpec {
    sha: string;
    short: string;
    subject: string;
    realType: 'feat' | 'fix' | 'refactor' | 'docs' | 'chore' | 'test' | 'release' | 'ci' | 'build' | 'spike' | 'merge' | 'style' | 'perf' | 'gov' | 'tools' | 'wip' | 'model' | 'deploy' | 'revert' | 'unknown';
    isBreaking: boolean;
}

const SHAS: string[] = [
    'dfe148fa90700b98ff7705cf5605993625e70522', // fix(release) 48L
    '6b195adeef146a6d526f51158a28faba89d73aa3', // feat(playback-svc) 133L
    'a9e46b07b30c28c13fcc45af93568b135b7ffd36', // feat(daemon) 357L
    'cb5efc644f647828777c1c75fa3723774e909574', // feat(ingest)! 1416L BREAKING
    'dee1c4d336c1eebea257b3389dc9cfea9790b6c3', // refactor(services) 1880L
    '007a6f3cc30ac862a67362b9ca4d9cd7de49e22c', // fix(release) 105L
    '25b1a4577b6376d900828a17df4405cc68ebe2c0', // docs(ssot)
    'af20ce7812f423bea5b49c50a4c4b4159a118a2d', // chore(deps)
    'fccae90cae7780b621106fe08b3b2bd59e661d91', // model(identity)
    '11dd24e030c02d8aa707a3edb7348cb7e4235ff8', // gov(model)
    '036fc7c54b5f6b5adcea492a95b8f90204f0ab69', // spike(typebox-vs-arktype)
    'c13b3d4d36592ce1d5008446a2b3d88555737963', // build(quic-zig)
];

function git(...args: string[]): string {
    return execSync(`git -C "${STYX}" ${args.map((a) => `"${a.replace(/"/g, '\\"')}"`).join(' ')}`, {
        encoding: 'utf-8',
        maxBuffer: 50 * 1024 * 1024,
    });
}

function classifyCommit(subject: string): CommitSpec['realType'] {
    const m = subject.match(/^([a-z]+)/);
    if (!m) return 'unknown';
    const t = m[1];
    if ([
        'feat', 'fix', 'refactor', 'docs', 'chore', 'test', 'release',
        'ci', 'build', 'spike', 'merge', 'style', 'perf', 'gov',
        'tools', 'wip', 'model', 'deploy', 'revert',
    ].includes(t)) return t as CommitSpec['realType'];
    return 'unknown';
}

function normalizeForKeryx(t: CommitSpec['realType']): string {
    if (t === 'release') return 'fix';
    return t;
}

function getSubject(sha: string): string {
    return git('log', '-1', '--pretty=format:%s', sha).trim();
}

function getParent(sha: string): string {
    return git('rev-parse', `${sha}^`).trim();
}

function getDiff(parent: string, sha: string): string {
    return git('diff', `${parent}..${sha}`);
}

interface IFileShape {
    path: string;
    status: string;
    lines_added: number;
    lines_removed: number;
    is_binary: boolean;
    diff_preview: string;
}

interface IAnalysisShape {
    files: IFileShape[];
    stats: { total_files: number; total_additions: number; total_deletions: number; files_by_extension: Record<string, number>; directories_affected: string[] };
    project_context: { name: string; description: string; tech_stack: string[]; target_platform: string };
    commit_patterns: string;
}

function diffToAnalysis(diff: string, projectContext: IAnalysisShape['project_context']): IAnalysisShape {
    // Parse the diff into per-file entries. Cheap and good-enough for
    // a smoke test; production uses git2 etc.
    const fileMap = new Map<string, IFileShape>();
    let totalAdd = 0;
    let totalDel = 0;
    const dirSet = new Set<string>();
    const extMap: Record<string, number> = {};

    const fileHeaderRe = /^diff --git a\/(.+?) b\/(.+?)$/;
    const hunkRe = /^@@ .+?(?: @@)/;
    const addRe = /^\+(?!\+\+)/;
    const delRe = /^-(?!--)/;
    const binaryRe = /^Binary files? .+ differ$/;

    let cur: IFileShape | null = null;
    let curHunkPreview: string[] = [];
    const PREVIEW_PER_FILE = 2000;

    for (const line of diff.split('\n')) {
        const m = line.match(fileHeaderRe);
        if (m) {
            if (cur) {
                cur.diff_preview = curHunkPreview.join('\n').substring(0, PREVIEW_PER_FILE);
                fileMap.set(cur.path, cur);
            }
            const path = m[1];
            cur = {
                path,
                status: path.includes('dev/null') ? 'unknown' : 'modified',
                lines_added: 0,
                lines_removed: 0,
                is_binary: false,
                diff_preview: '',
            };
            curHunkPreview = [];
            const ext = path.split('.').pop() || 'no-ext';
            extMap[ext] = (extMap[ext] || 0) + 1;
            const dir = path.split('/')[0];
            if (dir) dirSet.add(dir);
            continue;
        }
        if (!cur) continue;
        if (binaryRe.test(line)) {
            cur.is_binary = true;
            continue;
        }
        if (hunkRe.test(line)) {
            if (curHunkPreview.length < 50) curHunkPreview.push(line);
            continue;
        }
        if (addRe.test(line)) {
            cur.lines_added++;
            totalAdd++;
            if (curHunkPreview.length < 50) curHunkPreview.push(line);
        } else if (delRe.test(line)) {
            cur.lines_removed++;
            totalDel++;
            if (curHunkPreview.length < 50) curHunkPreview.push(line);
        }
    }
    if (cur) {
        cur.diff_preview = curHunkPreview.join('\n').substring(0, PREVIEW_PER_FILE);
        fileMap.set(cur.path, cur);
    }

    return {
        files: Array.from(fileMap.values()),
        stats: {
            total_files: fileMap.size,
            total_additions: totalAdd,
            total_deletions: totalDel,
            files_by_extension: extMap,
            directories_affected: Array.from(dirSet),
        },
        project_context: projectContext,
        commit_patterns: 'No commit patterns found',
    };
}

async function main() {
    const jev = new JevProvider();
    if (!jev.isAvailable()) {
        console.error('JEV_API_KEY not set');
        process.exit(1);
    }

    const unique = [...new Set(SHAS)];

    const results: Array<{
        spec: CommitSpec;
        d: ReturnType<typeof mapJevToCommitDecisions>;
        ms: number;
        conf: Record<string, number>;
        diffLen: number;
        truncatedBytes: number;
        error?: string;
    }> = [];

    for (const sha of unique) {
        const subject = getSubject(sha);
        const spec: CommitSpec = {
            sha,
            short: sha.substring(0, 7),
            subject,
            realType: classifyCommit(subject),
            isBreaking: /!:/.test(subject) || /BREAKING/.test(subject),
        };

        const parent = getParent(sha);
        const diff = getDiff(parent, sha);

        const analysis = diffToAnalysis(diff, {
            name: 'styx',
            description: 'styx',
            tech_stack: ['typescript', 'zig'],
            target_platform: 'linux',
        });

        const truncated = truncateForDecisionProvider(analysis);
        const truncatedBytes = JSON.stringify(truncated).length;

        const t0 = Date.now();
        let d: ReturnType<typeof mapJevToCommitDecisions> | null = null;
        let conf: Record<string, number> = {};
        let error: string | undefined;
        try {
            const raw = await jev.decide<unknown>(truncated, commitDecisionsQuestions({
                name: 'styx',
                description: 'styx',
                version: '0',
                techStack: ['typescript', 'zig'],
                targetPlatform: 'linux',
            } as any));
            d = mapJevToCommitDecisions(raw);
            const answers = (raw as { answers?: Record<string, { confidence?: number }> }).answers ?? {};
            for (const [k, v] of Object.entries(answers)) {
                if (typeof v?.confidence === 'number') conf[k] = v.confidence;
            }
        } catch (e) {
            error = String((e as Error).message ?? e).split('\n')[0].slice(0, 60);
        }
        const ms = Date.now() - t0;

        results.push({ spec, d: d ?? { commit_type: 'chore', scope: 'general', breaking: 0, changelog_worthy: 0, single_vs_multi: 1, complexity: 0 }, ms, conf, diffLen: diff.length, truncatedBytes, error });
    }

    // Print a comparison table
    console.log();
    console.log('| sha | real | jev | conf | brk | brk_ok | c_log | s/m | cplx | ms | dBytes | tBytes | note |');
    console.log('|-----|------|-----|------|-----|--------|------|-----|------|-----|--------|--------|------|');
    for (const r of results) {
        const keryxType = normalizeForKeryx(r.spec.realType);
        const typeOk = r.d.commit_type === keryxType ? '✓' : '✗';
        const brk = r.d.breaking > 0.5 ? 1 : 0;
        const brkExpected = r.spec.isBreaking ? 1 : 0;
        const brkOk = brk === brkExpected ? '✓' : '✗';
        const typeCol = r.spec.realType === 'release'
            ? `${r.spec.realType}→${keryxType}`
            : r.spec.realType;
        const note = r.error ?? '';
        console.log(
            `| ${r.spec.short} | ${typeCol}${r.spec.isBreaking ? '!' : ''} | ${r.d.commit_type}${typeOk} | ${(r.conf.commit_type ?? 0).toFixed(2)} | ${r.d.breaking.toFixed(2)} | ${brkOk} | ${r.d.changelog_worthy.toFixed(2)} | ${r.d.single_vs_multi.toFixed(2)} | ${r.d.complexity.toFixed(1)} | ${r.ms} | ${r.diffLen} | ${r.truncatedBytes} | ${note} |`,
        );
    }

    // Summary stats
    const totalMs = results.reduce((s, r) => s + r.ms, 0);
    const avgMs = Math.round(totalMs / results.length);
    const okResults = results.filter((r) => !r.error);
    const typeCorrect = okResults.filter((r) => normalizeForKeryx(r.spec.realType) === r.d.commit_type).length;
    const brkCorrect = okResults.filter((r) => (r.d.breaking > 0.5 ? 1 : 0) === (r.spec.isBreaking ? 1 : 0)).length;
    console.log();
    console.log(`summary: ${okResults.length}/${results.length} succeeded, ${totalMs}ms total, ${avgMs}ms avg per call`);
    console.log(`         type (release→fix normalized): ${typeCorrect}/${okResults.length} correct (${Math.round((typeCorrect / okResults.length) * 100)}%)`);
    console.log(`         breaking: ${brkCorrect}/${okResults.length} correct (${Math.round((brkCorrect / okResults.length) * 100)}%)`);
}

main().catch((e) => {
    console.error('FATAL:', e);
    process.exit(1);
});
