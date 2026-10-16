import { test } from 'node:test';
import assert from 'node:assert/strict';
import { shellQuote, splitShellWords } from '../lib/shell.js';

test('shellQuote round-trips through splitShellWords', () => {
  for (const s of ['plain', "it's", '', 'a b', '{"k":"v w"}', "''", '$HOME `x`']) {
    assert.deepEqual(splitShellWords(`cmd ${shellQuote(s)}`), ['cmd', s]);
  }
});

test('splitShellWords handles double quotes, escapes and adjacent spans', () => {
  assert.deepEqual(splitShellWords('a "b \\"c\\"" d\\ e \'f\'"g"'), ['a', 'b "c"', 'd e', 'fg']);
  assert.deepEqual(splitShellWords('  x   y  '), ['x', 'y']);
  assert.throws(() => splitShellWords("a 'b"), /Unterminated/);
});
