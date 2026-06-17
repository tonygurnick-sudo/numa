import { forwardRef, useState, type ComponentPropsWithoutRef } from 'react';
import { Dropdown, Spinner } from 'react-bootstrap';
import { Download } from 'react-bootstrap-icons';

export interface RowDownloadOption {
  key: string;
  label: string;
  sublabel?: string;
  /** Async work that fetches + triggers the download. Errors bubble to onError. */
  run: () => Promise<void>;
}

interface Props {
  options: RowDownloadOption[];
  title?: string;
  /** When set, the menu renders disabled with this tooltip (e.g. aggregate view). */
  disabledReason?: string;
  onError?: (message: string) => void;
}

// Custom toggle: a compact icon button with no Bootstrap caret, styled to sit
// quietly in a dense table cell. Accepts the props react-bootstrap injects
// (onClick, aria-*, disabled, …) and forwards the ref Dropdown anchors to.
// Spreading props before our className drops react-bootstrap's `dropdown-toggle`
// class, which is what would otherwise render the caret.
const DownloadToggle = forwardRef<HTMLButtonElement, ComponentPropsWithoutRef<'button'>>(
  ({ children, ...props }, ref) => (
    <button ref={ref} type="button" {...props} className="nd-row-dl">
      {children}
    </button>
  )
);
DownloadToggle.displayName = 'DownloadToggle';

/**
 * Per-row download control: a small download icon that opens a menu of export
 * formats. Manages its own busy state while a download is in flight and routes
 * failures to `onError`. Used by the Top-conversations and Per-agent tables.
 */
export function RowDownloadMenu({ options, title = 'Download', disabledReason, onError }: Props) {
  const [busy, setBusy] = useState(false);

  if (disabledReason) {
    return (
      <button type="button" className="nd-row-dl" disabled title={disabledReason}>
        <Download />
      </button>
    );
  }

  const handle = async (opt: RowDownloadOption) => {
    if (busy) return;
    setBusy(true);
    try {
      await opt.run();
    } catch (e) {
      onError?.(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dropdown align="end">
      <Dropdown.Toggle as={DownloadToggle} disabled={busy} title={title}>
        {busy ? (
          <Spinner animation="border" size="sm" style={{ width: 12, height: 12, borderWidth: 2 }} />
        ) : (
          <Download />
        )}
      </Dropdown.Toggle>
      <Dropdown.Menu renderOnMount popperConfig={{ strategy: 'fixed' }} className="nd-row-dl-menu">
        {options.map((opt) => (
          <Dropdown.Item key={opt.key} onClick={() => void handle(opt)}>
            <div className="fw-semibold">{opt.label}</div>
            {opt.sublabel && <div className="small text-muted">{opt.sublabel}</div>}
          </Dropdown.Item>
        ))}
      </Dropdown.Menu>
    </Dropdown>
  );
}
