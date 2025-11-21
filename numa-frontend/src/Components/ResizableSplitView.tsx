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
          flex: showRight ? `0 0 ${leftFraction * 99.5}%` : '1 1 100%',
          height: '100%',
          overflowY: 'auto',
          transition: dragging ? 'none' : 'flex 0.15s ease-out',
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
            padding: '1rem',
            transition: dragging ? 'none' : 'flex 0.15s ease-out',
          }}
        >
          {right}
        </div>
      )}
    </div>
  );
};

export default ResizableSplitView;
