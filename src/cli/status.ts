import { execSync } from 'child_process';
import { config } from '../core/config.js';

export async function runStatus(): Promise<void> {
  console.log('=== Web Automation Status ===\n');

  console.log(`Profile: ${config.automationProfileDir}`);

  // アクティブセッション（headed/headless は list 出力に含まれる）
  let listOutput = '';
  try {
    listOutput = execSync('pnpm exec playwright-cli list', { encoding: 'utf-8', timeout: 5000 }).trim();
  } catch { /* ignore */ }

  console.log('\n--- Active Sessions ---');
  if (listOutput) {
    console.log(listOutput);
  } else {
    console.log('  (なし)');
  }
}
