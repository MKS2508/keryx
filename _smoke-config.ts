/**
 * Smoke test for project-config.ts hierarchical loader.
 * Run with: bun run _smoke-config.ts
 */

import { mkdirSync, writeFileSync, rmSync, mkdirSync as mkdir2 } from 'fs';
import { join } from 'path';
import {
    findGitRoot,
    readWizardConfigAt,
    collectWizardConfigs,
    mergeWizardConfigs,
    loadProjectConfigHierarchical,
} from './src/project-config';

const ROOT = '/tmp/smoke-cfg';
rmSync(ROOT, { recursive: true, force: true });

// Build a fake monorepo:
// /tmp/smoke-cfg/.git                         (file marker so findGitRoot works)
// /tmp/smoke-cfg/.commit-wizard.json          (root config)
// /tmp/smoke-cfg/apps/sources-svc/.git/...    (no, leave .git only at root)
// /tmp/smoke-cfg/apps/sources-svc/.commit-wizard.json  (cwd config)
mkdirSync(ROOT, { recursive: true });
writeFileSync(join(ROOT, '.git'), 'fake-git-marker'); // file is enough for findGitRoot
writeFileSync(join(ROOT, '.commit-wizard.json'), JSON.stringify({
    projectContext: 'ROOT project context',
    scopes: ['root-scope-1', 'root-scope-2'],
    contextFiles: ['docs/root.md'],
    excludePatterns: ['dist-double-star'],
    provider: 'gemini',
    model: 'root-model',
}));

const pkg = join(ROOT, 'apps', 'sources-svc');
mkdirSync(pkg, { recursive: true });
writeFileSync(join(pkg, '.commit-wizard.json'), JSON.stringify({
    scope: 'sources-svc',
    contextFiles: ['svc-spec.md'],
    excludePatterns: ['star-dot-test-dot-ts'],
    scopes: ['sources-svc-overrides-root'],
    commitFormat: { titleLanguage: 'english' },
}));
writeFileSync(join(pkg, 'package.json'), JSON.stringify({ name: '@styx/sources-svc', version: '0.1.0' }));

// Test 1: findGitRoot walks from pkg dir up
const gitRoot = findGitRoot(pkg);
console.log('findGitRoot:', gitRoot, gitRoot === ROOT ? '✓' : '✗');

// Test 2: readWizardConfigAt
const rootCfg = readWizardConfigAt(ROOT);
console.log('readWizardConfigAt(root):', !!rootCfg, rootCfg?.projectContext === 'ROOT project context' ? '✓' : '✗');
const pkgCfg = readWizardConfigAt(pkg);
console.log('readWizardConfigAt(pkg):', !!pkgCfg, pkgCfg?.scope === 'sources-svc' ? '✓' : '✗');

// Test 3: collectWizardConfigs walks up
const collected = collectWizardConfigs(pkg);
console.log('collectWizardConfigs count:', collected.length, collected.length === 2 ? '✓' : '✗');
console.log('  cwd first?', collected[0].scope === 'sources-svc', collected[0].scope === 'sources-svc' ? '✓' : '✗');
console.log('  root second?', !collected[1].scope, !collected[1].scope ? '✓' : '✗');

// Test 4: mergeWizardConfigs (cwd-wins on scalars, union on arrays)
const merged = mergeWizardConfigs(collected);
console.log('merged.scope:', merged.scope, merged.scope === 'sources-svc' ? '✓ (cwd wins)' : '✗');
console.log('merged.projectContext:', merged.projectContext === 'ROOT project context' ? '✓ (root contributes)' : '✗');
console.log('merged.scopes (cwd first):', JSON.stringify(merged.scopes), merged.scopes?.[0] === 'sources-svc-overrides-root' ? '✓' : '✗');
console.log('merged.contextFiles (union, no dup):', JSON.stringify(merged.contextFiles), merged.contextFiles?.length === 2 ? '✓' : '✗');
console.log('merged.excludePatterns (union):', JSON.stringify(merged.excludePatterns), merged.excludePatterns?.length === 2 ? '✓' : '✗');
console.log('merged.provider:', merged.provider, merged.provider === 'gemini' ? '✓ (root only)' : '✗');
console.log('merged.commitFormat:', JSON.stringify(merged.commitFormat), merged.commitFormat?.titleLanguage === 'english' ? '✓' : '✗');

// Test 5: loadProjectConfigHierarchical end-to-end
const full = loadProjectConfigHierarchical(pkg);
console.log('full.name:', full.name, full.name === '@styx/sources-svc' ? '✓ (from package.json)' : '✗');
console.log('full.commitWizard exists:', !!full.commitWizard, full.commitWizard ? '✓' : '✗');
console.log('full.commitWizard.scope:', full.commitWizard?.scope === 'sources-svc' ? '✓' : '✗');
console.log('full.commitWizard.scopes length:', full.commitWizard?.scopes?.length === 3 ? '✓ (overrides + inherited)' : `✗ got ${full.commitWizard?.scopes?.length}`);

// Test 6: invalid config is silently skipped
mkdirSync(join(ROOT, 'apps', 'broken-svc'), { recursive: true });
writeFileSync(join(ROOT, 'apps', 'broken-svc', '.commit-wizard.json'), '{ "projectContext": 123 }');
const broken = collectWizardConfigs(join(ROOT, 'apps', 'broken-svc'));
console.log('invalid config skipped:', broken.length, broken.length === 0 ? '✓' : '✗');

// Cleanup
rmSync(ROOT, { recursive: true, force: true });
console.log('\n=== smoke complete ===');
