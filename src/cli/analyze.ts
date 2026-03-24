import fs from "fs/promises";
import path from "path";
import chalk from "chalk";
import { config } from "../core/config.js";
import { RecordingData, RecordedComment } from "../recorder/recording-types.js";
import { classifyActions } from "../analyzer/shortest-path.js";
import { writeBrief } from "../analyzer/brief-builder.js";

export async function runAnalyze(
  name: string,
  recordingDir?: string,
  opts?: { tag?: string; dir?: string },
): Promise<void> {
  // バリデーション
  if (opts?.tag && opts?.dir) {
    console.error(chalk.red("エラー: --tag と --dir は同時に指定できません"));
    process.exitCode = 1;
    return;
  }
  if (opts?.tag && !/^[a-zA-Z0-9_-]+$/.test(opts.tag)) {
    console.error(
      chalk.red(
        "エラー: --tag には英数字・ハイフン・アンダースコアのみ使用できます",
      ),
    );
    process.exitCode = 1;
    return;
  }
  const recordingDirPattern = /^(?:[A-Za-z0-9_-]+-)?(\d{8}-\d{6})$/;
  if (
    opts?.dir &&
    (opts.dir.includes("..") ||
      opts.dir.includes("/") ||
      opts.dir.includes("\\") ||
      !recordingDirPattern.test(opts.dir))
  ) {
    console.error(
      chalk.red(
        "エラー: --dir には記録ディレクトリ名（例: 20260322-110420 または tag-20260322-110420）を指定してください",
      ),
    );
    process.exitCode = 1;
    return;
  }

  try {
    let targetDir: string;
    let timestamp: string;

    if (recordingDir) {
      // --analyze フラグ経由: 直接パスを使用
      targetDir = recordingDir;
      timestamp = path.basename(recordingDir);
    } else if (opts?.dir) {
      // --dir 指定: 直接ディレクトリ名を使用
      const taskDir = path.join(config.recordingsDir, name);
      targetDir = path.join(taskDir, opts.dir);
      timestamp = opts.dir;
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

      let filtered: string[];
      if (opts?.tag) {
        // タグ指定: ^<tag>-\d{8}-\d{6}$ でフィルタ
        const escapedTag = escapeRegExp(opts.tag);
        const tagPattern = new RegExp(`^${escapedTag}-\\d{8}-\\d{6}$`);
        filtered = entries.filter((e) => tagPattern.test(e));
      } else {
        // タグなし: 従来互換（タグなし記録のみ）
        const timestampPattern = /^\d{8}-\d{6}$/;
        filtered = entries.filter((e) => timestampPattern.test(e));
      }

      // パース済みタイムスタンプでソート
      filtered.sort((a, b) => {
        const ta = parseTimestampDir(a);
        const tb = parseTimestampDir(b);
        return tb - ta;
      });

      if (filtered.length === 0) {
        if (!opts?.tag) {
          // タグなし記録が0件 → タグ付き記録の存在チェック
          const taggedPattern = /^[A-Za-z0-9_-]+-\d{8}-\d{6}$/;
          const hasTagged = entries.some((e) => taggedPattern.test(e));
          if (hasTagged) {
            console.error(
              chalk.red(
                `"${name}" のタグなし記録が見つかりません。タグ付き記録のみ存在します。`,
              ),
            );
            console.error(chalk.yellow("`--tag <tag>` を指定してください。"));
            process.exitCode = 1;
            return;
          }
        }
        console.error(
          chalk.red(
            `"${name}" の記録データが見つかりません（${taskDir} 内にタイムスタンプディレクトリがありません）`,
          ),
        );
        process.exitCode = 1;
        return;
      }

      timestamp = filtered[0];
      targetDir = path.join(taskDir, timestamp);
    }

    console.log(chalk.cyan(`分析対象: ${targetDir}`));

    // ファイル読み込み
    let actionsRaw: string, requestsRaw: string, snapshotsRaw: string;
    try {
      [actionsRaw, requestsRaw, snapshotsRaw] = await Promise.all([
        fs.readFile(path.join(targetDir, "actions.json"), "utf-8"),
        fs.readFile(path.join(targetDir, "requests.json"), "utf-8"),
        fs.readFile(path.join(targetDir, "snapshots.json"), "utf-8"),
      ]);
    } catch (err) {
      console.error(
        chalk.red(
          `記録ファイルの読み込みに失敗しました: ${err instanceof Error ? err.message : err}`,
        ),
      );
      process.exitCode = 1;
      return;
    }

    let actions, requests, snapshots;
    try {
      actions = JSON.parse(actionsRaw);
      requests = JSON.parse(requestsRaw);
      snapshots = JSON.parse(snapshotsRaw);
    } catch (err) {
      console.error(
        chalk.red(
          `JSON パースエラー: ${err instanceof Error ? err.message : err}`,
        ),
      );
      process.exitCode = 1;
      return;
    }

    // metadata.json 読み込み（フォールバック対応）
    let startTime: number, endTime: number, startUrl: string;
    try {
      const metadataRaw = await fs.readFile(
        path.join(targetDir, "metadata.json"),
        "utf-8",
      );
      const metadata = JSON.parse(metadataRaw);
      startTime = metadata.startTime;
      endTime = metadata.endTime;
      startUrl = metadata.startUrl;
    } catch {
      // metadata.json が存在しない場合のフォールバック
      startTime = parseTimestampDir(timestamp);
      const lastActionTs =
        actions.length > 0 ? actions[actions.length - 1].timestamp : 0;
      const lastRequestTs =
        requests.length > 0 ? requests[requests.length - 1].timestamp : 0;
      endTime = Math.max(lastActionTs, lastRequestTs) || startTime;
      startUrl = actions[0]?.pageUrl || "unknown";
    }

    // comments.json 読み込み（旧記録の ENOENT のみ許容）
    let comments: RecordedComment[] = [];
    const commentsPath = path.join(targetDir, "comments.json");
    try {
      comments = JSON.parse(await fs.readFile(commentsPath, "utf-8"));
    } catch (err: any) {
      if (err?.code !== "ENOENT") throw err;
    }

    const data: RecordingData = {
      startTime,
      endTime,
      startUrl,
      actions,
      requests,
      snapshots,
      comments,
    };

    // 分析設定
    const analysis = config.analysis;
    const windowMs = analysis?.actionApiCorrelationWindowMs ?? 1000;
    const goalMethods = analysis?.goalMethods ?? [
      "POST",
      "PATCH",
      "PUT",
      "DELETE",
    ];
    const goalExcludePatterns = analysis?.goalExcludePatterns ?? [];

    console.log(
      chalk.dim(
        `  アクション数: ${actions.length}, リクエスト数: ${requests.length}`,
      ),
    );

    // 分類実行
    const result = classifyActions(
      actions,
      requests,
      windowMs,
      goalMethods,
      goalExcludePatterns,
    );

    console.log(
      chalk.dim(
        `  分類結果: api=${result.apiCount}, ui=${result.uiCount}, skip=${result.skippedCount}`,
      ),
    );

    // ブリーフ生成
    let briefPath: string;
    try {
      briefPath = await writeBrief(
        name,
        timestamp,
        data,
        result,
        config.recordingsDir,
      );
    } catch (err) {
      console.error(
        chalk.red(
          `ブリーフの書き出しに失敗しました: ${err instanceof Error ? err.message : err}`,
        ),
      );
      process.exitCode = 1;
      return;
    }

    console.log("");
    console.log(chalk.green("分析ブリーフを生成しました:"));
    console.log(`  ${briefPath}`);
    console.log("");
    console.log(
      chalk.dim(
        "次のステップ: Claude Code でこのファイルを読んでスキルを生成してください:",
      ),
    );
    console.log(
      chalk.dim(
        `  「${briefPath} を読んでスキルを生成して」`,
      ),
    );
  } catch (err) {
    console.error(
      chalk.red(`分析エラー: ${err instanceof Error ? err.message : err}`),
    );
    process.exitCode = 1;
  }
}

function parseTimestampDir(dirname: string): number {
  // tag-YYYYMMDD-HHmmss or YYYYMMDD-HHmmss → Date
  const match = dirname.match(
    /^(?:[A-Za-z0-9_-]+-)?(\d{4})(\d{2})(\d{2})-(\d{2})(\d{2})(\d{2})$/,
  );
  if (!match) return Date.now();
  const [, y, mo, d, h, mi, s] = match;
  return new Date(+y, +mo - 1, +d, +h, +mi, +s).getTime();
}

function escapeRegExp(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
