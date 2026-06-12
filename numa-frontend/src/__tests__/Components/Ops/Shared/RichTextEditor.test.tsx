import { describe, it, expect, vi } from 'vitest';
import { render, act, waitFor } from '@testing-library/react';
import React, { useState, useEffect } from 'react';
import { RichTextEditor } from '../../../../Components/Ops/Shared/RichTextEditor';

vi.mock('../../../../Providers/ConfirmContext', () => ({
  useAlert: () => vi.fn(),
  usePrompt: () => vi.fn(),
  useConfirm: () => vi.fn(),
}));

// ProseMirror touches DOM APIs jsdom doesn't implement.
(document as unknown as { elementFromPoint: () => null }).elementFromPoint = () => null;

const PLACEHOLDER = 'Sent by my AI assistant';
const LOADED_VALUE = '<p>My real signature</p>';

async function waitForEditor(container: HTMLElement) {
  await waitFor(() => {
    if (!container.querySelector('.rich-text-editor-content')) throw new Error('editor not ready');
  });
}

describe('RichTextEditor', () => {
  it('does not emit onChange when the disabled prop toggles', async () => {
    const onChange = vi.fn();
    const { container, rerender } = render(
      <RichTextEditor value={PLACEHOLDER} disabled onSave={() => {}} onChange={onChange} />
    );
    await waitForEditor(container);

    await act(async () => {
      rerender(<RichTextEditor value={PLACEHOLDER} disabled={false} onSave={() => {}} onChange={onChange} />);
      await new Promise((r) => setTimeout(r, 50));
    });

    // TipTap's setEditable emits an `update` event by default; consumers treat
    // onChange as a user edit, so an emission here lets stale editor content
    // clobber freshly loaded parent state (BUG-357).
    expect(onChange).not.toHaveBeenCalled();
  });

  // Mimics a settings form: state starts as a placeholder while the real value
  // loads; the form is disabled during the load and unlocks when it lands.
  function SettingsHarness({ log }: { log: string[] }) {
    const [value, setValue] = useState(PLACEHOLDER);
    const [loading, setLoading] = useState(true);
    useEffect(() => {
      const tm = setTimeout(() => {
        setValue(LOADED_VALUE);
        setLoading(false);
      }, 30);
      return () => clearTimeout(tm);
    }, []);
    return (
      <RichTextEditor
        value={value}
        disabled={loading}
        onSave={() => {}}
        onChange={(html) => {
          log.push(html);
          setValue(html);
        }}
      />
    );
  }

  it('keeps the loaded value when the form unlocks after its fetch lands (BUG-357)', async () => {
    const log: string[] = [];
    const { container } = render(<SettingsHarness log={log} />);
    await waitForEditor(container);

    await act(async () => {
      await new Promise((r) => setTimeout(r, 150));
    });

    const text = container.querySelector('.rich-text-editor-content')?.textContent ?? '';
    expect(text).toContain('My real signature');
    // No spurious onChange may fire with the pre-load placeholder content.
    expect(log.filter((html) => html.includes(PLACEHOLDER))).toEqual([]);
  });
});
