# wd-loop

wd スキル（`.claude/skills/wd/SKILL.md`）の実行速度を自律的に最適化する実験ループ。

## Setup

ユーザーと協力してセットアップする:

1. **ランタグの決定**: 今日の日付ベースでタグを提案する（例: `mar29`）。ブランチ `wd-loop/<tag>` が存在しないことを確認する。
2. **ブランチ作成**: `git checkout -b wd-loop/<tag>` を現在の main から作成。
3. **対象ファイルの読み込み**: 以下を読んで全体像を把握する:
   - `.claude/skills/wd/SKILL.md` — 修正対象。サブフロー A〜F、セレクタ一覧、定数。
   - `.claude/skills/skill-rules.md` — SSO 認証、シフト表解析の共通ルール。
   - `wd-loop/verify.js` — 検証スクリプト（固定、修正不可）。
   - `wd-loop/cleanup.js` — クリーンアップスクリプト（固定、修正不可）。
4. **シフトデータの取得**: `pnpm wa shift-excel 202603 Yosuke` を実行し、出力 JSON を保持する。
5. **プロンプトテンプレートの生成**: シフトデータから種別判定を行い、`wd-loop/.tmp-prompt.txt` を生成する（後述「プロンプトテンプレート」参照）。
6. **results.tsv の初期化**: ヘッダ行のみで作成。ベースラインは最初の実行後に記録する。
7. **確認して開始**: セットアップの確認を取り、実験を開始する。

## 実験条件

- **対象範囲**: 2026年3月1日〜3月27日
- **入力対象**: 勤務時間（Hours Worked）+ On Call Standby Hours のみ
- **PTO/FC**: 入力済みのためスキップ（プロンプトで指示）
- **DFM**: 該当日なし（3月分）
- **計測範囲**: 入力開始 → 検証 → 一括削除完了まで（全体の wall-clock time）
- **モデル**: sonnet（サブプロセスの claude -p）

## プロンプトテンプレート

`wd-loop/.tmp-prompt.txt` として保存し、各実験で `claude -p` に渡す。シフトデータから勤務日・Oncall日を計算してテンプレートに埋め込むこと:

```
.claude/skills/wd/SKILL.md を読み、2026年3月分の Workday 勤怠入力を実行せよ。

【非対話モード設定】
- AskUserQuestion は一切呼ばない。全確認は事前承認済み。
- shift.xlsx のダウンロード・鮮度確認をスキップ。データは下記提供済み。
- セッション復旧ダイアログチェックをスキップ。

【対象範囲】: 2026年3月1日〜3月27日
【種別判定結果（確認済み）】:
- PTO: 3/11, 3/25（入力済み → スキップ）
- FC: 3/19（入力済み → スキップ）
- DFM: なし
- Oncall(B): 3/15(土), 3/21(土) → On Call Standby Hours 入力
- 勤務日: 3/2,3/3,3/4,3/5,3/6,3/9,3/10,3/12,3/13,3/16,3/17,3/18,3/20,3/23,3/24,3/26,3/27

実行する操作:
1. サブフロー A: 時間入力ページ遷移 + 月表示切替
2. サブフロー B: クイック追加で勤務日の時間を週ごとに一括入力（3/1-3/27の勤務日のみ）
3. サブフロー F: Oncall(B) の On Call Standby Hours 入力（3/15, 3/21）

休暇申請（PTO/FC）は入力済みのため実行しない。
DFM 日はないためサブフロー E はスキップ。
3/28以降は対象外。
```

## 修正対象

**修正できるのは `.claude/skills/wd/SKILL.md` のみ。** これが唯一のチューニング対象。
サブフロー構成、セレクタ、待機時間、run-code ブロック構成、指示文の書き方など、何でも変更できる。

**修正できないもの:**
- `wd-loop/verify.js` — 検証ロジックは固定。
- `wd-loop/cleanup.js` — クリーンアップロジックは固定。
- `wd-loop/program.md` — この指示書自体。
- Workday の UI/DOM 構造 — コントロール不可。

**目標は単純: 最短の time_sec を達成すること。** 入力 + 検証 + 削除の全体時間が計測対象。
正解性（verify.js の結果が expected と一致）は必須制約。速くても正しくなければ失敗扱い。

**最初の実行**: 最初の実行は必ず現在の SKILL.md をそのまま実行し、ベースラインを記録する。

## 実行手順

各実験は以下の手順で実行する:

### ステップ 1: 実行 + 計測

```bash
START=$(date +%s)
claude -p "$(cat wd-loop/.tmp-prompt.txt)" --dangerously-skip-permissions --no-session-persistence --model sonnet --output-format stream-json --verbose > wd-loop/run.log 2>&1 &
CLAUDE_PID=$!
echo $CLAUDE_PID > wd-loop/.pid
wait $CLAUDE_PID
rm -f wd-loop/.pid
```

- `--output-format stream-json` — 各イベント（ツール呼び出し・結果・応答）を JSONL で逐次出力。実行中もリアルタイムで記録される。
- `--verbose` — stream-json に必要。
- `wd-loop/.pid` にサブプロセスの PID を保存し、完了後に削除する。

### ステップ 1.5: ログ分析

実験完了後、run.log の JSONL を解析してタイミングサマリーを生成する:

```bash
node -e "
const fs = require('fs');
const lines = fs.readFileSync('wd-loop/run.log','utf8').trim().split('\n');
const events = lines.map(l => { try { return JSON.parse(l) } catch { return null } }).filter(Boolean);
const calls = {};
const results = [];
let t0 = null;
for (const ev of events) {
  if (ev.type === 'assistant' && ev.message?.content) {
    for (const c of ev.message.content) {
      if (c.type === 'tool_use') calls[c.id] = { name: c.name, desc: (c.input?.description || c.input?.command || c.input?.file_path || '').slice(0,70) };
    }
  }
  if (ev.type === 'user' && ev.timestamp) {
    const ts = new Date(ev.timestamp).getTime();
    if (!t0) t0 = ts;
    const toolId = ev.message?.content?.[0]?.tool_use_id;
    if (toolId && calls[toolId]) {
      results.push({ ...calls[toolId], elapsed: (ts - t0) / 1000 });
    }
  }
  if (ev.type === 'result') {
    const total = (ev.duration_ms / 1000).toFixed(0);
    const api = (ev.duration_api_ms / 1000).toFixed(0);
    console.log('Total: ' + total + 's (API: ' + api + 's) Turns: ' + ev.num_turns + ' Cost: \$' + (ev.total_cost_usd||0).toFixed(3));
  }
}
for (let i = results.length - 1; i > 0; i--) results[i].step = results[i].elapsed - results[i-1].elapsed;
if (results.length) results[0].step = results[0].elapsed;
console.log('\nTimeline:');
for (const r of results) {
  const flag = (r.step || 0) > 10 ? ' *' : '';
  console.log('  [' + r.elapsed.toFixed(0) + 's] ' + r.name + ': ' + r.desc + ' (' + (r.step||0).toFixed(1) + 's)' + flag);
}
console.log('\nSlowest:');
[...results].sort((a,b) => (b.step||0) - (a.step||0)).slice(0,5).forEach(r =>
  console.log('  ' + (r.step||0).toFixed(1) + 's  ' + r.name + ': ' + r.desc));
"
```

出力例:
```
Total: 185s (API: 42s) Turns: 12 Cost: $0.230

Timeline:
  [3s]  Bash: playwright-cli goto ... (3.0s)
  [16s] Bash: playwright-cli run-code ... (13.0s) *
  [28s] Bash: playwright-cli run-code ... (12.0s) *

Slowest:
  13.0s  Bash: playwright-cli run-code ...
  12.0s  Bash: playwright-cli run-code ...
```

このサマリーを次の最適化アイデアの根拠として使う。`result` イベントの `duration_api_ms` は results.tsv の `api_sec` 列に記録する。

### ステップ 2: 検証

入力直後（削除前）に実行:

```bash
pnpm exec playwright-cli run-code "$(tr '\n' ' ' < wd-loop/verify.js)"
```

出力は JSON: `{ "hwCount": N, "ocCount": M, "total": N+M }`

期待値（ベースラインで補正、初期見積もり）:
- `hwCount`: 勤務日17日 × 3（午前・休憩・午後）= 51
- `ocCount`: Oncall 2日 × 2（当日 + 翌日）= 4

検証が失敗（期待値と不一致）した場合は、run.log の JSONL からエラーイベントを確認する（ステップ 1.5 のサマリーも参照）。

### ステップ 3: クリーンアップ

```bash
pnpm exec playwright-cli run-code "$(tr '\n' ' ' < wd-loop/cleanup.js)"
END=$(date +%s)
TIME_SEC=$((END - START))
```

削除完了の `END` で計測終了。出力 JSON の `deleted` 数を確認する。

### ステップ 4: 検証が成功したか確認

クリーンアップ後に `verify.js` を再実行し、`total: 0`（または PTO/FC 由来の既存エントリのみ）であることを確認:

```bash
pnpm exec playwright-cli run-code "$(tr '\n' ' ' < wd-loop/verify.js)"
```

## ログ記録

実験完了後、`results.tsv`（タブ区切り、カンマは description で使うため不可）に記録する。

ヘッダ行と列:

```
commit	time_sec	api_sec	hw_count	oc_count	expected_hw	expected_oc	status	description
```

1. git commit hash（短縮7文字）
2. 計測時間（秒）— クラッシュ/タイムアウト時は 0
3. API 時間（秒）— run.log の `result` イベントの `duration_api_ms` から算出。クラッシュ時は 0
4. verify.js の hwCount — クラッシュ時は 0
5. verify.js の ocCount — クラッシュ時は 0
6. 期待 hwCount
7. 期待 ocCount
8. status: `keep`, `discard`, `fail`, `crash`
9. この実験で試した内容の短い説明

例:

```
commit	time_sec	api_sec	hw_count	oc_count	expected_hw	expected_oc	status	description
a1b2c3d	245	42	51	4	51	4	keep	baseline
b2c3d4e	198	38	51	4	51	4	keep	reduce waitForTimeout to 200ms
c3d4e5f	0	0	0	0	51	4	crash	removed all waits (timeouts)
d4e5f6g	210	40	51	4	51	4	discard	combine subflow A blocks
```

## 実験ループ

専用ブランチ（例: `wd-loop/mar29`）で実行する。

**LOOP FOREVER:**

1. git の状態を確認: 現在のブランチ/コミット
2. `.claude/skills/wd/SKILL.md` を読み、前回のログ分析サマリー（ステップ 1.5）を参考に最適化アイデアを考える
   - Playwright 操作（run-code）が遅い → run-code 統合、waitForTimeout 削減
   - API 時間が長い → SKILL.md を短縮して token 処理時間を削減
   - 特定サブフローが支配的 → そのサブフローに集中
3. SKILL.md を修正する
4. `git commit` する
5. 実験を実行（上記「実行手順」のステップ 1〜4）
6. 結果を `results.tsv` に記録する（NOTE: results.tsv はコミットしない、git untracked のまま）
7. **判定**:
   - 検証 pass かつ `time_sec < best_time` → **keep**（ブランチを進める）
   - 検証 pass かつ `time_sec >= best_time` → **discard**（`git reset --hard HEAD~1`）
   - 検証 fail → **fail**（`git reset --hard HEAD~1`）
   - タイムアウト/クラッシュ → **crash**（`git reset --hard HEAD~1`）
8. ステップ 1 に戻る

完全に自律的な研究者として動作する。うまくいけば keep、いかなければ discard。ブランチを進めながらイテレーションする。

**タイムアウト**: 各実験は最大10分。`wd-loop/.pid` から PID を読み取り、プロセスツリーごと停止する:

```bash
if [ -f wd-loop/.pid ]; then
  PID=$(cat wd-loop/.pid)
  taskkill //PID $PID //T //F 2>/dev/null
  rm -f wd-loop/.pid
fi
```

**クラッシュ**: サブプロセスがクラッシュした場合、判断する: 簡単に直せるバグ（typo、import 漏れ）なら修正して再実行。根本的に壊れたアイデアならスキップして次へ。

**NEVER STOP**: 実験ループ開始後、ユーザーに「続けますか？」と聞いてはいけない。ユーザーは離席しているかもしれない。手動で中断されるまで無限にループし続けること。アイデアが尽きたら、SKILL.md を再読してまだ試していない角度を探すか、過去の失敗を分析して新しいアプローチを考える。

## 最適化アイデア（出発点）

**Tier 1（低リスク、まず試す）**:
1. `waitForTimeout(500)` を 200ms/100ms に削減（SKILL.md 内に6箇所、計3s削減可能性）
2. サブフロー A の 2 つの run-code ブロックを 1 つに統合（bash + Node 起動オーバーヘッド削減）
3. サブフロー B のステップ 1-3（メニュー → 週選択 → 次へ → 次へ）を 1 run-code に統合

**Tier 2（中程度のリスク）**:
4. On Call（サブフロー F）の全日を 1 run-code でループ処理
5. 指示文をより命令的・簡潔に書き換え、LLM の解釈時間を短縮
6. 不要な条件分岐や注意書きを削除して SKILL.md を短縮

**Tier 3（高リスク、大きな変更）**:
7. 全週のクイック追加を 1 run-code 内でループ化（週ごとにメニュー開閉しない）
8. 全フロー（サブフロー A → B → F）を 1 つの大きな run-code に統合

## 実験の手動停止

ユーザーが実験を手動で停止したい場合の方法:

### 方法 1: PID ファイルを使う（推奨）

実験中は `wd-loop/.pid` にサブプロセスの PID が保存される。

**PowerShell**:
```powershell
$pid = Get-Content wd-loop\.pid
Stop-Process -Id $pid -Force
```

**コマンドプロンプト / Git Bash**:
```bash
taskkill //PID $(cat wd-loop/.pid) //T //F
```

### 方法 2: コマンドラインで特定して停止

**PowerShell**:
```powershell
Get-CimInstance Win32_Process -Filter "Name='claude.exe'" |
  Where-Object { $_.CommandLine -match ' -p ' } |
  ForEach-Object { Stop-Process -Id $_.ProcessId -Force }
```

`wd-loop/.pid` が存在しない場合（異常終了等）はこちらを使う。
