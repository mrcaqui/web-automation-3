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
  lines.push(`このブリーフを基に、\`skill-creator\` スキルを呼び出してスキルファイルを生成してください。`);
  lines.push('');
  lines.push(`- **生成先**: \`.claude/skills/${taskName}/SKILL.md\``);
  lines.push(`- **種類**: playwright-cli（\`@playwright/cli\`）コマンドをエージェントのシェルツールで実行するスキル`);
  lines.push(`- **認証**: \`--extension\` モードで既存ブラウザに接続し、ログイン済み Cookie を利用`);
  lines.push('- **要素指定**: `snapshot` → `ref` 番号で要素を指定');
  lines.push('- **最短経路優先**: skip 判定のステップはスキルに含めず、可能なら API を直接呼ぶ');
  lines.push('');

  lines.push(...buildPlaywrightCliReference());

  // 認証方式別の指示
  lines.push('### API ステップの認証方式別ガイド');
  lines.push('');
  lines.push('- **cookie / none**: `run-code` + `page.evaluate(() => fetch(...))` を使い REST API を直接呼び出す。Cookie は接続先ブラウザから自動適用');
  lines.push('- **bearer**: Authorization ヘッダーは接続先ブラウザの Cookie に含まれない。UI フロー維持を推奨。playwright-cli の `click`, `fill`, `press` コマンドで記述。トークン取得元（localStorage キー名、別 API レスポンス等）を特定して事前取得ステップを生成する方法もあり');
  lines.push('- **basic**: HTTP Basic 認証。Bearer と同様。UI フロー維持を推奨し、playwright-cli の `click`, `fill`, `press` コマンドで記述。直接呼び出す場合はクレデンシャルをスキル引数として定義');
  lines.push('- **csrf**: CSRF トークンの取得元ヘッダ名がブリーフに記載されている。スキル内で `run-code` + `page.evaluate()` でトークン取得 → fetch ヘッダ付与の2段階で実行');
  lines.push('');
  lines.push('### フォーム入力');
  lines.push('');
  lines.push('記録された value は参考値。パラメータ化が必要な場合はスキルの引数として定義してください。');
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

function buildPlaywrightCliReference(): string[] {
  const lines: string[] = [];

  lines.push('### playwright-cli リファレンス');
  lines.push('');

  // 前提条件
  lines.push('#### 前提条件');
  lines.push('');
  lines.push('- `@playwright/cli` がローカルインストール済みであること。コマンドは必ず **`pnpm exec playwright-cli`** で実行する（`npx` は未インストール時にリモートからインストールしようとするため避ける）');
  lines.push('- 既存ブラウザへの接続: **`--extension` モード** を使用。Playwright MCP Bridge 拡張を Chrome にインストールし、`--extension` フラグで接続');
  lines.push('- **実行前に MCP Bridge 拡張のアイコンをクリックして Connect しておくこと**（権限ダイアログの表示を回避するため）');
  lines.push('- 接続設定は `.playwright/cli.config.json` または環境変数で事前設定を推奨（コマンドごとにフラグを渡さない）');
  lines.push('');

  // セッション管理
  lines.push('#### セッション管理');
  lines.push('');
  lines.push('スキル実行時は名前付きセッションを使用する：');
  lines.push('');
  lines.push('    pnpm exec playwright-cli -s={taskName} open {url}');
  lines.push('');
  lines.push('**重要**: `pnpm exec` は呼び出しごとに別プロセスとなるため、`open` → `run-code` → `close` を **`&&` でチェーン**して1行にまとめること。分割するとセッションが切れて「browser is not open」エラーになる：');
  lines.push('');
  lines.push('    pnpm exec playwright-cli -s={name} open --extension {url} && pnpm exec playwright-cli -s={name} run-code "..." && pnpm exec playwright-cli -s={name} close');
  lines.push('');
  lines.push('セッション一覧: `pnpm exec playwright-cli list`');
  lines.push('');

  // コマンド構文
  lines.push('#### コマンド構文');
  lines.push('');
  lines.push('| 操作 | 構文 |');
  lines.push('|---|---|');
  lines.push('| ナビゲーション | `pnpm exec playwright-cli -s={name} open {url}` |');
  lines.push("| API 呼び出し（GET） | `pnpm exec playwright-cli -s={name} run-code \"async page => { const r = await page.evaluate(() => fetch('{url}').then(r => r.json())); return JSON.stringify(r); }\"` |");
  lines.push("| API 呼び出し（POST/DELETE） | `pnpm exec playwright-cli -s={name} run-code \"async page => { const r = await page.evaluate(() => fetch('{url}', { method: '{METHOD}', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({...}).toString() }).then(r => r.json())); return JSON.stringify(r); }\"` |");
  lines.push('| スナップショット | `pnpm exec playwright-cli -s={name} snapshot` |');
  lines.push('| クリック | `pnpm exec playwright-cli -s={name} click {ref}` |');
  lines.push("| テキスト入力 | `pnpm exec playwright-cli -s={name} fill {ref} '{value}'` |");
  lines.push('| キー押下 | `pnpm exec playwright-cli -s={name} press Enter` |');
  lines.push('| タブ一覧 | `pnpm exec playwright-cli -s={name} tab-list` |');
  lines.push('| スクリーンショット | `pnpm exec playwright-cli -s={name} screenshot` |');
  lines.push('');

  // ref 番号について
  lines.push('#### ref 番号について');
  lines.push('');
  lines.push('- `snapshot` コマンドの出力にアクセシビリティツリーが YAML 形式で表示される');
  lines.push('- 各要素に `ref` 番号が付与される');
  lines.push('- `click`, `fill` 等のコマンドではこの `ref` 番号で要素を指定する');
  lines.push('- UI 操作の流れ: `snapshot` → ref 確認 → `click {ref}` or `fill {ref} \'{value}\'`');
  lines.push('');

  // API 呼び出しのパターン
  lines.push('#### API 呼び出しのパターン');
  lines.push('');
  lines.push('- **`eval` は単純な式評価用**（例: `eval "document.title"`）。`fetch().then()` チェーンでは `TypeError` になるため API 呼び出しには使わない');
  lines.push('- API 呼び出しには **`run-code` + `page.evaluate()`** を使う: `run-code "async page => { const r = await page.evaluate(() => fetch(...).then(r => r.json())); return JSON.stringify(r); }"`');
  lines.push('- `page.evaluate()` 内の `fetch()` はブラウザコンテキストで実行されるため、ログイン済み Cookie が自動適用される');
  lines.push('- API レスポンスのフィールド名はブリーフの `responseSummary` を参照して正確な名前を使用する');
  lines.push('');

  // 注意事項
  lines.push('#### 注意事項');
  lines.push('');
  lines.push('- `--state` オプションは存在しない。認証は接続先ブラウザの既存 Cookie に依存');
  lines.push('- ARIA ロール+名前によるセレクタではなく、`snapshot` → `ref` 番号で要素を指定する');
  lines.push('- `page.goto`, `page.evaluate` 等の生 Playwright API をコマンドラインから直接使用しない（`run-code` コマンド経由で使う）');
  lines.push('- コマンドを分割して実行するとセッションが切れるため、必ず `&&` でチェーンする');
  lines.push('');

  return lines;
}
