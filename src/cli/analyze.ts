import fs from 'fs/promises';
import path from 'path';
import chalk from 'chalk';
import { config } from '../core/config.js';
import { RecordingData } from '../recorder/recording-types.js';
import { classifyActions } from '../analyzer/shortest-path.js';
import { writeBrief } from '../analyzer/brief-builder.js';

export async function runAnalyze(name: string, recordingDir?: string): Promise<void> {
  try {
    let targetDir: string;
    let timestamp: string;

    if (recordingDir) {
      // --analyze フラグ経由: 直接パスを使用
      targetDir = recordingDir;
      timestamp = path.basename(recordingDir);
    } else {
      // 手動実行: ディレクトリ走査で最新を選択
      const taskDir = path.join(config.recordingsDir, name);
      let entries: string[];
      try {
        entries = await fs.readdir(taskDir);
      } catch {
        console.error(chalk.red(`記録が見つかりません: ${taskDir}`));
        process.exitCode = 1;
        return;
      }

      const timestampPattern = /^\d{8}-\d{6}$/;
      const timestamps = entries
        .filter(e => timestampPattern.test(e))
        .sort()
        .reverse();

      if (timestamps.length === 0) {
        console.error(chalk.red(`"${name}" の記録データが見つかりません（${taskDir} 内にタイムスタンプディレクトリがありません）`));
        process.exitCode = 1;
        return;
      }

      timestamp = timestamps[0];
      targetDir = path.join(taskDir, timestamp);
    }

    console.log(chalk.cyan(`分析対象: ${targetDir}`));

    // ファイル読み込み
    let actionsRaw: string, requestsRaw: string, snapshotsRaw: string;
    try {
      [actionsRaw, requestsRaw, snapshotsRaw] = await Promise.all([
        fs.readFile(path.join(targetDir, 'actions.json'), 'utf-8'),
        fs.readFile(path.join(targetDir, 'requests.json'), 'utf-8'),
        fs.readFile(path.join(targetDir, 'snapshots.json'), 'utf-8'),
      ]);
    } catch (err) {
      console.error(chalk.red(`記録ファイルの読み込みに失敗しました: ${err instanceof Error ? err.message : err}`));
      process.exitCode = 1;
      return;
    }

    let actions, requests, snapshots;
    try {
      actions = JSON.parse(actionsRaw);
      requests = JSON.parse(requestsRaw);
      snapshots = JSON.parse(snapshotsRaw);
    } catch (err) {
      console.error(chalk.red(`JSON パースエラー: ${err instanceof Error ? err.message : err}`));
      process.exitCode = 1;
      return;
    }

    // metadata.json 読み込み（フォールバック対応）
    let startTime: number, endTime: number, startUrl: string;
    try {
      const metadataRaw = await fs.readFile(path.join(targetDir, 'metadata.json'), 'utf-8');
      const metadata = JSON.parse(metadataRaw);
      startTime = metadata.startTime;
      endTime = metadata.endTime;
      startUrl = metadata.startUrl;
    } catch {
      // metadata.json が存在しない場合のフォールバック
      startTime = parseTimestampDir(timestamp);
      const lastActionTs = actions.length > 0 ? actions[actions.length - 1].timestamp : 0;
      const lastRequestTs = requests.length > 0 ? requests[requests.length - 1].timestamp : 0;
      endTime = Math.max(lastActionTs, lastRequestTs) || startTime;
      startUrl = actions[0]?.pageUrl || 'unknown';
    }

    const data: RecordingData = { startTime, endTime, startUrl, actions, requests, snapshots };

    // 分析設定
    const analysis = config.analysis;
    const windowMs = analysis?.actionApiCorrelationWindowMs ?? 1000;
    const goalMethods = analysis?.goalMethods ?? ['POST', 'PATCH', 'PUT', 'DELETE'];
    const goalExcludePatterns = analysis?.goalExcludePatterns ?? [];

    console.log(chalk.dim(`  アクション数: ${actions.length}, リクエスト数: ${requests.length}`));

    // 分類実行
    const result = classifyActions(actions, requests, windowMs, goalMethods, goalExcludePatterns);

    console.log(chalk.dim(`  分類結果: api=${result.apiCount}, ui=${result.uiCount}, skip=${result.skippedCount}`));

    // ブリーフ生成
    const authStatePath = path.join(config.recordingsDir, name, 'latest', 'auth-state.json');
    let briefPath: string;
    try {
      briefPath = await writeBrief(name, timestamp, data, result, authStatePath, config.recordingsDir);
    } catch (err) {
      console.error(chalk.red(`ブリーフの書き出しに失敗しました: ${err instanceof Error ? err.message : err}`));
      process.exitCode = 1;
      return;
    }

    console.log('');
    console.log(chalk.green('分析ブリーフを生成しました:'));
    console.log(`  ${briefPath}`);
    console.log('');
    console.log(chalk.dim('次のステップ: Claude Code でこのファイルを読んでスキルを生成してください:'));
    console.log(chalk.dim(`  「${briefPath} を読んで .claude/skills/${name}/SKILL.md を生成してください」`));
  } catch (err) {
    console.error(chalk.red(`分析エラー: ${err instanceof Error ? err.message : err}`));
    process.exitCode = 1;
  }
}

function parseTimestampDir(dirname: string): number {
  // YYYYMMDD-HHmmss → Date
  const match = dirname.match(/^(\d{4})(\d{2})(\d{2})-(\d{2})(\d{2})(\d{2})$/);
  if (!match) return Date.now();
  const [, y, mo, d, h, mi, s] = match;
  return new Date(+y, +mo - 1, +d, +h, +mi, +s).getTime();
}
