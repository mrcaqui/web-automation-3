import { RecordedAction, RecordedRequest } from '../recorder/recording-types.js';
import { ClassifiedAction, ShortestPathResult } from '../core/types.js';

/**
 * 記録されたアクションを最短経路最適化で分類する。
 *
 * 既知の制約:
 * - windowMs を超える遅延 API レスポンスは紐付けに失敗し、トリガーの click が ui に誤分類される可能性がある
 * - 分類結果は Claude Code へのヒントであり、最終判断ではない（元計画書 L889 参照）
 * - レコーダーの networkFilter.excludePatterns が記録時点でリクエストを除外するため、
 *   分析の goalExcludePatterns より先にデータが失われる場合がある
 */
export function classifyActions(
  actions: RecordedAction[],
  requests: RecordedRequest[],
  windowMs: number,
  goalMethods: string[],
  goalExcludePatterns: string[],
): ShortestPathResult {
  // --- 0. 連続 input イベントの統合（前処理）---
  const indexed = actions.map((a, i) => ({ ...a, _originalIndex: i }));
  const merged = mergeConsecutiveInputs(indexed);
  const mergedCount = indexed.length - merged.length;
  if (mergedCount > 0) {
    console.log(`  連続 input を統合: ${indexed.length} → ${merged.length} アクション (${mergedCount} 件統合)`);
  }

  // --- 1. nearest-action 割り当て ---
  const correlationMap = new Map<number, RecordedRequest[]>();
  for (let i = 0; i < merged.length; i++) {
    correlationMap.set(i, []);
  }

  // アクションタイプの優先度（タイブレーク用）
  const typePriority: Record<string, number> = { click: 0, keypress: 1, change: 2, input: 3 };

  for (const req of requests) {
    let bestIdx = -1;
    let bestDiff = Infinity;
    let bestTypePrio = Infinity;

    for (let i = 0; i < merged.length; i++) {
      const action = merged[i];
      if (action.timestamp > req.timestamp) continue; // 因果関係: アクションはリクエストより前
      const diff = req.timestamp - action.timestamp;
      if (diff > windowMs) continue;

      const prio = typePriority[action.type] ?? 99;
      if (diff < bestDiff || (diff === bestDiff && prio < bestTypePrio)) {
        bestIdx = i;
        bestDiff = diff;
        bestTypePrio = prio;
      }
    }

    if (bestIdx >= 0) {
      correlationMap.get(bestIdx)!.push(req);
    }
  }

  // --- 2-3. 分類 ---
  const goalMethodSet = new Set(goalMethods.map(m => m.toUpperCase()));
  const classified: ClassifiedAction[] = merged.map((action, idx) => {
    const correlated = correlationMap.get(idx) || [];

    // meaningfulRequests vs excludedRequests
    const meaningfulRequests: RecordedRequest[] = [];
    const excludedRequests: RecordedRequest[] = [];
    for (const r of correlated) {
      if (isExcludedByPatterns(r.url, goalExcludePatterns)) {
        excludedRequests.push(r);
      } else {
        meaningfulRequests.push(r);
      }
    }

    // goal 候補 = meaningfulRequests のうち goalMethods に該当するもの
    const goalCandidates = meaningfulRequests.filter(r => goalMethodSet.has(r.method.toUpperCase()));

    let classification: 'api' | 'ui' | 'skip';
    let isGoalTrigger = false;

    if (goalCandidates.length > 0) {
      // goal リクエストの認証タイプを確認
      const hasNonCookieAuth = goalCandidates.some(
        r => r.authInfo && r.authInfo.type !== 'cookie' && r.authInfo.type !== 'none',
      );
      if (hasNonCookieAuth) {
        // bearer/basic/csrf → ui に分類し、リクエスト詳細を併記
        classification = 'ui';
      } else {
        classification = 'api';
      }
      isGoalTrigger = true;
    } else if (meaningfulRequests.length > 0) {
      // GET のみ等
      classification = 'ui';
    } else if (excludedRequests.length > 0) {
      // テレメトリのみ
      if (action.type === 'input' || action.type === 'change' || action.type === 'keypress') {
        classification = 'ui'; // フォーム入力は省略不可
      } else {
        classification = 'ui'; // click もデフォルト ui（画面遷移の可能性）
      }
    } else {
      // correlatedRequests ゼロ
      if (action.type === 'input' || action.type === 'change' || action.type === 'keypress') {
        classification = 'ui'; // フォーム入力は省略不可
      } else {
        classification = 'ui'; // リクエストなし click もデフォルト ui
      }
    }

    return {
      originalIndex: action._originalIndex,
      action: stripOriginalIndex(action),
      classification,
      correlatedRequests: correlated,
      isGoalTrigger,
    };
  });

  // --- 4. submit クラスタの統合（後処理）---
  applySubmitClusterMerge(classified);

  // --- 5. goalRequests 重複排除 ---
  const goalRequestSet = new Set<string>();
  const goalRequests: RecordedRequest[] = [];
  for (const c of classified) {
    if (!c.isGoalTrigger) continue;
    for (const r of c.correlatedRequests) {
      if (!goalMethodSet.has(r.method.toUpperCase())) continue;
      if (isExcludedByPatterns(r.url, goalExcludePatterns)) continue;
      const key = `${r.url}|${r.method}|${r.timestamp}`;
      if (!goalRequestSet.has(key)) {
        goalRequestSet.add(key);
        goalRequests.push(r);
      }
    }
  }

  // --- 6. カウント ---
  let skippedCount = 0;
  let uiCount = 0;
  let apiCount = 0;
  for (const c of classified) {
    if (c.classification === 'skip') skippedCount++;
    else if (c.classification === 'ui') uiCount++;
    else if (c.classification === 'api') apiCount++;
  }

  return { classified, goalRequests, skippedCount, uiCount, apiCount };
}

// --- ヘルパー関数 ---

type IndexedAction = RecordedAction & { _originalIndex: number };

function mergeConsecutiveInputs(actions: IndexedAction[]): IndexedAction[] {
  if (actions.length === 0) return [];
  const result: IndexedAction[] = [];
  let i = 0;

  while (i < actions.length) {
    if (actions[i].type !== 'input') {
      result.push(actions[i]);
      i++;
      continue;
    }

    // input イベントの連続を検出
    const key = getMergeKey(actions[i]);
    if (key === null) {
      // id と name が両方空 → マージしない
      result.push(actions[i]);
      i++;
      continue;
    }

    let j = i + 1;
    while (j < actions.length && actions[j].type === 'input') {
      const nextKey = getMergeKey(actions[j]);
      if (nextKey === null || nextKey !== key) break;
      j++;
    }

    // i..j-1 が同一要素への連続 input → 最後の1つ（完成した入力値を持つ）を採用
    result.push(actions[j - 1]);
    i = j;
  }

  return result;
}

function getMergeKey(action: IndexedAction): string | null {
  const el = action.element;
  // id と name が両方空の場合はマージしない
  if (!el.id && !el.name) return null;
  return `${action.pageUrl}|${el.id}|${el.name}|${el.tag}|${el.role}|${el.ariaLabel}|${el.context}`;
}

function isExcludedByPatterns(url: string, patterns: string[]): boolean {
  const lower = url.toLowerCase();
  return patterns.some(p => lower.includes(p.toLowerCase()));
}

function stripOriginalIndex(action: IndexedAction): RecordedAction {
  const { _originalIndex, ...rest } = action;
  return rest;
}

function applySubmitClusterMerge(classified: ClassifiedAction[]): void {
  const CLUSTER_WINDOW_MS = 50;

  // アクションタイプの優先度（代表選択用）
  const typePriority: Record<string, number> = { click: 0, keypress: 1, change: 2, input: 3 };

  let i = 0;
  while (i < classified.length) {
    // クラスタの開始
    let j = i + 1;
    while (j < classified.length) {
      const diff = classified[j].action.timestamp - classified[i].action.timestamp;
      if (diff > CLUSTER_WINDOW_MS) break;
      if (classified[j].action.pageUrl !== classified[i].action.pageUrl) break;
      j++;
    }

    // i..j-1 がクラスタ
    if (j - i <= 1) {
      i = j;
      continue;
    }

    // クラスタ内に api または isGoalTrigger がある場合のみ統合
    const cluster = classified.slice(i, j);
    const hasGoal = cluster.some(c => c.classification === 'api' || c.isGoalTrigger);
    if (!hasGoal) {
      i = j;
      continue;
    }

    // 代表アクションを選択
    let bestIdx = i;
    for (let k = i; k < j; k++) {
      if (isBetterRepresentative(classified[k], classified[bestIdx])) {
        bestIdx = k;
      }
    }

    // 代表以外の冗長イベントを skip に変更
    for (let k = i; k < j; k++) {
      if (k === bestIdx) continue;
      if (classified[k].correlatedRequests.length === 0) {
        classified[k].classification = 'skip';
        classified[k].skipReason = '同一 submit クラスタ内の冗長イベント';
      }
    }

    i = j;
  }

  function isBetterRepresentative(a: ClassifiedAction, b: ClassifiedAction): boolean {
    // api > isGoalTrigger の ui > correlatedRequests あり
    const aScore = classificationScore(a);
    const bScore = classificationScore(b);
    if (aScore !== bScore) return aScore > bScore;
    // 同スコアならアクションタイプで比較
    const aPrio = typePriority[a.action.type] ?? 99;
    const bPrio = typePriority[b.action.type] ?? 99;
    return aPrio < bPrio;
  }

  function classificationScore(c: ClassifiedAction): number {
    if (c.classification === 'api') return 3;
    if (c.isGoalTrigger) return 2;
    if (c.correlatedRequests.length > 0) return 1;
    return 0;
  }
}
