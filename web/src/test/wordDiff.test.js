import { describe, it, expect } from 'vitest';
import { wordDiff, markChangedWords } from '../wordDiff.js';

const marks = (segs) => segs.filter((s) => s.changed).map((s) => s.text);

describe('wordDiff', () => {
  it('marks only the words that changed', () => {
    const d = wordDiff('const x = 1;', 'const y = 1;');
    expect(d.old).toEqual([
      { text: 'const ', changed: false }, { text: 'x', changed: true }, { text: ' = 1;', changed: false },
    ]);
    expect(marks(d.new)).toEqual(['y']);
  });

  it('marks words added to a line, and nothing on the old side', () => {
    const d = wordDiff('two', 'two prime');
    expect(marks(d.old)).toEqual([]);
    expect(marks(d.new)).toEqual([' prime']);
  });

  it('keeps the line text whole', () => {
    const d = wordDiff('foo(a, b)', 'foo(a, c, b)');
    expect(d.old.map((s) => s.text).join('')).toBe('foo(a, b)');
    expect(d.new.map((s) => s.text).join('')).toBe('foo(a, c, b)');
  });

  it('gives up on lines that have little in common', () => {
    expect(wordDiff('old', 'new')).toBeNull();
    expect(wordDiff('return null;', 'export default function App() {')).toBeNull();
  });

  it('gives up on very long lines rather than stall', () => {
    const long = Array.from({ length: 2000 }, (_, i) => `w${i}`).join(' ');
    expect(wordDiff(long, `${long} x`)).toBeNull();
  });
});

describe('markChangedWords', () => {
  const marked = (lines) => markChangedWords(lines).words.map((segs) => segs && marks(segs));

  it('matches each removed line with the added line most like it', () => {
    expect(marked([
      '-  return { total, count };',
      '+  const average = total / count;',
      '+  return { total, count, average };',
    ])).toEqual([[], null, [', average ']]);
  });

  it('keeps matches in order, and leaves lines with no likeness unmarked', () => {
    expect(marked([' a', '-alpha one', '-beta two', '+alpha 1', '+zzz', '+beta 2', ' c']))
      .toEqual([null, ['one'], ['two'], ['1'], null, ['2'], null]);
  });

  it('says which added line each removed line was matched to', () => {
    const { pairs } = markChangedWords(['-return { a };', '+const b = 1;', '+return { a, b };']);
    expect(pairs).toEqual(new Map([[0, 2]]));
  });

  it('leaves a removal with no additions right after it unmarked', () => {
    expect(marked(['-same text', ' y', '+same text!'])).toEqual([null, null, null]);
  });
});
