import { describe, it, expect, vi, afterEach } from 'vitest';
import { bindRepo } from '../api.js';

afterEach(() => vi.unstubAllGlobals());

describe('bindRepo().getDiff', () => {
  it('sends a rename\'s original path alongside its new one', async () => {
    const fetch = vi.fn().mockResolvedValue({ json: async () => ({ patch: '' }) });
    vi.stubGlobal('fetch', fetch);
    await bindRepo('/r').getDiff({ path: 'x -> y.txt', origPath: 'café.txt', staged: true });
    const q = new URL(fetch.mock.calls[0][0], 'http://h').searchParams;
    expect(q.get('path')).toBe('x -> y.txt');
    expect(q.get('origPath')).toBe('café.txt');
    expect(q.get('staged')).toBe('true');
  });
});

describe('bindRepo() commit calls', () => {
  const stub = () => {
    const fetch = vi.fn().mockResolvedValue({ json: async () => ({ ok: true }) });
    vi.stubGlobal('fetch', fetch);
    return fetch;
  };

  it('asks for an amend only when told to', async () => {
    const fetch = stub();
    await bindRepo('/r').commit('m');
    await bindRepo('/r').commit('m', { amend: true });
    expect(JSON.parse(fetch.mock.calls[0][1].body)).toEqual({ repo: '/r', message: 'm', amend: false });
    expect(JSON.parse(fetch.mock.calls[1][1].body)).toEqual({ repo: '/r', message: 'm', amend: true });
  });

  it('reads the last commit of its own repository', async () => {
    const fetch = stub();
    await bindRepo('/r').getLastCommit();
    const url = new URL(fetch.mock.calls[0][0], 'http://h');
    expect(url.pathname).toBe('/api/commit/last');
    expect(url.searchParams.get('repo')).toBe('/r');
  });
});
