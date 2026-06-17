import { describe, it, expect } from 'vitest';

import { parseNumaRenderCommand } from '../../utils/workspaceChatEventHandlers';

describe('parseNumaRenderCommand (render-on-reload reconstruction)', () => {
  it('parses an inline --content HTML render', () => {
    const r = parseNumaRenderCommand(
      `numa render --type html --content '<h1>Hi</h1>' --title 'Greeting' -m "show greeting"`
    );
    expect(r).toEqual({
      render_type: 'html',
      content: '<h1>Hi</h1>',
      title: 'Greeting',
      height: undefined,
      mime_type: undefined,
      file_path: undefined,
    });
  });

  it('keeps spaces and quotes inside --content intact', () => {
    const html = `<div class="a b">x = "1" and y</div>`;
    const r = parseNumaRenderCommand(`numa render --content '${html}' -m "x"`);
    expect(r?.content).toBe(html);
    expect(r?.render_type).toBe('html');
  });

  it('infers html from a --file-path .svg with no inline content', () => {
    const r = parseNumaRenderCommand(`numa render --file-path /workdir/outputs/chart.svg -m "chart"`);
    expect(r).toMatchObject({ render_type: 'html', file_path: '/workdir/outputs/chart.svg' });
    expect(r?.content).toBeUndefined();
  });

  it('infers image type + mime from a --file-path .png', () => {
    const r = parseNumaRenderCommand(`numa render --file-path /workdir/outputs/pic.png -m "pic"`);
    expect(r).toMatchObject({ render_type: 'image', mime_type: 'image/png', file_path: '/workdir/outputs/pic.png' });
    expect(r?.content).toBeUndefined();
  });

  it('honours --height and explicit --type', () => {
    const r = parseNumaRenderCommand(`numa render --type html --content '<p>x</p>' --height 600 -m "x"`);
    expect(r?.height).toBe(600);
  });

  it('survives a leading rate-limit export prefix', () => {
    const r = parseNumaRenderCommand(`export NUMA_BASH_CALL_ID=toolu_abc; numa render --content '<b>ok</b>' -m "x"`);
    expect(r?.content).toBe('<b>ok</b>');
  });

  it('stops at a chained command, not bleeding the next command in', () => {
    const r = parseNumaRenderCommand(`numa render --content '<p>a</p>' -m "x" && echo done`);
    expect(r?.content).toBe('<p>a</p>');
  });

  it('returns null for non-render bash', () => {
    expect(parseNumaRenderCommand('numa files list --json -m "x"')).toBeNull();
    expect(parseNumaRenderCommand('ls -la /workdir')).toBeNull();
  });

  it('returns null on unbalanced quotes (fail soft to bash indicator)', () => {
    expect(parseNumaRenderCommand(`numa render --content '<p>unclosed -m "x"`)).toBeNull();
  });

  it('returns null when neither --content nor --file-path is present', () => {
    expect(parseNumaRenderCommand(`numa render --title 'x' -m "x"`)).toBeNull();
  });

  it('returns null for an unrenderable --file-path extension', () => {
    expect(parseNumaRenderCommand(`numa render --file-path /workdir/data.json -m "x"`)).toBeNull();
  });
});
