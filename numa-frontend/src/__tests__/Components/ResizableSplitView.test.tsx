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
      />,
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
      />,
    );

    // Left panel is still rendered
    expect(screen.getByText('Left Panel')).toBeInTheDocument();
    // Right panel should not be rendered
    expect(screen.queryByText('Right Panel')).toBeNull();
    // Divider should not be rendered when showRight is false
    expect(container.querySelector('div[style*="width: 5px"]')).toBeNull();
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
      />,
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

    // Find the divider element by its inline style width "5px"
    const divider = container.querySelector('div[style*="width: 5px"]');
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
      />,
    );
    // Find the handle element (the inner div inside the divider with width "6px")
    const handle = container.querySelector('div[style*="width: 6px"]');
    expect(handle).toBeInTheDocument();

    // Initially, the background should use the non-hovered gradient.
    expect(handle.style.background).toContain('repeating-linear-gradient(#aaa');

    // Simulate mouse enter on the handle.
    fireEvent.mouseEnter(handle);
    expect(handle.style.background).toContain('repeating-linear-gradient(#888');

    // Simulate mouse leave on the handle.
    fireEvent.mouseLeave(handle);
    expect(handle.style.background).toContain('repeating-linear-gradient(#aaa');
  });
});
