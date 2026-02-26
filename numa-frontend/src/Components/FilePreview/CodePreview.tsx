import React from 'react';
import { Prism as SyntaxHighlighter } from 'react-syntax-highlighter';
import { oneDark } from 'react-syntax-highlighter/dist/esm/styles/prism';

interface CodePreviewProps {
  content: string;
  language: string;
  filename: string;
}

export const CodePreview: React.FC<CodePreviewProps> = ({ content, language, filename: _filename }) => {
  return (
    <div className="code-preview-container">
      <SyntaxHighlighter
        language={language}
        style={oneDark}
        showLineNumbers
        wrapLongLines
        customStyle={{
          margin: 0,
          borderRadius: 0,
          fontSize: '0.8125rem',
          lineHeight: '1.5',
          minHeight: '100%',
        }}
      >
        {content}
      </SyntaxHighlighter>
    </div>
  );
};
