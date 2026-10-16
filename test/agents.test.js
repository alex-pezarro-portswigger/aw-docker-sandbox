import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { AGENTS, SUPPORTED, agentSpec, bucket, hostCodexSessionsDir, codexTrustScript } from '../lib/agents.js';
import { splitShellWords } from '../lib/shell.js';
import { claudeInner, codexInner, CORE, CWD } from './helpers.js';

test('the table covers Claude and Codex only', () => {
  assert.deepEqual(SUPPORTED, ['claude', 'codex']);
  assert.equal(agentSpec('gemini'), null);
  assert.equal(agentSpec('__proto__'), null);
  assert.equal(AGENTS.claude.secret, 'anthropic');
  assert.equal(AGENTS.codex.secret, 'openai');
});

test('bucket matches Claude Code\'s project naming', () => {
  assert.equal(bucket('/Users/me/Projects/my_app.v2'), '-Users-me-Projects-my-app-v2');
});

test('claude: transcripts go to the host project bucket for the cwd', () => {
  assert.equal(AGENTS.claude.transcriptDir({ cwd: CWD, home: '/Users/me' }), '/Users/me/.claude/projects/-Users-me-Projects-my-app');
  const link = AGENTS.claude.vmPrep({ cwd: CWD, hostDir: '/Users/me/.claude/projects/-Users-me-Projects-my-app' });
  assert.match(link, /ln -sfn '\/Users\/me\/\.claude\/projects\/-Users-me-Projects-my-app' "\$HOME\/\.claude\/projects\/-Users-me-Projects-my-app"$/);
  assert.match(link, /mv "\$HOME\/\.claude\/projects\/-Users-me-Projects-my-app" "\$HOME\/.claude\/projects\/-Users-me-Projects-my-app\.vm-\$\(date \+%s\)"/);
});

test('claude: plugin dirs and the PR hook pair are read-only mounts', () => {
  const ro = AGENTS.claude.readOnlyMounts(splitShellWords(claudeInner()));
  assert.deepEqual(ro, [`${CORE}/agent-skills`, '/ext/foo/skills/foo', `${CORE}/scripts`, `${CORE}/server/pr-hook.js`]);
});

test('codex: transcripts go to the host sessions dir, honouring CODEX_HOME', () => {
  assert.equal(AGENTS.codex.transcriptDir({ env: {}, home: '/Users/me' }), '/Users/me/.codex/sessions');
  assert.equal(hostCodexSessionsDir({ CODEX_HOME: '/x/codex' }, '/Users/me'), '/x/codex/sessions');
  const link = AGENTS.codex.vmPrep({ hostDir: '/Users/me/.codex/sessions' });
  assert.match(link, /ln -sfn '\/Users\/me\/\.codex\/sessions' "\$\{CODEX_HOME:-\$HOME\/\.codex\}\/sessions"$/);
});

test('codex: each catalog skill dir is a read-only mount', () => {
  const ro = AGENTS.codex.readOnlyMounts(splitShellWords(codexInner()));
  assert.deepEqual(ro, [`${CORE}/agent-skills/skills/links`, '/ext/foo/skills/foo']);
});

test('codex: the VM prep trusts each folder once, and skips one TOML can\'t hold', async () => {
  const { execFileSync } = await import('node:child_process');
  const fs = await import('node:fs');
  const os = await import('node:os');
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-sbx-'));
  const script = codexTrustScript(['/w/app', '/w/app', '/w/main', '/bad"path']);
  const run = () => execFileSync('sh', ['-c', script], { env: { HOME: home, PATH: process.env.PATH } });
  run();
  run();
  const toml = fs.readFileSync(path.join(home, '.codex', 'config.toml'), 'utf8');
  assert.equal(toml, '\n[projects."/w/app"]\ntrust_level = "trusted"\n\n[projects."/w/main"]\ntrust_level = "trusted"\n');
  fs.rmSync(home, { recursive: true, force: true });
  assert.equal(codexTrustScript([]), '');
  assert.match(AGENTS.codex.vmPrep({ hostDir: '/h', trustDirs: ['/w/app'] }), /ln -sfn '\/h' .* && C=.*trust_level/);
});
