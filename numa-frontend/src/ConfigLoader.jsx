import fs from 'fs';
import path from 'path';

export function loadConfig() {
  const localConfigPath = path.resolve('./public/config.local.json');
  const defaultConfigPath = path.resolve('./public/config.json');

  let configContent;

  if (fs.existsSync(localConfigPath)) {
    console.log('Using local config file');
    configContent = fs.readFileSync(localConfigPath, 'utf-8');
  } else {
    console.log('Using default config file');
    configContent = fs.readFileSync(defaultConfigPath, 'utf-8');
  }

  return JSON.parse(configContent);
}
