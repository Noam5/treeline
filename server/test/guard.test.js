import { test } from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import { buildApp } from '../src/app.js';

// The API listens on loopback, but the user's browser can reach loopback too.
// These pin down which requests a page on some other site can get answered.

test('rejects a Host that is not loopback (DNS rebinding)', async () => {
  const res = await request(buildApp()).get('/api/health').set('Host', 'evil.example:26542');
  assert.equal(res.status, 403);
  assert.equal(res.body.ok, false);
});

test('accepts loopback Host names', async () => {
  for (const host of ['127.0.0.1:26542', 'localhost:4000', '[::1]:26542', '127.0.0.1']) {
    const res = await request(buildApp()).get('/api/health').set('Host', host);
    assert.equal(res.status, 200, host);
  }
});

test('rejects a browser request sent from another site', async () => {
  for (const site of ['cross-site', 'same-site']) {
    const res = await request(buildApp()).get('/api/health').set('Sec-Fetch-Site', site);
    assert.equal(res.status, 403, site);
  }
});

test('accepts a browser request from the app itself', async () => {
  for (const site of ['same-origin', 'none']) {
    const res = await request(buildApp()).get('/api/health').set('Sec-Fetch-Site', site);
    assert.equal(res.status, 200, site);
  }
});

test('rejects an Origin that is not loopback', async () => {
  const res = await request(buildApp()).post('/api/repo/open')
    .set('Origin', 'https://evil.example').send({ path: '/' });
  assert.equal(res.status, 403);
});

test('accepts a loopback Origin, including the Vite dev server', async () => {
  const res = await request(buildApp()).get('/api/health').set('Origin', 'http://127.0.0.1:5173');
  assert.equal(res.status, 200);
});
