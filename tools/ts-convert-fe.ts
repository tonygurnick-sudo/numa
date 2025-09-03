#!/usr/bin/env node

import { execSync } from 'child_process';
import { readdirSync, statSync } from 'fs';
import { join, extname, basename } from 'path';

/**
 * TypeScript conversion script for numa-frontend
 * Converts all .js files to .ts and .jsx files to .tsx using git mv
 */

const FRONTEND_DIR = '/workspaces/numa/numa-frontend';
const EXCLUDE_DIRS = [
  'node_modules',
  'dist',
  '.git',
  'coverage',
  'playwright-report',
  'test-results',
  '.vite',
  '.yarn',
];
const EXCLUDE_FILES = ['vite.config.js', 'eslint.config.js', 'playwright.config.ts.bak'];

interface FileToConvert {
  currentPath: string;
  newPath: string;
  extension: 'js' | 'jsx';
}

/**
 * Recursively finds all JS/JSX files to convert
 */
function findFilesToConvert(dir: string, basePath: string = ''): FileToConvert[] {
  const files: FileToConvert[] = [];

  try {
    const entries = readdirSync(dir);

    for (const entry of entries) {
      const fullPath = join(dir, entry);
      const relativePath = join(basePath, entry);

      // Skip excluded directories
      if (EXCLUDE_DIRS.includes(entry)) {
        continue;
      }

      // Skip excluded files
      if (EXCLUDE_FILES.includes(entry)) {
        continue;
      }

      const stat = statSync(fullPath);

      if (stat.isDirectory()) {
        // Recursively process subdirectories
        files.push(...findFilesToConvert(fullPath, relativePath));
      } else if (stat.isFile()) {
        const ext = extname(entry);
        const name = basename(entry, ext);

        if (ext === '.js') {
          files.push({
            currentPath: relativePath,
            newPath: join(basePath, `${name}.ts`),
            extension: 'js',
          });
        } else if (ext === '.jsx') {
          files.push({
            currentPath: relativePath,
            newPath: join(basePath, `${name}.tsx`),
            extension: 'jsx',
          });
        }
      }
    }
  } catch (error) {
    console.error(`Error reading directory ${dir}:`, error);
  }

  return files;
}

/**
 * Executes git mv command for a file
 */
function gitMoveFile(currentPath: string, newPath: string): boolean {
  try {
    const command = `git mv "${currentPath}" "${newPath}"`;
    console.log(`Moving: ${currentPath} → ${newPath}`);

    execSync(command, {
      cwd: FRONTEND_DIR,
      stdio: 'pipe',
    });

    return true;
  } catch (error) {
    console.error(`Failed to move ${currentPath} to ${newPath}:`, error);
    return false;
  }
}

/**
 * Main conversion function
 */
function convertFiles(): void {
  console.log('🔍 Scanning for JS/JSX files to convert...');

  const filesToConvert = findFilesToConvert(FRONTEND_DIR);

  console.log(`📋 Found ${filesToConvert.length} files to convert:`);
  console.log(`   - ${filesToConvert.filter((f) => f.extension === 'js').length} .js files → .ts`);
  console.log(`   - ${filesToConvert.filter((f) => f.extension === 'jsx').length} .jsx files → .tsx`);

  if (filesToConvert.length === 0) {
    console.log('✅ No files to convert!');
    return;
  }

  console.log('\n🚀 Starting conversion...\n');

  let successCount = 0;
  let failureCount = 0;

  for (const file of filesToConvert) {
    if (gitMoveFile(file.currentPath, file.newPath)) {
      successCount++;
    } else {
      failureCount++;
    }
  }

  console.log('\n📊 Conversion Summary:');
  console.log(`   ✅ Successfully converted: ${successCount} files`);
  console.log(`   ❌ Failed to convert: ${failureCount} files`);

  if (successCount > 0) {
    console.log('\n🎉 File conversion completed!');
    console.log('📝 Next steps:');
    console.log('   1. Add tsconfig.json configuration');
    console.log('   2. Update import statements if needed');
    console.log('   3. Add type annotations');
    console.log('   4. Run TypeScript compiler to check for errors');
  }
}

// Run the conversion when script is executed directly
async function main(): Promise<void> {
  try {
    // Check if we're in a git repository
    execSync('git status', { cwd: FRONTEND_DIR, stdio: 'pipe' });
    convertFiles();
  } catch {
    console.error('❌ Error: This script must be run in a git repository');
    console.error('Make sure you are in the numa-frontend directory and it is a git repository');
    process.exit(1);
  }
}

// Check if script is being run directly (ES module compatible)
const isMainModule = process.argv[1] === new URL(import.meta.url).pathname;
if (isMainModule) {
  main();
}

export { convertFiles, findFilesToConvert };
