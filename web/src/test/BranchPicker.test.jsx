import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import BranchPicker from '../components/BranchPicker.jsx';

describe('BranchPicker', () => {
  it('lists the given branches and calls onPick when one is clicked', () => {
    const onPick = vi.fn();
    render(
      <BranchPicker title="Merge into main" branches={['develop', 'feature/x']}
        onPick={onPick} onCancel={() => {}} />
    );
    expect(screen.getByText(/Merge into main/)).toBeTruthy();
    fireEvent.click(screen.getByText('⑂ develop'));
    expect(onPick).toHaveBeenCalledWith('develop');
  });

  it('shows an empty message when there are no branches', () => {
    render(<BranchPicker title="Merge" branches={[]} onPick={() => {}} onCancel={() => {}} />);
    expect(screen.getByText(/No other branches/)).toBeTruthy();
  });
});
