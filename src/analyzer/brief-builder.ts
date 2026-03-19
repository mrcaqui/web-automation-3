import fs from 'fs/promises';
import path from 'path';
import { RecordingData } from '../recorder/recording-types.js';
import { ShortestPathResult, ClassifiedAction } from '../core/types.js';

export function buildBrief(
  taskName: string,
  timestamp: string,
  data: RecordingData,
  result: ShortestPathResult,
  authStatePath: string,
): string {
  const lines: string[] = [];

  // --- YAML フロントマター ---
  lines.push('---');
  lines.push(`task: ${taskName}`);
  lines.push(`recordingTimestamp: "${timestamp}"`);
  lines.push(`authStatePath: "${authStatePath}"`);
  lines.push(`totalActions: ${result.classified.length}`);
  lines.push(`goalRequests: ${result.goalRequests.length}`);
  lines.push(`skippedActions: ${result.skippedCount}`);
  lines.push('---');
  lines.push('');

  // --- タスク概要 ---
  lines.push('## タスク概要');
  lines.push('');
  lines.push(`- **タスク名**: ${taskName}`);
  lines.push(`- **記録日時**: ${formatDate(data.startTime)} 〜 ${formatDate(data.endTime)}`);
  lines.push(`- **開始URL**: ${data.startUrl}`);
  lines.push(`- **総操作数**: ${result.classified.length}`);
  lines.push(`- **分類**: api=${result.apiCount}, ui=${result.uiCount}, skip=${result.skippedCount}`);
  lines.push('');

  // --- 最短経路最適化の結果 ---
  lines.push('## 最短経路最適化の結果');
  lines.push('');

  if (result.goalRequests.length > 0) {
    lines.push('### ゴール操作（状態変更API）');
    lines.push('');
    for (const r of result.goalRequests) {
      lines.push(`- \`${r.method} ${r.url}\` (status: ${r.responseStatus ?? 'unknown'})`);
    }
    lines.push('');
  }

  const skipped = result.classified.filter(c => c.classification === 'skip');
  if (skipped.length > 0) {
    lines.push('### 省略されたUIステップ');
    lines.push('');
    for (const c of skipped) {
      const el = c.action.element;
      const desc = `${c.action.type} on ${el.tag}${el.id ? '#' + el.id : ''}${el.ariaLabel ? ' [' + el.ariaLabel + ']' : ''}`;
      lines.push(`- ステップ ${c.originalIndex}: ${desc} — ${c.skipReason || '不要と判定'}`);
    }
    lines.push('');
  }

  // --- ステップ詳細 ---
  lines.push('## ステップ詳細');
  lines.push('');

  let stepNum = 0;
  for (const c of result.classified) {
    stepNum++;
    lines.push(`### ステップ ${stepNum} [${c.classification}]`);
    lines.push('');

    if (c.classification === 'skip') {
      lines.push(`省略理由: ${c.skipReason || '不要と判定'}`);
      lines.push('');
      continue;
    }

    if (c.classification === 'ui') {
      renderUiStep(lines, c, data);
    } else if (c.classification === 'api') {
      renderApiStep(lines, c, data);
    }
  }

  // --- スキルファイル生成指示 ---
  lines.push('## スキルファイル生成指示');
  lines.push('');
  lines.push('このブリーフを基に、`skill-creator` スキルを呼び出してスキルファイルを生成してください。');
  lines.push('');
  lines.push(`- **生成先**: \`.claude/skills/${taskName}/SKILL.md\``);
  lines.push('- **ベーススキル**: `playwright-cli` スキル（`.claude/skills/playwright-cli/SKILL.md`）を使用してブラウザ操作を実行');
  lines.push('- **認証**: `--extension` モードで既存ブラウザに接続（ログイン済み Cookie を利用）');
  lines.push('- **要素指定**: `snapshot` → `ref` 番号で要素を指定');
  lines.push('- **最短経路優先**: skip 判定のステップはスキルに含めず、可能なら API を直接呼ぶ');
  lines.push('- **フロントマター**: `allowed-tools` はスキルファイルで非対応。`name` と `description` のみ記載すること');
  lines.push('');
  lines.push('### playwright-cli の利用');
  lines.push('');
  lines.push('ブラウザ操作は `playwright-cli` スキル（`.claude/skills/playwright-cli/SKILL.md`）のコマンドで実行する。');
  lines.push('`playwright-cli` はローカルインストールのため、すべてのコマンドを `pnpm exec playwright-cli` で実行すること。');
  lines.push('API 呼び出しは `run-code` + `page.evaluate(() => fetch(...))` パターンを使用（詳細は `.claude/skills/playwright-cli/references/running-code.md` を参照）。');
  lines.push('');
  lines.push('### 認証方式別の方針');
  lines.push('');
  lines.push('- **cookie / none**: API 直接呼び出し可。Cookie はブラウザから自動適用');
  lines.push('- **bearer / basic**: UI フロー維持を推奨。API 直接呼び出しにはトークン/クレデンシャルの事前取得が必要');
  lines.push('- **csrf**: CSRF トークン取得 → API 呼び出しの2段階。トークン取得元はブリーフの各ステップに記載');
  lines.push('');
  lines.push('### フォーム入力');
  lines.push('');
  lines.push('記録された value は参考値。パラメータ化が必要な場合はスキルの引数として定義してください。');
  lines.push('');
  lines.push('### ユーザーへの質問');
  lines.push('');
  lines.push('ユーザーへの質問・確認が必要な場合は、テキスト出力ではなく必ず `AskUserQuestion` ツールを使用すること。');
  lines.push('');
  lines.push('### run-code の記述');
  lines.push('');
  lines.push('`run-code` のコードはシェル解析エラーを避けるため、必ずシングルライン（1行）で記述すること。');
  lines.push('');

  return lines.join('\n');
}

export async function writeBrief(
  taskName: string,
  timestamp: string,
  data: RecordingData,
  result: ShortestPathResult,
  authStatePath: string,
  recordingsDir: string,
): Promise<string> {
  const content = buildBrief(taskName, timestamp, data, result, authStatePath);
  const briefPath = path.join(recordingsDir, taskName, timestamp, 'analysis-brief.md');
  await fs.writeFile(briefPath, content, 'utf-8');
  return briefPath;
}

// --- ヘルパー ---

function formatDate(ms: number): string {
  const d = new Date(ms);
  return d.toISOString().replace('T', ' ').replace(/\.\d+Z$/, '');
}

function renderUiStep(lines: string[], c: ClassifiedAction, data: RecordingData): void {
  const el = c.action.element;
  lines.push(`- **操作**: ${c.action.type}`);
  lines.push(`- **ページ**: ${c.action.pageUrl}`);
  lines.push(`- **要素**: tag=\`${el.tag}\`, role=\`${el.role}\`, ariaLabel=\`${el.ariaLabel}\`, text=\`${el.text.slice(0, 80)}\`, id=\`${el.id}\`, name=\`${el.name}\``);
  if (el.context) {
    lines.push(`- **コンテキスト**: ${el.context}`);
  }
  if (c.action.value !== undefined) {
    lines.push(`- **入力値**: \`${c.action.value}\``);
  }

  // isGoalTrigger の ui ステップ（bearer/basic/csrf 認証）ではリクエスト詳細を併記
  if (c.isGoalTrigger && c.correlatedRequests.length > 0) {
    lines.push('');
    lines.push('> **注意**: このステップは状態変更 API をトリガーしますが、認証方式により UI フロー維持が推奨されます。');
    lines.push('> API 直接呼び出しと UI 操作のどちらを採用するか判断してください。');
    lines.push('');
    for (const r of c.correlatedRequests) {
      lines.push(`  - \`${r.method} ${r.url}\` (auth: ${r.authInfo?.type || 'none'}${r.authInfo?.csrfTokenSource ? ', csrf-header: ' + r.authInfo.csrfTokenSource : ''})`);
      if (r.requestBody) {
        lines.push(`    requestBody: \`${r.requestBody.slice(0, 500)}\``);
      }
      if (r.responseSummary) {
        lines.push(`    responseSummary: \`${r.responseSummary.slice(0, 200)}\``);
      }
    }
  }

  // スナップショット
  const snapshot = findBestSnapshot(data, c.originalIndex);
  if (snapshot) {
    const snipContent = snapshot.content.length > 1000
      ? snapshot.content.slice(0, 1000) + '\n...(truncated)'
      : snapshot.content;
    lines.push('');
    lines.push('<details><summary>スナップショット</summary>');
    lines.push('');
    lines.push('```');
    lines.push(snipContent);
    lines.push('```');
    lines.push('');
    lines.push('</details>');
  }

  lines.push('');
}

function renderApiStep(lines: string[], c: ClassifiedAction, data: RecordingData): void {
  const el = c.action.element;
  lines.push(`- **トリガー操作**: ${c.action.type} on ${el.tag}${el.id ? '#' + el.id : ''}${el.ariaLabel ? ' [' + el.ariaLabel + ']' : ''}`);
  lines.push('');

  for (const r of c.correlatedRequests) {
    lines.push(`#### ${r.method} ${r.url}`);
    lines.push('');
    lines.push(`- **status**: ${r.responseStatus ?? 'unknown'}`);
    lines.push(`- **auth**: ${r.authInfo?.type || 'none'}${r.authInfo?.csrfTokenSource ? ' (csrf-header: ' + r.authInfo.csrfTokenSource + ')' : ''}`);
    if (r.requestBody) {
      lines.push(`- **requestBody**: \`${r.requestBody.slice(0, 500)}\``);
    }
    if (r.responseSummary) {
      lines.push(`- **responseSummary**: \`${r.responseSummary.slice(0, 200)}\``);
    }
    lines.push('');
  }

  // スナップショット（api ステップにも付与）
  const snapshot = findBestSnapshot(data, c.originalIndex);
  if (snapshot) {
    const snipContent = snapshot.content.length > 1000
      ? snapshot.content.slice(0, 1000) + '\n...(truncated)'
      : snapshot.content;
    lines.push('<details><summary>スナップショット</summary>');
    lines.push('');
    lines.push('```');
    lines.push(snipContent);
    lines.push('```');
    lines.push('');
    lines.push('</details>');
    lines.push('');
  }
}

function findBestSnapshot(
  data: RecordingData,
  originalIndex: number,
): { content: string } | null {
  const isPlaceholder = (s: { content: string }) =>
    s.content.startsWith('No changes since last snapshot');

  // originalIndex に一致するスナップショットのうち、プレースホルダを除外して最後の1つ
  const exact = data.snapshots
    .filter(s => s.actionIndex === originalIndex && !isPlaceholder(s));
  if (exact.length > 0) return exact[exact.length - 1];

  // フォールバック: actionIndex < originalIndex で最も近い非プレースホルダ
  let best: { content: string } | null = null;
  let bestIdx = -1;
  for (const s of data.snapshots) {
    if (s.actionIndex < originalIndex && !isPlaceholder(s)) {
      if (s.actionIndex > bestIdx) {
        bestIdx = s.actionIndex;
        best = s;
      }
    }
  }
  return best;
}

