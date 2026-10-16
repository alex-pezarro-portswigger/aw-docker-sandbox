import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import manifest, { dir } from '../index.js';

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));

test('identity, requires and engines agree with package.json', () => {
  assert.equal(manifest.id, 'docker-sandbox');
  assert.equal(pkg.wranglerExtension.id, manifest.id);
  assert.equal(pkg.wranglerExtension.label, manifest.label);
  assert.deepEqual(pkg.wranglerExtension.requires, manifest.requires);
  assert.deepEqual(manifest.requires, []);
  assert.deepEqual(pkg.wranglerExtension.engines, manifest.engines);
  assert.equal(manifest.engines.wranglerApi, '^1.34.0', 'liveByTmux shipped in host API 1.34.0');
  assert.equal(manifest.dir, dir);
  assert.equal(pkg.type, 'module');
  assert.equal(pkg.scripts.test, 'node --test');
  assert.equal(pkg.license, 'MIT');
  assert.ok(fs.existsSync(path.join(root, 'LICENSE')));
});

test('no dependencies, so no lockfile is needed', () => {
  for (const k of ['dependencies', 'optionalDependencies', 'peerDependencies', 'bundleDependencies']) {
    assert.equal(pkg[k], undefined, k);
  }
});

test('settings: two toggles', () => {
  assert.deepEqual(manifest.settings.map((s) => [s.key, s.type]), [['shareCodexSessions', 'toggle'], ['keepRunningOnArchive', 'toggle']]);
  for (const s of manifest.settings) assert.ok(s.label && s.help);
});

test('one wrapLaunch runtime, and archive/purge session hooks', () => {
  assert.equal(manifest.runtimes.length, 1);
  const [rt] = manifest.runtimes;
  assert.equal(rt.id, 'sbx');
  assert.equal(typeof rt.wrapLaunch, 'function');
  assert.equal(typeof rt.preflight, 'function');
  assert.equal(rt.liveByTmux, true);
  assert.deepEqual(Object.keys(manifest.session).sort(), ['onArchive', 'onPurge']);
});

// Same rule core enforces: an extension imports only node built-ins and its
// own files, never the wrangler's server modules.
test('server-side code imports only node: built-ins and its own files', () => {
  const files = ['index.js', ...fs.readdirSync(path.join(root, 'lib')).map((f) => `lib/${f}`)];
  for (const f of files) {
    const src = fs.readFileSync(path.join(root, f), 'utf8');
    for (const [, spec] of src.matchAll(/^import[^'"]*['"]([^'"]+)['"]/gm)) {
      assert.ok(spec.startsWith('node:') || spec.startsWith('./') || spec.startsWith('../'), `${f} imports ${spec}`);
    }
  }
});
