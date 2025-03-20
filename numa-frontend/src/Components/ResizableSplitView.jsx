import { useState, useRef, useEffect } from 'react';

const ResizableSplitView = ({
  left,
  right,
  showRight = true,
  minLeft = 200,
  minRight = 200,
  leftFraction,
  onLeftFractionChange,
}) => {
  const containerRef = useRef(null);
  const [dragging, setDragging] = useState(false);
  const [handleHovered, setHandleHovered] = useState(false);

  // Consider the right panel collapsed when leftFraction is above 0.95
  const isCollapsed = leftFraction > 0.95;

  const handleCollapse = () => {
    if (!isCollapsed) {
      // Collapse right panel: left takes up nearly all width.
      onLeftFractionChange(0.99);
    } else {
      // Restore to default (e.g., 0.45 leaves room for the doc panel)
      onLeftFractionChange(0.45);
    }
  };

  const handleMouseDown = () => {
    setDragging(true);
  };

  const handleMouseMove = (e) => {
    if (!dragging || !containerRef.current) return;
    const containerRect = containerRef.current.getBoundingClientRect();
    let newLeftFraction = (e.clientX - containerRect.left) / containerRect.width;
    const minLeftFrac = minLeft / containerRect.width;
    const minRightFrac = minRight / containerRect.width;
    if (newLeftFraction < minLeftFrac) {
      newLeftFraction = minLeftFrac;
    } else if (newLeftFraction > 1 - minRightFrac) {
      newLeftFraction = 1 - minRightFrac;
    }
    onLeftFractionChange(newLeftFraction);
  };

  const handleMouseUp = () => {
    setDragging(false);
  };

  useEffect(() => {
    if (dragging) {
      window.addEventListener('mousemove', handleMouseMove);
      window.addEventListener('mouseup', handleMouseUp);
    } else {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
    }
    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
    };
  }, [dragging]);

  return (
    <div
      ref={containerRef}
      style={{
        display: 'flex',
        width: '100%',
        height: '100%',
        position: 'relative',
        overflow: 'hidden',
      }}
    >
      {/* Left Panel */}
      <div
        style={{
          flex: `0 0 ${leftFraction * 99.5}%`,
          height: '100%',
          overflowY: 'auto',
        }}
      >
        {left}
      </div>

      {/* Divider – only if showRight is true */}
      {showRight && (
        <div
          style={{
            width: '5px',
            position: 'relative',
            zIndex: 10,
            backgroundColor: 'transparent',
          }}
          onMouseDown={handleMouseDown}
        >
          {/* Collapse Button at the Top */}
          <button
            onClick={(e) => {
              e.stopPropagation();
              handleCollapse();
            }}
            style={{
              position: 'absolute',
              top: '8px',
              left: '50%',
              transform: 'translateX(-50%)',
              border: '1px solid #ccc',
              background: '#fff',
              borderRadius: '4px',
              fontSize: '12px',
              width: '24px',
              height: '24px',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              boxShadow: '0 1px 2px rgba(0,0,0,0.2)',
            }}
          >
            {isCollapsed ? '❮' : '❯'}
          </button>

          {/* Three-Dot Handle */}
          <div
            style={{
              height: '100%',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <div
              onMouseEnter={() => setHandleHovered(true)}
              onMouseLeave={() => setHandleHovered(false)}
              style={{
                width: '6px',
                height: '26px',
                background: handleHovered
                  ? 'repeating-linear-gradient(#888 0 2px, transparent 2px 4px)'
                  : 'repeating-linear-gradient(#aaa 0 2px, transparent 2px 4px)',
                borderRadius: '2px',
              }}
            />
          </div>
        </div>
      )}

      {/* Right Panel */}
      {showRight && (
        <div
          style={{
            flex: `0 0 ${(1 - leftFraction) * 99.5}%`,
            height: '100%',
            overflowY: 'auto',
            paddingBottom: '0.5rem',
          }}
        >
          {right}
        </div>
      )}
    </div>
  );
};

export default ResizableSplitView;
