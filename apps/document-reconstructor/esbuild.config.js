// esbuild.config.js
import { build } from 'esbuild';

build({
  entryPoints: ['./index.ts'],  // Entry point for your Lambda function
  bundle: true,                 // Bundle all dependencies into one file
  platform: 'node',             // Target Node.js environment
  format: 'esm',                // Output format as ES Modules
  entryNames: '[name]/index',   // Output name as `index.mjs` in a folder named after the entry point
  outdir: 'dist/functions',     // Output directory for the bundled file
  outExtension: { '.js': '.mjs' }, // Change the output extension to .mjs
  external: ['@aws-sdk/client-s3', '@aws-sdk/client-textract'], // Exclude these packages from the bundle
  minify: true,                 // Minify the output for smaller size
}).catch(() => process.exit(1));
