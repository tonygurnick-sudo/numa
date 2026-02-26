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
