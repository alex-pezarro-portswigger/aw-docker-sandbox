import { test } from 'node:test';
import assert from 'node:assert/strict';
import { firstRefusal } from '../lib/preflight.js';
import { fakeSbx } from './helpers.js';

const dir = async () => ({ isDirectory: () => true });
const noDir = async () => { throw new Error('ENOENT'); };
const ok = { settings: { shareCodexSessions: true }, stat: dir };

test('no refusal for Claude, or Codex with sharing on', async () => {
  for (const agent of ['claude', 'codex']) {
    assert.equal(await firstRefusal({ cwd: '/w', agent, ...ok, run: fakeSbx().run }), null);
  }
});

test('1. sbx missing', async () => {
  const r = await firstRefusal({ cwd: '/w', agent: 'claude', ...ok, run: fakeSbx({ missing: true }).run });
  assert.match(r, /brew install docker\/tap\/sbx/);
});

test('2. unhealthy daemon, with sbx\'s own reason', async () => {
  const r = await firstRefusal({ cwd: '/w', agent: 'claude', ...ok, run: fakeSbx({ daemonError: 'sandboxd needs to restart: stdin is not a terminal\n' }).run });
  assert.match(r, /sbx daemon restart/);
  assert.match(r, /needs to restart/);
});

test('3. an agent other than Claude or Codex', async () => {
  const r = await firstRefusal({ cwd: '/w', agent: 'gemini', ...ok, run: fakeSbx().run });
  assert.match(r, /Claude and Codex only/);
});

test('4. no folder to mount', async () => {
  for (const cwd of ['', '/missing']) {
    const r = await firstRefusal({ cwd, agent: 'claude', settings: {}, stat: noDir, run: fakeSbx().run });
    assert.match(r, /needs a folder to mount/);
  }
});

test('5. the agent\'s secret is missing', async () => {
  const claude = await firstRefusal({ cwd: '/w', agent: 'claude', ...ok, run: fakeSbx({ secrets: ['openai'] }).run });
  assert.match(claude, /sbx secret set anthropic/);
  const codex = await firstRefusal({ cwd: '/w', agent: 'codex', ...ok, run: fakeSbx({ secrets: ['anthropic'] }).run });
  assert.match(codex, /sbx secret set openai/);
});

test('6. Codex while shareCodexSessions is off says why', async () => {
  for (const settings of [{}, { shareCodexSessions: false }]) {
    const r = await firstRefusal({ cwd: '/w', agent: 'codex', settings, stat: dir, run: fakeSbx().run });
    assert.match(r, /Share Codex sessions/);
    assert.match(r, /~\/\.codex\/sessions/);
  }
  // Claude doesn't need it.
  assert.equal(await firstRefusal({ cwd: '/w', agent: 'claude', settings: {}, stat: dir, run: fakeSbx().run }), null);
});

test('first match wins: a missing sbx beats every later refusal', async () => {
  const r = await firstRefusal({ cwd: '', agent: 'gemini', settings: {}, stat: noDir, run: fakeSbx({ missing: true }).run });
  assert.match(r, /brew install/);
});
