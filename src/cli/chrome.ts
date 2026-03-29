import { execSync } from 'child_process';
import { config } from '../core/config.js';

export async function runChrome(options: { stop?: boolean }): Promise<void> {
  if (options.stop) {
    const output = execSync('pnpm exec playwright-cli close', { encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] });
    if (output.includes('is not open')) {
      console.log('アクティブなセッションはありません');
    } else {
      console.log('セッションを終了しました');
    }
    return;
  }

  const profileDir = config.automationProfileDir;
  console.log('To start browser (headless):');
  console.log(`  pnpm exec playwright-cli open --profile="${profileDir}"`);
  console.log('');
  console.log('To start browser (headed, for SSO or debug):');
  console.log(`  pnpm exec playwright-cli open --profile="${profileDir}" --headed`);
}
