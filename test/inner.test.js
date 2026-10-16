import { test } from 'node:test';
import assert from 'node:assert/strict';
import { agentOfInner, wranglerPort, rewriteLoopback, addDirsOf, replaceArgs } from '../lib/inner.js';
import { splitShellWords } from '../lib/shell.js';
import { claudeInner, codexInner, PORT } from './helpers.js';

test('agentOfInner reads the binary past core\'s env prefix', () => {
  assert.equal(agentOfInner(claudeInner()), 'claude');
  assert.equal(agentOfInner(codexInner()), 'codex');
  assert.equal(agentOfInner("FOO='x' /usr/local/bin/claude --resume y"), 'claude');
  assert.equal(agentOfInner("env -u A gemini 'hi'"), null);
  assert.equal(agentOfInner("echo claude"), null);
});

test('wranglerPort comes from the MCP url', () => {
  assert.equal(wranglerPort(claudeInner()), PORT);
  assert.equal(wranglerPort(codexInner()), PORT);
  assert.equal(wranglerPort('claude'), null);
});

test('rewriteLoopback points every wrangler url at the host alias', () => {
  for (const inner of [claudeInner(), codexInner()]) {
    const out = rewriteLoopback(inner);
    assert.ok(!out.includes('127.0.0.1'), out);
    assert.ok(out.includes(`http://host.docker.internal:${PORT}/mcp`));
    // Still one well-formed command.
    assert.equal(splitShellWords(out).length, splitShellWords(inner).length);
  }
  assert.equal(rewriteLoopback("claude -- 'ping 127.0.0.1'"), "claude -- 'ping 127.0.0.1'");
});

test('addDirsOf and replaceArgs swap whole arguments only', () => {
  const inner = claudeInner({ addDirs: ['/link/mem', '/other'] });
  assert.deepEqual(addDirsOf(inner), ['/link/mem', '/other']);
  const out = replaceArgs(inner, [['/link/mem', '/real/mem']]);
  assert.deepEqual(addDirsOf(out), ['/real/mem', '/other']);
  assert.equal(replaceArgs("x '/a/b'", [['/a', '/z']]), "x '/a/b'");
});
