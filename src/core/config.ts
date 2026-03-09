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
  recordingsDir: './recordings',
  skillsDir: './.claude/skills',
};
