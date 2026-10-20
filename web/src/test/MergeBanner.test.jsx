import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import MergeBanner from '../components/MergeBanner.jsx';

const merge = { message: "Merge branch 'feat'" };

describe('MergeBanner', () => {
  it('names the merge and counts what is left to resolve', () => {
    render(<MergeBanner merge={merge} conflicts={2} onContinue={() => {}} onAbort={() => {}} />);
    expect(screen.getByText(/Merge branch 'feat'/)).toBeTruthy();
    expect(screen.getByText(/2 conflicted files/)).toBeTruthy();
  });

  it('holds back the commit while conflicts remain', () => {
    const onContinue = vi.fn();
    render(<MergeBanner merge={merge} conflicts={1} onContinue={onContinue} onAbort={() => {}} />);
    expect(screen.getByText(/1 conflicted file\b/)).toBeTruthy();
    const commit = screen.getByRole('button', { name: 'Commit merge' });
    expect(commit.disabled).toBe(true);
    fireEvent.click(commit);
    expect(onContinue).not.toHaveBeenCalled();
  });

  it('offers the commit once everything is resolved', () => {
    const onContinue = vi.fn();
    render(<MergeBanner merge={merge} conflicts={0} onContinue={onContinue} onAbort={() => {}} />);
    expect(screen.getByText(/All conflicts resolved/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Commit merge' }));
    expect(onContinue).toHaveBeenCalled();
  });

  it('aborts on request', () => {
    const onAbort = vi.fn();
    render(<MergeBanner merge={merge} conflicts={2} onContinue={() => {}} onAbort={onAbort} />);
    fireEvent.click(screen.getByRole('button', { name: 'Abort merge' }));
    expect(onAbort).toHaveBeenCalled();
  });
});
