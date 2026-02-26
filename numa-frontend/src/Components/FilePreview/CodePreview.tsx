import React from 'react';
import { Prism as SyntaxHighlighter } from 'react-syntax-highlighter';
import { oneDark } from 'react-syntax-highlighter/dist/esm/styles/prism';

interface CodePreviewProps {
  content: string;
  language: string;
  filename: string;
}

// Map file extensions to Prism language identifiers
const EXTENSION_TO_LANGUAGE: Record<string, string> = {
  py: 'python',
  sh: 'bash',
  js: 'javascript',
  jsx: 'jsx',
  ts: 'typescript',
  tsx: 'tsx',
  java: 'java',
  cpp: 'cpp',
  c: 'c',
  h: 'c',
  hpp: 'cpp',
  go: 'go',
  rb: 'ruby',
  php: 'php',
  yaml: 'yaml',
  yml: 'yaml',
  xml: 'xml',
  sql: 'sql',
  rs: 'rust',
  swift: 'swift',
  kt: 'kotlin',
  cs: 'csharp',
  css: 'css',
  scss: 'scss',
  less: 'less',
  r: 'r',
  m: 'objectivec',
  pl: 'perl',
  lua: 'lua',
  dart: 'dart',
  tf: 'hcl',
  toml: 'toml',
  ini: 'ini',
  dockerfile: 'docker',
  makefile: 'makefile',
};

export const getLanguageFromExtension = (ext: string): string => {
  return EXTENSION_TO_LANGUAGE[ext.toLowerCase()] || 'text';
};

export const CODE_EXTENSIONS = Object.keys(EXTENSION_TO_LANGUAGE);

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
