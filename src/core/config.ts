import path from 'path';
import os from 'os';
import { WaConfig } from './types.js';

export const config: WaConfig = {
  playwriter: {
    serverCommand: 'playwriter',
    serverArgs: [],
    timeout: 30000,
  },
  recording: {
    networkFilter: {
      excludeExtensions: ['.js', '.css', '.png', '.jpg', '.gif', '.svg', '.woff', '.woff2'],
      excludePatterns: ['telemetry', 'analytics', 'tracking'],
    },
    snapshotDebounceMs: 500,
    maxResponseSummaryLength: 200,
    maxRequestBodyLength: 500,
  },
  analysis: {
    actionApiCorrelationWindowMs: 1000,
    goalMethods: ['POST', 'PATCH', 'PUT', 'DELETE'],
    goalExcludePatterns: [
      // 汎用テレメトリパス
      '/telemetry', '/analytics/', '/tracking/', '/metrics/', '/clientmetrics',
      '/gen_204', '/beacon', '/heartbeat',
      // サードパーティ分析サービス
      '.2o7.net/',           // Adobe Analytics
      'google-analytics',    // Google Analytics
      '.amplitude.com/',     // Amplitude
      '.mixpanel.com/',      // Mixpanel
      '.segment.io/',        // Segment
      '.sentry.io/',         // Sentry
      '.pendo.io/',          // Pendo
      'capig.stape.jp/',     // サーバーサイドタグ
    ],
  },
  automationProfileDir: path.join(
    os.homedir(), 'AppData', 'Local', 'Google', 'Chrome', 'User Data', 'AutomationProfile'
  ),
  recordingsDir: './recordings',
  skillsDir: './.claude/skills',
};
