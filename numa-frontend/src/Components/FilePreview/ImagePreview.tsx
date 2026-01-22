import React from 'react';

interface ImagePreviewProps {
  src: string;
  filename: string;
}

/**
 * Image Preview Component
 * Displays images with responsive sizing
 */
export const ImagePreview: React.FC<ImagePreviewProps> = ({ src, filename }) => {
  return (
    <div className="workspace-image-preview text-center p-3">
      <img
        src={src}
        alt={filename}
        style={{
          maxWidth: '100%',
          maxHeight: '600px',
          objectFit: 'contain',
          borderRadius: '4px',
        }}
      />
    </div>
  );
};
