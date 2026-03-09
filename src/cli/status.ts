import chalk from 'chalk';
import { PlaywriterClient, ensurePlaywriterReady } from '../core/playwriter-client.js';

export async function runStatus(): Promise<void> {
  const client = new PlaywriterClient();

  try {
    console.log(chalk.dim('Playwriter接続中...'));
    const { url, title } = await ensurePlaywriterReady(client);
    console.log(chalk.green('Playwriter: 接続済み'));
    console.log(`アクティブタブ: ${url}`);
    console.log(`ページタイトル: ${title}`);

    // snapshotSize を取得して表示（既存の wa status の出力を維持）
    const snapResult = await client.execute(`
      const snap = await accessibilitySnapshot({ page });
      console.log(JSON.stringify({ snapshotSize: snap.length }));
    `);
    const snapMatch = snapResult.match(/\[log\]\s*(.+)/s);
    if (snapMatch) {
      const snapInfo = JSON.parse(snapMatch[1]);
      console.log(`スナップショットサイズ: ${(snapInfo.snapshotSize / 1024).toFixed(1)} KB`);
    }
  } catch (error) {
    console.error(chalk.red('Playwriter接続エラー:'), error instanceof Error ? error.message : error);
    console.error(chalk.yellow('以下を確認してください:'));
    console.error(chalk.yellow('  1. Chromeが起動していること'));
    console.error(chalk.yellow('  2. Playwriter拡張アイコンをクリック済みであること'));
    process.exitCode = 1;
  } finally {
    await client.disconnect();
  }
}
