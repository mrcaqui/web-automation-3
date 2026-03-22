import * as fs from 'node:fs';
import * as path from 'node:path';
import { config } from '../core/config.js';

interface TaskInfo {
  name: string;
  recorded: boolean;
  briefed: boolean;
  skilled: boolean;
  lastRecordedAt: Date | null;
  lastBriefedAt: Date | null;
}

function isTimestampDir(name: string): boolean {
  // タイムスタンプ形式: YYYYMMDD-HHmmss またはタグ付き tag-YYYYMMDD-HHmmss
  return /^(?:[A-Za-z0-9_-]+-)?(\d{8}-\d{6})$/.test(name);
}

function scanTasks(): TaskInfo[] {
  const recordingsDir = path.resolve(config.recordingsDir);
  const skillsDir = path.resolve(config.skillsDir);

  if (!fs.existsSync(recordingsDir)) {
    return [];
  }

  const taskDirs = fs.readdirSync(recordingsDir, { withFileTypes: true })
    .filter(d => d.isDirectory() && d.name !== 'latest');

  const tasks: TaskInfo[] = [];

  for (const taskDir of taskDirs) {
    const taskPath = path.join(recordingsDir, taskDir.name);
    const timestampDirs = fs.readdirSync(taskPath, { withFileTypes: true })
      .filter(d => d.isDirectory() && isTimestampDir(d.name))
      .map(d => d.name)
      .sort((a, b) => {
        const ta = parseTimestamp(a) ?? new Date(0);
        const tb = parseTimestamp(b) ?? new Date(0);
        return ta.getTime() - tb.getTime();
      });

    if (timestampDirs.length === 0) continue;

    const latestTimestamp = timestampDirs[timestampDirs.length - 1];
    const latestDir = path.join(taskPath, latestTimestamp);

    // recorded: タイムスタンプディレクトリが存在する
    const recorded = true;

    // briefed: analysis-brief.md が存在する
    const briefPath = path.join(latestDir, 'analysis-brief.md');
    const briefed = fs.existsSync(briefPath);

    // skilled: .claude/skills/<name>/SKILL.md が存在する
    const skillPath = path.join(skillsDir, taskDir.name, 'SKILL.md');
    const skilled = fs.existsSync(skillPath);

    // 最終記録日時（タイムスタンプディレクトリ名からパース）
    const lastRecordedAt = parseTimestamp(latestTimestamp);

    // analysis-brief.md の更新日時
    let lastBriefedAt: Date | null = null;
    if (briefed) {
      lastBriefedAt = fs.statSync(briefPath).mtime;
    }

    tasks.push({
      name: taskDir.name,
      recorded,
      briefed,
      skilled,
      lastRecordedAt,
      lastBriefedAt,
    });
  }

  // 最終記録日時の降順でソート
  tasks.sort((a, b) => {
    const ta = a.lastRecordedAt?.getTime() ?? 0;
    const tb = b.lastRecordedAt?.getTime() ?? 0;
    return tb - ta;
  });

  return tasks;
}

function parseTimestamp(ts: string): Date | null {
  // tag-YYYYMMDD-HHmmss or YYYYMMDD-HHmmss → Date
  const match = ts.match(/^(?:[A-Za-z0-9_-]+-)?(\d{4})(\d{2})(\d{2})-(\d{2})(\d{2})(\d{2})$/);
  if (!match) return null;
  const [, y, mo, d, h, mi, s] = match;
  return new Date(+y, +mo - 1, +d, +h, +mi, +s);
}

function formatDate(date: Date | null): string {
  if (!date) return '不明';
  const y = date.getFullYear();
  const mo = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  const h = String(date.getHours()).padStart(2, '0');
  const mi = String(date.getMinutes()).padStart(2, '0');
  return `${y}-${mo}-${d} ${h}:${mi}`;
}

function formatTask(task: TaskInfo): string {
  const flags: string[] = [];
  if (task.recorded) flags.push('[recorded]');
  if (task.briefed) flags.push('[briefed]');
  if (task.skilled) flags.push('[skilled]');

  const icon = task.skilled ? '●' : '○';
  const flagStr = flags.join('');
  const dateStr = `最終記録: ${formatDate(task.lastRecordedAt)}`;

  let note = '';
  if (!task.briefed) {
    note = '  （ブリーフ未生成）';
  } else if (!task.skilled) {
    note = '  （スキル未生成）';
  }

  return `  ${icon} ${task.name}  ${flagStr}  ${dateStr}${note}`;
}

export async function runList(): Promise<void> {
  const tasks = scanTasks();

  if (tasks.length === 0) {
    console.log('記録されたタスクはありません。');
    console.log('  pnpm wa record <name> --url <url> で記録を開始してください。');
    return;
  }

  console.log('タスク一覧:');
  for (const task of tasks) {
    console.log(formatTask(task));
  }
}
