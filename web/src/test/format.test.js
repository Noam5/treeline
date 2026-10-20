import { describe, it, expect } from 'vitest';
import { relativeDate, initials, parseRefs } from '../format.js';

describe('relativeDate', () => {
  const now = new Date(2026, 9, 19, 14, 0); // 2026-10-19 14:00 local
  const cases = [
    ['2026-10-19 13:59', 'just now'],
    ['2026-10-19 14:00', 'just now'],
    ['2026-10-19 13:15', '45 min ago'],
    ['2026-10-19 12:00', '2 h ago'],
    ['2026-10-18 09:00', 'yesterday'],
    ['2026-10-15 14:00', '4 days ago'],
    ['2026-09-28 14:00', '3 wk ago'],
    ['2026-06-01 10:00', '4 mo ago'],
    ['2024-10-01 10:00', '2 yr ago'],
  ];
  it.each(cases)('%s reads as %s', (date, text) => {
    expect(relativeDate(date, now).text).toBe(text);
  });

  it('keeps the absolute date for the tooltip', () => {
    expect(relativeDate('2026-10-19 12:00', now).title).toBe('2026-10-19 12:00');
  });

  it('treats a clock that ran ahead as just now', () => {
    expect(relativeDate('2026-10-19 15:30', now).text).toBe('just now');
  });

  it('passes through a date it cannot read', () => {
    expect(relativeDate('someday', now)).toEqual({ text: 'someday', title: 'someday' });
    expect(relativeDate('', now)).toEqual({ text: '', title: '' });
  });
});

describe('initials', () => {
  it('takes the first letters of the first and last names', () => {
    expect(initials('Ada Lovelace')).toBe('AL');
    expect(initials('Grace Brewster Murray Hopper')).toBe('GH');
  });
  it('uses one letter for a single name', () => {
    expect(initials('Ada')).toBe('A');
  });
  it('copes with an empty name', () => {
    expect(initials('')).toBe('?');
  });
});

describe('parseRefs', () => {
  const local = ['main', 'feature/tags'];
  it('tells local branches, remote branches and tags apart', () => {
    expect(parseRefs(['main', 'origin/main', 'feature/tags', 'tag: v1.0'], local)).toEqual([
      { kind: 'local', name: 'main' },
      { kind: 'remote', name: 'origin/main' },
      { kind: 'local', name: 'feature/tags' },
      { kind: 'tag', name: 'v1.0' },
    ]);
  });

  it('marks the checked-out branch as HEAD, once', () => {
    expect(parseRefs(['HEAD -> main', 'main', 'origin/main'], local)).toEqual([
      { kind: 'head', name: 'main' },
      { kind: 'remote', name: 'origin/main' },
    ]);
  });

  it('shows a detached HEAD on its own', () => {
    expect(parseRefs(['HEAD', 'tag: v2'], local)).toEqual([
      { kind: 'detached', name: 'HEAD' },
      { kind: 'tag', name: 'v2' },
    ]);
  });

  it('calls a branch local when there is no branch list to check against', () => {
    expect(parseRefs(['feature-x'], [])).toEqual([{ kind: 'local', name: 'feature-x' }]);
  });
});
