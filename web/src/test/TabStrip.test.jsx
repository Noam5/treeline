import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import TabStrip from '../components/TabStrip.jsx';

// A tab is identified by its repository path: duplicate detection keeps them
// unique, so no separate id is needed.
const tabs = ['/home/user/projects/myapp', '/home/user/projects/binder'];

function strip(props = {}) {
  return render(<TabStrip tabs={tabs} activeRepo={tabs[0]} onActivate={() => {}} onClose={() => {}}
    onNew={() => {}} onMove={() => {}} {...props} />);
}

describe('TabStrip', () => {
  it('labels each tab with the repository name and full path', () => {
    strip();
    expect(screen.getByText('myapp')).toBeTruthy();
    expect(screen.getByTitle('/home/user/projects/binder')).toBeTruthy();
  });

  it('marks the active tab', () => {
    strip({ activeRepo: tabs[1] });
    expect(screen.getByText('binder').closest('.tab').className).toContain('active');
    expect(screen.getByText('myapp').closest('.tab').className).not.toContain('active');
  });

  it('disambiguates tabs whose folder names collide', () => {
    render(<TabStrip activeRepo="/src/web/client" onActivate={() => {}} onClose={() => {}}
      onNew={() => {}} tabs={['/src/web/client', '/src/api/client']} />);
    expect(screen.getByText('web/client')).toBeTruthy();
    expect(screen.getByText('api/client')).toBeTruthy();
  });

  it('activates a tab on click', () => {
    const onActivate = vi.fn();
    strip({ onActivate });
    fireEvent.click(screen.getByText('binder'));
    expect(onActivate).toHaveBeenCalledWith(tabs[1]);
  });

  it('closes a tab from its ✕ without activating it', () => {
    const onClose = vi.fn();
    const onActivate = vi.fn();
    strip({ onClose, onActivate });
    fireEvent.click(screen.getByTitle('Close binder'));
    expect(onClose).toHaveBeenCalledWith(tabs[1]);
    expect(onActivate).not.toHaveBeenCalled();
  });

  it('closes a tab on middle-click', () => {
    const onClose = vi.fn();
    strip({ onClose });
    // fireEvent has no auxClick helper; React listens for the native event.
    fireEvent(screen.getByText('binder'),
      new MouseEvent('auxclick', { bubbles: true, button: 1 }));
    expect(onClose).toHaveBeenCalledWith(tabs[1]);
  });

  it('ignores right-click', () => {
    const onClose = vi.fn();
    strip({ onClose });
    fireEvent(screen.getByText('binder'),
      new MouseEvent('auxclick', { bubbles: true, button: 2 }));
    expect(onClose).not.toHaveBeenCalled();
  });

  it('asks for a new tab', () => {
    const onNew = vi.fn();
    strip({ onNew });
    fireEvent.click(screen.getByTitle(/open a repository folder/i));
    expect(onNew).toHaveBeenCalled();
  });

  // jsdom has no DataTransfer, so drag events carry a stub.
  const dataTransfer = () => ({ setData: vi.fn(), effectAllowed: '', dropEffect: '' });
  const tabEl = (label) => screen.getByText(label).closest('.tab');

  it('reorders when one tab is dragged onto another', () => {
    const onMove = vi.fn();
    strip({ onMove });
    const dt = dataTransfer();

    fireEvent.dragStart(tabEl('binder'), { dataTransfer: dt });
    fireEvent.dragOver(tabEl('myapp'), { dataTransfer: dt });

    expect(dt.setData).toHaveBeenCalled(); // Chromium needs data set to start a drag
    expect(onMove).toHaveBeenCalledWith(tabs[1], 0);
  });

  it('does not reorder a tab dragged over itself', () => {
    const onMove = vi.fn();
    strip({ onMove });
    const dt = dataTransfer();

    fireEvent.dragStart(tabEl('binder'), { dataTransfer: dt });
    fireEvent.dragOver(tabEl('binder'), { dataTransfer: dt });

    expect(onMove).not.toHaveBeenCalled();
  });

  it('marks the tab being dragged, and stops when the drag ends', () => {
    strip();
    const tab = tabEl('binder');

    fireEvent.dragStart(tab, { dataTransfer: dataTransfer() });
    expect(tab.className).toContain('dragging');

    fireEvent.dragEnd(tab);
    expect(tab.className).not.toContain('dragging');
  });

  it('ignores a dragover that did not start on a tab', () => {
    const onMove = vi.fn();
    strip({ onMove });
    fireEvent.dragOver(tabEl('myapp'), { dataTransfer: dataTransfer() });
    expect(onMove).not.toHaveBeenCalled();
  });
});
