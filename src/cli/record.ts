import chalk from 'chalk';
import { PlaywriterClient, ensurePlaywriterReady } from '../core/playwriter-client.js';
import { RecordingSession } from '../recorder/session.js';

export async function runRecord(name: string, options: { url?: string; analyze?: boolean }): Promise<void> {
  const client = new PlaywriterClient();

  try {
    console.log(chalk.dim('Playwriter接続中...（リレーサーバー未起動の場合は自動起動します）'));
    const { url, title } = await ensurePlaywriterReady(client);
    console.log(chalk.green('Playwriter: 接続済み'));
    console.log(`アクティブタブ: ${url}`);
    console.log(`ページタイトル: ${title}`);
    console.log('');

    // 記録セッション開始
    const session = new RecordingSession(client, name, options.url);
    console.log(chalk.cyan(`記録 "${name}" を開始します...`));
    if (options.url) {
      console.log(chalk.dim(`ナビゲーション先: ${options.url}`));
    }
    await session.start();
    console.log(chalk.green('記録中。ブラウザで操作してください。'));
    console.log(chalk.yellow('Enter キーを押すと記録を停止します。'));
    console.log('');

    // Enter キー待機
    await session.waitForStop();

    console.log('');
    console.log(chalk.dim('記録を停止しています...'));
    const { recordingDir, data } = await session.stop();

    console.log(chalk.green('記録完了！'));
    console.log(`  保存先: ${recordingDir}`);
    console.log(`  アクション数: ${data.actions.length}`);
    console.log(`  リクエスト数: ${data.requests.length}`);
    console.log(`  スナップショット数: ${data.snapshots.length}`);
    console.log('');
    console.log(chalk.dim(`次のステップ: pnpm wa analyze ${name}`));
  } catch (error) {
    console.error(chalk.red('記録エラー:'), error instanceof Error ? error.message : error);
    console.error(chalk.yellow('以下を確認してください:'));
    console.error(chalk.yellow('  1. Chromeが起動していること'));
    console.error(chalk.yellow('  2. Playwriter拡張アイコンをクリック済みであること（緑色になればOK）'));
    if (options.url) {
      console.error(chalk.yellow('  3. --url オプション使用時もPlaywriter拡張の事前有効化が必要です'));
      console.error(chalk.yellow('     拡張を有効化してから再度実行してください'));
    }
    process.exitCode = 1;
  } finally {
    await client.disconnect();
  }
}
