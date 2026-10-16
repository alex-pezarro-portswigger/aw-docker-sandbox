import { test } from 'node:test';
import assert from 'node:assert/strict';
import { collapseMounts, createArgs, planLaunch, paneScript } from '../lib/launch.js';
import { splitShellWords } from '../lib/shell.js';
import { claudeInner, codexInner, CORE, CWD, PORT } from './helpers.js';

const probes = (over = {}) => ({
  realpath: async (p) => (p === '/link/mem' ? '/real/mem' : p),
  gitCommonDir: async () => null,
  ensureDir: async () => {},
  env: {},
  home: '/Users/me',
  ...over,
});

test('collapseMounts drops covered paths and keeps ro inside ro out', () => {
  const out = collapseMounts([
    { path: '/a', ro: false },
    { path: '/a/b', ro: true },
    { path: '/c', ro: true },
    { path: '/c/d', ro: false },
    { path: '/c/e', ro: true },
    { path: '/ab', ro: true },
    { path: '/a', ro: true },
  ]);
  assert.deepEqual(out, [{ path: '/a', ro: false }, { path: '/c', ro: true }, { path: '/ab', ro: true }, { path: '/c/d', ro: false }]);
});

test('createArgs puts the cwd first and marks read-only mounts', () => {
  const args = createArgs({ name: 'aw-x', agent: 'codex', cwd: CWD, mounts: [{ path: `${CWD}/sub`, ro: false }, { path: '/opt/aw/skills', ro: true }] });
  assert.deepEqual(args, ['create', '--name', 'aw-x', '--no-progress', 'codex', CWD, '/opt/aw/skills:ro']);
});

for (const [agent, inner, hostDir] of [
  ['claude', claudeInner({ addDirs: ['/link/mem'] }), '/Users/me/.claude/projects/-Users-me-Projects-my-app'],
  ['codex', codexInner({ addDirs: ['/link/mem'] }), '/Users/me/.codex/sessions'],
]) {
  test(`${agent}: planLaunch mounts transcripts, grants and read-only paths`, async () => {
    const made = [];
    const plan = await planLaunch({ inner, cwd: CWD, sessionId: 'c1', ...probes({ ensureDir: async (p) => made.push(p), gitCommonDir: async () => '/Users/me/Projects/main/.git' }) });
    assert.equal(plan.agent, agent);
    assert.equal(plan.port, PORT);
    assert.equal(plan.hostDir, hostDir);
    assert.deepEqual(made, [hostDir]);
    const rw = plan.mounts.filter((m) => !m.ro).map((m) => m.path);
    assert.deepEqual(rw, [hostDir, '/real/mem', '/Users/me/Projects/main/.git']);
    assert.ok(plan.mounts.some((m) => m.ro && m.path.startsWith(CORE)));
    // The symlinked grant is swapped for its real path, and loopback rewritten.
    assert.ok(!plan.inner.includes('/link/mem'));
    assert.ok(plan.inner.includes("'/real/mem'"));
    assert.ok(!plan.inner.includes('127.0.0.1'));
  });

  test(`${agent}: paneScript creates once, allows the port, links, then execs`, async () => {
    const plan = await planLaunch({ inner, cwd: CWD, sessionId: 'c1', ...probes() });
    const fresh = paneScript({ name: 'aw-c1', cwd: CWD, exists: false, ...plan });
    const steps = fresh.split(' && ');
    assert.match(steps[0], new RegExp(`^'sbx' 'create' '--name' 'aw-c1' '--no-progress' '${agent}' '${CWD}' `));
    assert.match(fresh, new RegExp(`sbx policy allow network --sandbox 'aw-c1' 'localhost:${PORT}'`));
    assert.match(fresh, /sbx exec 'aw-c1' sh -lc '.*ln -sfn/);
    const last = steps[steps.length - 1];
    assert.ok(last.startsWith(`exec sbx exec -it -w '${CWD}' 'aw-c1' sh -lc `));
    // The inner command survives quoting intact.
    const words = splitShellWords(last);
    assert.equal(words.at(-1), plan.inner);

    const again = paneScript({ name: 'aw-c1', cwd: CWD, exists: true, ...plan });
    assert.ok(!again.includes("'create'"), 'an existing sandbox is not recreated');
  });
}

test('planLaunch refuses an agent it has no table row for', async () => {
  await assert.rejects(planLaunch({ inner: "gemini 'x'", cwd: CWD, sessionId: 'c', ...probes() }), /Claude and Codex only/);
});
