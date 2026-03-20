# 進捗ログ

## 2026-03-20

#### 1. brief-builder 認証方式を SSO/AutomationProfile に移行 (v0.2.3)

**Issue**

- ブリーフ生成時に `auth-state.json` パスを参照していたが、SSO トークンは日次失効のため保存状態の再利用が不可能だった。AutomationProfile の Chrome セッションを利用する方式に統一する必要があった。

**Changes**

- `buildBrief()` / `writeBrief()` から `authStatePath` パラメータを削除。ブリーフの認証セクションを SSO 認証チェック手順（AutomationProfile 接続 → ナビゲート → SSO リダイレクト検出 → 手動認証依頼）に書き換え。
- `config.ts` に `automationProfileDir` を追加（Chrome User Data パス）。`types.ts` に対応する型定義を追加。
- `analyze.ts` から `authStatePath` の組み立てと `writeBrief` への引き渡しを削除。

**Changed files**

- `src/analyzer/brief-builder.ts`
- `src/cli/analyze.ts`
- `src/core/config.ts`
- `src/core/types.ts`

## 2026-03-19

#### 1. analyzer モジュール追加 — 最短経路最適化 & ブリーフ生成 (v0.2.0)

**Issue**

- `pnpm wa analyze <name>` が未実装で、記録データからスキル生成用のブリーフを自動生成できなかった。

**Changes**

- `src/analyzer/shortest-path.ts` を新規作成: 記録されたアクションとリクエストを紐付け、api/ui/skip に分類する最短経路最適化アルゴリズムを実装。連続 input 統合、submit クラスタ統合、テレメトリ除外パターンを含む。
- `src/analyzer/brief-builder.ts` を新規作成: 分類結果から `analysis-brief.md` を生成。playwright-cli リファレンス（`pnpm exec` 必須、`&&` チェーン、`run-code` + `page.evaluate()` パターン）と認証方式別ガイドを含む。
- `src/cli/analyze.ts` を新規作成: `pnpm wa analyze <name>` コマンドの実装。最新タイムスタンプの自動選択、metadata.json フォールバック対応。
- `src/cli/index.ts`: analyze コマンドを `runAnalyze()` に接続。
- `src/cli/record.ts`: `--analyze` フラグで記録後に自動分析を実行する機能を追加。

**Changed files**

- `src/analyzer/shortest-path.ts` (新規)
- `src/analyzer/brief-builder.ts` (新規)
- `src/cli/analyze.ts` (新規)
- `src/cli/index.ts`
- `src/cli/record.ts`

#### 2. レコーダー改善 — 入力値キャプチャ & メタデータ保存

**Issue**

- input/change イベントの入力値が記録されず、スキル生成時にパラメータ化の参考情報がなかった。また、記録の開始・終了時刻と開始URLが個別ファイルとして保存されていなかった。

**Changes**

- `src/recorder/injected-scripts.ts`: input/change イベントハンドラーで `target.value` をキャプチャし、最大500文字に制限して記録。
- `src/recorder/recording-types.ts`: `RecordedAction` に `value?: string` フィールドを追加。
- `src/recorder/session.ts`: 記録停止時に `metadata.json`（startTime, endTime, startUrl）を出力するよう追加。

**Changed files**

- `src/recorder/injected-scripts.ts`
- `src/recorder/recording-types.ts`
- `src/recorder/session.ts`

#### 3. 分析設定 & 型定義の拡充

**Issue**

- 分析に必要な設定（相関ウィンドウ、ゴールメソッド、テレメトリ除外パターン）が未定義だった。

**Changes**

- `src/core/config.ts`: `analysis` セクションを追加。`actionApiCorrelationWindowMs`, `goalMethods`, `goalExcludePatterns`（Adobe Analytics, Google Analytics, Sentry 等のサードパーティ分析サービスを含む）を定義。
- `src/core/types.ts`: `WaConfig.analysis` に `goalExcludePatterns` フィールドを追加。

**Changed files**

- `src/core/config.ts`
- `src/core/types.ts`

#### 4. 依存パッケージ追加 & .gitignore 整備

**Changes**

- `package.json`: `@playwright/cli` と `list` を dependencies に追加。
- `.gitignore`: `.playwright-cli/` と `.mcp.json` を除外対象に追加。

**Changed files**

- `package.json`
- `pnpm-lock.yaml`
- `.gitignore`

#### 5. list コマンド実装 (v0.2.1)

**Changes**

- `src/cli/list.ts` を新規作成。recordings/ 配下のタスクディレクトリを走査し、recorded / briefed / skilled の3段階で状態を判定して一覧表示する。
- `src/cli/index.ts` を更新。list コマンドのスタブを `runList` への委譲に置き換え。

**Changed files**

- src/cli/list.ts
- src/cli/index.ts

#### 6. 進捗ログを docs/ に移動

**Changes**

- `PROGRESS.md` をルートから `docs/progress.md` に移動。
- `.gitignore` を更新: `docs/` 全体の除外を `docs/memo.md` のみの除外に変更し、進捗ログやアーキテクチャドキュメントを Git 追跡対象に含めた。

**Changed files**

- `.gitignore`

#### 7. brief-builder リファクタリング — スキル生成指示の簡素化 & 改善 (v0.2.2)

**Issue**

- `buildPlaywrightCliReference()` 関数（約77行）がインラインで playwright-cli の使い方を記述しており、外部の SKILL.md と二重管理になっていた。また、生成されるスキルに `AskUserQuestion` の使用指示や `run-code` のシングルライン記述ルールが含まれていなかった。

**Changes**

- `buildPlaywrightCliReference()` 関数を削除し、外部ファイル（`.claude/skills/playwright-cli/SKILL.md`）への参照に置換。二重管理を解消。
- スキル生成指示セクションを簡素化: 認証方式別ガイドを3行に集約、フロントマターの注意事項を追加。
- 「ユーザーへの質問」セクションを追加: `AskUserQuestion` ツールの使用を指示。
- 「run-code の記述」セクションを追加: シェル解析エラー防止のためシングルライン記述ルールを明記。

**Changed files**

- `src/analyzer/brief-builder.ts`

## 2026/03/09

#### 1. auth-state.json の認証情報取得を修正 (v0.1.1)

**Issue**

- `pnpm wa record` でログイン操作を記録した後、`auth-state.json` に認証情報（cookies, localStorage）が保存されなかった。原因は Playwright の `context.storageState()` が CDP 接続の default context では空を返す既知の制約。

**Changes**

- `auth-exporter.ts` を全面書き換え: `context.storageState()` を廃止し、Cookie は CDP `Network.getAllCookies`、localStorage は `page.evaluate` で取得する構成に変更。一時ファイル経由でデータを受け渡し（Playwriter の10,000文字制限回避）、警告はホスト側でターミナル出力。
- `recording-types.ts` の `PlaywrightStorageState.cookies` に `partitionKey?: string` と `_crHasCrossSiteAncestor?: boolean` を追加（Partitioned Cookies / CHIPS 対応）。
- `session.ts` の `stop()` メソッドで auth export 失敗時に例外を再送出するよう変更（エラーの握りつぶしを解消）。cleanup（DOM/ネットワークリスナー解除）を `finally` ブロックに移動し、あらゆる失敗パスで cleanup が保証されるよう改善。

**Changed files**

- `src/recorder/auth-exporter.ts`
- `src/recorder/recording-types.ts`
- `src/recorder/session.ts`
