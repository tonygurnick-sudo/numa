/**
 * @vitest-environment jsdom
 */
import { render, screen, fireEvent } from '@testing-library/react';
import '@testing-library/jest-dom';
import { vi } from 'vitest';
import ResizableSplitView from '../../Components/ResizableSplitView';

describe('ResizableSplitView Component', () => {
  const leftContent = <div>Left Panel</div>;
  const rightContent = <div>Right Panel</div>;

  it('renders left and right panels when showRight is true', () => {
    const onLeftFractionChange = vi.fn();
    render(
      <ResizableSplitView
        left={leftContent}
        right={rightContent}
        showRight={true}
        leftFraction={0.5}
        onLeftFractionChange={onLeftFractionChange}
      />
    );

    // Left panel should be rendered
    expect(screen.getByText('Left Panel')).toBeInTheDocument();
    // Right panel should be rendered
    expect(screen.getByText('Right Panel')).toBeInTheDocument();
  });

  it('does not render right panel or divider when showRight is false', () => {
    const onLeftFractionChange = vi.fn();
    const { container } = render(
      <ResizableSplitView
        left={leftContent}
        right={rightContent}
        showRight={false}
        leftFraction={0.5}
        onLeftFractionChange={onLeftFractionChange}
      />
    );

    // Left panel is still rendered
    expect(screen.getByText('Left Panel')).toBeInTheDocument();
    // Right panel should not be rendered
    expect(screen.queryByText('Right Panel')).toBeNull();
    // Divider should not be rendered when showRight is false
    expect(container.querySelector('div[style*="cursor: col-resize"]')).toBeNull();
  });

  it('dragging adjusts leftFraction', () => {
    const onLeftFractionChange = vi.fn();
    const { container } = render(
      <ResizableSplitView
        left={leftContent}
        right={rightContent}
        showRight={true}
        leftFraction={0.5}
        onLeftFractionChange={onLeftFractionChange}
        minLeft={200}
        minRight={200}
      />
    );
    // Get the main container element and override its getBoundingClientRect to simulate dimensions.
    const containerDiv = container.firstChild;
    containerDiv.getBoundingClientRect = () => ({
      left: 0,
      width: 1000,
      height: 500,
      top: 0,
      bottom: 500,
      right: 1000,
    });

    // Find the divider element by its col-resize cursor
    const divider = container.querySelector('div[style*="cursor: col-resize"]');
    expect(divider).toBeInTheDocument();

    // Simulate mouse down on the divider to start dragging.
    fireEvent.mouseDown(divider);
    // Simulate mouse move on window: if clientX is 300, then newLeftFraction = 300/1000 = 0.3.
    fireEvent.mouseMove(window, { clientX: 300 });
    expect(onLeftFractionChange).toHaveBeenCalledWith(0.3);

    // Simulate mouse up to stop dragging.
    fireEvent.mouseUp(window);
  });

  it('handle hovered state changes background style on mouse enter/leave', () => {
    const onLeftFractionChange = vi.fn();
    const { container } = render(
      <ResizableSplitView
        left={leftContent}
        right={rightContent}
        showRight={true}
        leftFraction={0.5}
        onLeftFractionChange={onLeftFractionChange}
      />
    );
    // Find the divider by its col-resize cursor
    const divider = container.querySelector('div[style*="cursor: col-resize"]');
    expect(divider).toBeInTheDocument();

    // Initially, the background should be the resting color (#e4e4e7)
    expect(divider.style.backgroundColor).toBe('rgb(228, 228, 231)');

    // Simulate mouse enter — should darken (#a1a1aa)
    fireEvent.mouseEnter(divider);
    expect(divider.style.backgroundColor).toBe('rgb(161, 161, 170)');

    // Simulate mouse leave — should return to resting state
    fireEvent.mouseLeave(divider);
    expect(divider.style.backgroundColor).toBe('rgb(228, 228, 231)');
  });
});
