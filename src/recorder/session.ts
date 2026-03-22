import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import readline from 'node:readline';
import chalk from 'chalk';
import { PlaywriterClient } from '../core/playwriter-client.js';
import { config } from '../core/config.js';
import { RecordingData, RecordedComment } from './recording-types.js';
import {
  getResetStateScript,
  getActionRecorderScript,
  getNetworkRecorderScript,
  getFlushSnapshotScript,
  getFinalSnapshotScript,
  getCollectDataScript,
  getCleanupNetworkScript,
  getCleanupDomScript,
} from './injected-scripts.js';

export class RecordingSession {
  private client: PlaywriterClient;
  private name: string;
  private startUrl: string | undefined;
  private startTime = 0;
  private tag?: string;
  private comments: RecordedComment[] = [];

  constructor(client: PlaywriterClient, name: string, startUrl?: string, tag?: string) {
    this.client = client;
    this.name = name;
    this.startUrl = startUrl;
    this.tag = tag;
  }

  async start(): Promise<void> {
    this.startTime = Date.now();

    // 1. state をリセット
    await this.client.execute(getResetStateScript());

    // 2. ネットワーク記録スクリプトを注入（page.on ベースのため先に登録しても問題ない）
    await this.client.execute(getNetworkRecorderScript());

    // 3. URL が指定されていればナビゲーション（DOMリスナー注入前に行う）
    if (this.startUrl) {
      await this.client.execute(`await page.goto(${JSON.stringify(this.startUrl)})`);
    }

    // 4. アクション記録スクリプトを注入（ナビゲーション後の新ドキュメントに対して登録 + framenavigated ハンドラ）
    await this.client.execute(getActionRecorderScript());
  }

  async waitForStop(): Promise<void> {
    return new Promise<void>((resolve) => {
      process.stdin.setRawMode?.(false);
      process.stdin.resume();
      const rl = readline.createInterface({ input: process.stdin, output: process.stdout });

      let resolved = false;
      const teardown = () => {
        if (resolved) return;
        resolved = true;
        rl.close();
        process.stdin.pause();
        resolve();
      };

      rl.on('close', teardown);
      rl.on('line', (line: string) => {
        const trimmed = line.trim();
        if (trimmed === 'q') {
          teardown();
          return;
        }
        if (trimmed === '/list') {
          this.printComments();
          return;
        }
        const delMatch = trimmed.match(/^\/del\s+(\d+)$/);
        if (delMatch) {
          this.deleteComment(parseInt(delMatch[1], 10));
          return;
        }
        const editMatch = trimmed.match(/^\/edit\s+(\d+)\s+(.+)$/);
        if (editMatch) {
          this.editComment(parseInt(editMatch[1], 10), editMatch[2]);
          return;
        }
        if (trimmed === '') return;
        this.comments.push({ timestamp: Date.now(), text: trimmed });
        const idx = this.comments.length;
        console.log(chalk.cyan(`  [${idx}] コメント記録 (${new Date().toLocaleTimeString()}): ${trimmed}`));
      });
    });
  }

  private printComments(): void {
    if (this.comments.length === 0) {
      console.log(chalk.dim('  コメントはありません'));
      return;
    }
    for (let i = 0; i < this.comments.length; i++) {
      const c = this.comments[i];
      const time = new Date(c.timestamp).toLocaleTimeString();
      console.log(chalk.dim(`  [${i + 1}] (${time}) ${c.text}`));
    }
  }

  private deleteComment(num: number): void {
    if (num < 1 || num > this.comments.length) {
      console.log(chalk.red(`  エラー: コメント番号 ${num} は存在しません (1-${this.comments.length})`));
      return;
    }
    const removed = this.comments.splice(num - 1, 1)[0];
    console.log(chalk.yellow(`  削除: [${num}] ${removed.text}`));
  }

  private editComment(num: number, newText: string): void {
    if (num < 1 || num > this.comments.length) {
      console.log(chalk.red(`  エラー: コメント番号 ${num} は存在しません (1-${this.comments.length})`));
      return;
    }
    const old = this.comments[num - 1].text;
    this.comments[num - 1].text = newText;
    console.log(chalk.cyan(`  修正: [${num}] ${old} → ${newText}`));
  }

  async stop(): Promise<{ recordingDir: string; data: RecordingData }> {
    const endTime = Date.now();

    try {
      // 1. デバウンスタイマーをフラッシュ
      await this.client.execute(getFlushSnapshotScript());

      // 2. 最終スナップショットを取得
      await this.client.execute(getFinalSnapshotScript());

      // 3. state から全データを回収（ファイル経由で Playwriter の10000文字制限を回避）
      const tmpFile = path.join(os.tmpdir(), `__wa_collected_${Date.now()}.json`);
      await this.client.execute(getCollectDataScript(tmpFile));
      const collected = JSON.parse(await fs.readFile(tmpFile, 'utf-8'));
      await fs.unlink(tmpFile).catch(() => {});

      // 4. ファイル保存
      const startUrl = this.startUrl || collected.actions?.[0]?.pageUrl || 'unknown';
      const data: RecordingData = {
        startTime: this.startTime,
        endTime,
        startUrl,
        actions: collected.actions || [],
        requests: collected.requests || [],
        snapshots: collected.snapshots || [],
        comments: this.comments,
      };

      const timestamp = formatTimestamp(this.startTime);
      const dirName = this.tag ? `${this.tag}-${timestamp}` : timestamp;
      const recordingDir = path.join(config.recordingsDir, this.name, dirName);
      await fs.mkdir(recordingDir, { recursive: true });

      await Promise.all([
        fs.writeFile(path.join(recordingDir, 'actions.json'), JSON.stringify(data.actions, null, 2)),
        fs.writeFile(path.join(recordingDir, 'requests.json'), JSON.stringify(data.requests, null, 2)),
        fs.writeFile(path.join(recordingDir, 'snapshots.json'), JSON.stringify(data.snapshots, null, 2)),
        fs.writeFile(path.join(recordingDir, 'comments.json'), JSON.stringify(data.comments, null, 2)),
        fs.writeFile(path.join(recordingDir, 'metadata.json'), JSON.stringify({
          startTime: data.startTime,
          endTime: data.endTime,
          startUrl: data.startUrl,
        }, null, 2)),
      ]);

      return { recordingDir, data };
    } finally {
      // 5. ネットワークリスナーを解除（stop() 内のいずれの失敗時も必ず実行）
      await this.client.execute(getCleanupNetworkScript()).catch(() => {});

      // 6. ブラウザ側のDOMリスナーを解除
      await this.client.execute(getCleanupDomScript()).catch(() => {});
    }
  }
}

function formatTimestamp(ms: number): string {
  const d = new Date(ms);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
}
