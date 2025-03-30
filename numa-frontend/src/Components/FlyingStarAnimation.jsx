import { useEffect, useRef } from 'react';

/**
 * Component that creates a smooth flying star animation from a source element to a target element
 * @param {Object} props - Component props
 * @param {Object} props.sourceRect - The bounding rectangle of the source element
 * @param {Object} props.targetElement - The target DOM element
 * @param {Function} props.onAnimationComplete - Callback function to run when animation completes
 */
export const FlyingStarAnimation = ({ sourceRect, targetElement, onAnimationComplete }) => {
  const starRef = useRef(null);

  useEffect(() => {
    if (!sourceRect || !targetElement) return;

    // Get the starting position
    const startX = sourceRect.left + sourceRect.width / 2;
    const startY = sourceRect.top + sourceRect.height / 2;

    // Get the target position
    const targetRect = targetElement.getBoundingClientRect();
    const endX = targetRect.left + targetRect.width / 2;
    const endY = targetRect.top + targetRect.height / 2;

    // Create a unique animation name
    const animationName = `flyStar${Date.now()}`;

    // Create the keyframes for the animation
    const keyframes = `
      @keyframes ${animationName} {
        0% {
          transform: translate(-50%, -50%) scale(1);
          left: ${startX}px;
          top: ${startY}px;
        }
        50% {
          transform: translate(-50%, -50%) scale(2.5); /* Grow larger in the middle */
          left: ${startX + (endX - startX) / 2}px;
          top: ${startY + (endY - startY) / 2 - 30}px; /* Add a slight arc */
        }
        100% {
          transform: translate(-50%, -50%) scale(0.5);
          left: ${endX}px;
          top: ${endY}px;
        }
      }
    `;

    // Add the animation to the document
    const styleElement = document.createElement('style');
    styleElement.innerHTML = keyframes;
    document.head.appendChild(styleElement);

    // Apply the animation to the star element
    if (starRef.current) {
      starRef.current.style.animation = `${animationName} 0.8s cubic-bezier(0.25, 0.1, 0.25, 1) forwards`;
    }

    // Add a pulse effect to the target element
    setTimeout(() => {
      targetElement.classList.add('pulse-animation');
    }, 600);

    // Clean up after animation completes
    const animationTimeout = setTimeout(() => {
      if (onAnimationComplete) {
        onAnimationComplete();
      }

      // Remove the pulse class after a delay
      setTimeout(() => {
        targetElement.classList.remove('pulse-animation');
      }, 1000);
    }, 800);

    // Clean up function
    return () => {
      document.head.removeChild(styleElement);
      clearTimeout(animationTimeout);
    };
  }, [sourceRect, targetElement, onAnimationComplete]);

  return (
    <div
      ref={starRef}
      style={{
        position: 'fixed',
        left: 0,
        top: 0,
        zIndex: 9999,
        pointerEvents: 'none',
        transform: 'translate(-50%, -50%)',
      }}
    >
      <i className="bi bi-star-fill" style={{ color: '#ffc107', fontSize: '20px' }} />
    </div>
  );
};
