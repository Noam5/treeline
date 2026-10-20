import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import request from 'supertest';
import { buildApp } from '../src/app.js';

// A stand-in for a real `vite build` output directory.
function fixtureDir() {
  const dir = mkdtempSync(join(tmpdir(), 'gwc-static-'));
  writeFileSync(join(dir, 'index.html'), '<!doctype html><div id="root"></div>');
  mkdirSync(join(dir, 'assets'));
  writeFileSync(join(dir, 'assets', 'x.js'), 'export const x = 1;');
  return dir;
}

test('serves index.html at /', async () => {
  const res = await request(buildApp({ staticDir: fixtureDir() })).get('/');
  assert.equal(res.status, 200);
  assert.match(res.text, /id="root"/);
});

test('serves static assets', async () => {
  const res = await request(buildApp({ staticDir: fixtureDir() })).get('/assets/x.js');
  assert.equal(res.status, 200);
  assert.match(res.text, /export const x/);
});

test('falls back to index.html for unknown non-API routes', async () => {
  const res = await request(buildApp({ staticDir: fixtureDir() })).get('/some/spa/route');
  assert.equal(res.status, 200);
  assert.match(res.text, /id="root"/);
});

// The load-bearing test: the SPA fallback must never swallow an API typo.
test('unknown /api path returns JSON 404, not index.html', async () => {
  const res = await request(buildApp({ staticDir: fixtureDir() })).get('/api/nope');
  assert.equal(res.status, 404);
  assert.deepEqual(res.body, { ok: false, error: 'Not found' });
});

test('unknown /api path returns JSON 404 with no staticDir either', async () => {
  const res = await request(buildApp()).get('/api/nope');
  assert.equal(res.status, 404);
  assert.deepEqual(res.body, { ok: false, error: 'Not found' });
});

test('with no staticDir, / is still 404', async () => {
  const res = await request(buildApp()).get('/');
  assert.equal(res.status, 404);
});

test('a real API route still works alongside static serving', async () => {
  const res = await request(buildApp({ staticDir: fixtureDir() })).get('/api/health');
  assert.equal(res.status, 200);
  assert.deepEqual(res.body, { ok: true });
});
