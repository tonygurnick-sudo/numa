import React, { ReactNode } from 'react';

export interface StickyToolbarProps {
  children: ReactNode;
  className?: string;
}

/**
 * Consistent sticky toolbar wrapper for all pages.
 * Provides consistent styling and sticky positioning while preserving toolbar internals.
 *
 * Features:
 * - Sticky positioning at top of content area
 * - Consistent padding and background
 * - Subtle border and shadow for visual separation
 * - Responsive container
 * - Minimal wrapper to preserve existing component styling
 *
 * @example
 * <StickyToolbar>
 *   <YourExistingToolbarContent />
 * </StickyToolbar>
 */
export const StickyToolbar: React.FC<StickyToolbarProps> = ({ children, className = '' }) => {
  return (
    <div
      className={`sticky-toolbar ${className}`}
      style={{
        position: 'sticky',
        top: '0px',
        zIndex: 1020,
        backgroundColor: 'rgba(255, 255, 255, 0.95)',
        backdropFilter: 'blur(8px)',
        borderBottom: '1px solid #dee2e6',
        boxShadow: '0 2px 8px rgba(0,0,0,0.1)',
        marginBottom: '1rem',
        paddingTop: '1rem',
        paddingBottom: '1rem',
        // Ensure it sticks to the top of the viewport
        width: '100%',
      }}
    >
      {children}
    </div>
  );
};

export default StickyToolbar;
