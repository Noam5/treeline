import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import Dialog from '../components/Dialog.jsx';
import { refNameError } from '../refname.js';

describe('Dialog asking for a name', () => {
  const ask = (props = {}) => {
    const onDone = vi.fn();
    render(<Dialog title="New branch" input confirmLabel="Create branch"
      validate={refNameError} onDone={onDone} {...props} />);
    return { onDone, input: screen.getByRole('textbox') };
  };

  it('is a modal dialog titled after what it asks', () => {
    ask();
    const dialog = screen.getByRole('dialog', { name: 'New branch' });
    expect(dialog.getAttribute('aria-modal')).toBe('true');
  });

  it('puts the cursor in the name field', () => {
    const { input } = ask();
    expect(document.activeElement).toBe(input);
  });

  it('starts from the given value, selected so typing replaces it', () => {
    const { input } = ask({ initial: 'feature/x' });
    expect(input.value).toBe('feature/x');
    expect(input.selectionStart).toBe(0);
    expect(input.selectionEnd).toBe('feature/x'.length);
  });

  it('confirms with Enter, handing back the trimmed name', () => {
    const { onDone, input } = ask();
    fireEvent.change(input, { target: { value: '  topic  ' } });
    // Enter in a form's only text field submits it.
    fireEvent.submit(input.form);
    expect(onDone).toHaveBeenCalledWith('topic');
  });

  it('confirms with its button too', () => {
    const { onDone, input } = ask();
    fireEvent.change(input, { target: { value: 'topic' } });
    fireEvent.click(screen.getByRole('button', { name: 'Create branch' }));
    expect(onDone).toHaveBeenCalledWith('topic');
  });

  it('cancels with Esc', () => {
    const { onDone, input } = ask();
    fireEvent.change(input, { target: { value: 'topic' } });
    fireEvent.keyDown(input, { key: 'Escape' });
    expect(onDone).toHaveBeenCalledWith(null);
  });

  it('cancels with its Cancel button and with a click outside', () => {
    const { onDone } = ask();
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(onDone).toHaveBeenLastCalledWith(null);
    fireEvent.click(document.querySelector('.modal-overlay'));
    expect(onDone).toHaveBeenCalledTimes(2);
  });

  it('refuses an empty name and says why', () => {
    const { onDone, input } = ask();
    fireEvent.submit(input.form);
    expect(onDone).not.toHaveBeenCalled();
    expect(screen.getByRole('alert').textContent).toMatch(/enter a name/i);
    expect(input.getAttribute('aria-invalid')).toBe('true');
  });

  it('does not nag about an empty field before anything is tried', () => {
    ask();
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('flags a bad name as it is typed, and blocks the confirm button', () => {
    const { onDone, input } = ask();
    fireEvent.change(input, { target: { value: 'my topic' } });
    expect(screen.getByRole('alert').textContent).toMatch(/space/i);
    const confirm = screen.getByRole('button', { name: 'Create branch' });
    expect(confirm.disabled).toBe(true);
    fireEvent.submit(input.form);
    expect(onDone).not.toHaveBeenCalled();
  });

  it('clears the message once the name is fixed', () => {
    const { onDone, input } = ask();
    fireEvent.change(input, { target: { value: '-x' } });
    expect(screen.getByRole('alert')).toBeTruthy();
    fireEvent.change(input, { target: { value: 'x' } });
    expect(screen.queryByRole('alert')).toBeNull();
    fireEvent.submit(input.form);
    expect(onDone).toHaveBeenCalledWith('x');
  });
});

describe('Dialog asking for confirmation', () => {
  const confirm = (props = {}) => {
    const onDone = vi.fn();
    render(<Dialog title="Delete tag" message='Delete tag "v1"? This cannot be undone.'
      confirmLabel="Delete tag" danger onDone={onDone} {...props} />);
    return { onDone };
  };

  it('shows the question and no text field', () => {
    confirm();
    expect(screen.getByText(/This cannot be undone/)).toBeTruthy();
    expect(screen.queryByRole('textbox')).toBeNull();
  });

  it('focuses Cancel, not the destructive action', () => {
    confirm();
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Cancel' }));
  });

  it('marks the destructive action as dangerous', () => {
    confirm();
    expect(screen.getByRole('button', { name: 'Delete tag' }).className).toContain('danger');
  });

  it('goes ahead only on the action button', () => {
    const { onDone } = confirm();
    fireEvent.click(screen.getByRole('button', { name: 'Delete tag' }));
    expect(onDone).toHaveBeenCalledWith(true);
  });

  it('backs out with Esc', () => {
    const { onDone } = confirm();
    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' });
    expect(onDone).toHaveBeenCalledWith(null);
  });
});

describe('refNameError', () => {
  it.each([
    ['', /enter a name/i],
    ['   ', /enter a name/i],
    ['my branch', /space/i],
    ['-x', /start with/i],
  ])('rejects %j', (name, why) => {
    expect(refNameError(name)).toMatch(why);
  });

  it.each(['main', 'feature/x', 'v1.0', 'fix-123', '  padded  '])('accepts %j', (name) => {
    expect(refNameError(name)).toBe('');
  });
});
