// グローバル設定
export interface WaConfig {
  playwriter: {
    serverCommand: string;    // "playwriter" （コマンド名のみ）
    serverArgs: string[];     // ['serve']
    timeout: number;          // execute のデフォルトタイムアウト (ms)
  };
  recording: {
    networkFilter: {
      excludeExtensions: string[];
      excludePatterns: string[];
    };
    snapshotDebounceMs: number;
    maxResponseSummaryLength: number;
    maxRequestBodyLength: number;
  };
  analysis?: {
    // Milestone 4 で追加する。Milestone 2 の config.ts では省略する
    actionApiCorrelationWindowMs: number;
    goalMethods: string[];
  };
  recordingsDir: string;
  skillsDir: string;
}

// 最短経路最適化の型
export type ActionClassification = 'api' | 'ui' | 'skip';

export interface ClassifiedAction {
  originalIndex: number;
  action: import('../recorder/recording-types.js').RecordedAction;
  classification: ActionClassification;
  skipReason?: string;
  correlatedRequests: import('../recorder/recording-types.js').RecordedRequest[];
  isGoalTrigger: boolean;
}

export interface ShortestPathResult {
  classified: ClassifiedAction[];
  goalRequests: import('../recorder/recording-types.js').RecordedRequest[];
  skippedCount: number;
  uiCount: number;
  apiCount: number;
}
