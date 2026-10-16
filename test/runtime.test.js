import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createSbxRuntime, createSessionHooks } from '../lib/runtime.js';
import { claudeInner, codexInner, fakeSbx, CWD } from './helpers.js';

const probes = { realpath: async (p) => p, gitCommonDir: async () => null, ensureDir: async () => {}, env: {}, home: '/Users/me' };

test('contract flags: resumable, host resume guard kept, live by tmux', () => {
  const rt = createSbxRuntime(probes);
  assert.equal(rt.id, 'sbx');
  assert.equal(rt.label, 'Docker Sandbox');
  assert.equal(rt.resumable, true);
  assert.equal(rt.skipsHostResumeGuard, false);
  assert.equal(rt.liveByTmux, true);
  assert.equal(rt.buildLaunch, undefined);
  for (const k of ['analyze', 'cost', 'readLive', 'deliver', 'launchStatus']) assert.equal(rt[k], undefined, k);
});

for (const [agent, inner] of [['claude', claudeInner({ sessionId: 'card-9' })], ['codex', codexInner({ sessionId: 'card-9' })]]) {
  test(`${agent}: wrapLaunch creates aw-<card> only when absent`, async () => {
    const fresh = await createSbxRuntime({ ...probes, run: fakeSbx().run }).wrapLaunch({ inner, cwd: CWD, sessionId: 'card-9' });
    assert.match(fresh, new RegExp(`^'sbx' 'create' '--name' 'aw-card-9' '--no-progress' '${agent}'`));
    assert.match(fresh, /exec sbx exec -it -w '\/Users\/me\/Projects\/my-app' 'aw-card-9' sh -lc /);

    const resumed = await createSbxRuntime({ ...probes, run: fakeSbx({ sandboxes: ['aw-card-9'] }).run }).wrapLaunch({ inner, cwd: CWD, sessionId: 'card-9' });
    assert.ok(!resumed.includes("'create'"));
  });

  test(`${agent}: preflight passes settings through`, async () => {
    const rt = createSbxRuntime({ ...probes, run: fakeSbx().run });
    const off = await rt.preflight({ cwd: '/', agent, settings: {} });
    const on = await rt.preflight({ cwd: '/', agent, settings: { shareCodexSessions: true } });
    assert.equal(on, null);
    assert.equal(off === null, agent === 'claude');
  });
}

test('onArchive stops only sbx cards, unless keepRunningOnArchive is on', async () => {
  const sbx = fakeSbx({ sandboxes: ['aw-a'] });
  const hooks = createSessionHooks({ run: sbx.run });
  const host = (s) => ({ settings: { all: () => s } });
  await hooks.onArchive({ sessionId: 'a', entry: { runtime: 'local' }, host: host({}) });
  await hooks.onArchive({ sessionId: 'a', entry: { runtime: 'sbx' }, host: host({ keepRunningOnArchive: true }) });
  assert.deepEqual(sbx.calls, []);
  await hooks.onArchive({ sessionId: 'a', entry: { runtime: 'sbx' }, host: host({}) });
  assert.deepEqual(sbx.calls, [['sbx', 'stop', 'aw-a']]);
});

test('onPurge removes the sandbox, and a missing one is not an error', async () => {
  const sbx = fakeSbx({ sandboxes: ['aw-a'] });
  const hooks = createSessionHooks({ run: sbx.run });
  await hooks.onPurge({ sessionId: 'a' });
  await hooks.onPurge({ sessionId: 'never-had-one' });
  assert.deepEqual(sbx.calls, [['sbx', 'rm', '--force', 'aw-a'], ['sbx', 'rm', '--force', 'aw-never-had-one']]);
});
