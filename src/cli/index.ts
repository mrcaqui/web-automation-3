#!/usr/bin/env node
import { Command } from 'commander';
import { runStatus } from './status.js';
import { runRecord } from './record.js';
import { runAnalyze } from './analyze.js';
import { runList } from './list.js';
import { runShiftExcel } from './shift-excel.js';

const program = new Command();
program
  .name('wa')
  .description('Web Automation V2 - ブラウザ操作の記録・分析・自動化');

program.command('record <name>')
  .description('ブラウザ操作を記録する')
  .option('--url <url>', 'ナビゲーション先URL')
  .option('--analyze', '記録完了後に自動で分析を実行する')
  .option('--tag <tag>', '記録にタグを付ける')
  .action(runRecord);

program.command('analyze <name>')
  .description('記録を分析しanalysis-brief.mdを生成する（スキル生成はClaude Codeが担当）')
  .option('--tag <tag>', 'タグで記録を絞り込む')
  .option('--dir <dir>', '記録ディレクトリ名を直接指定する')
  .action((name, opts) => runAnalyze(name, undefined, opts));

program.command('list')
  .description('記録・スキル一覧を表示する')
  .action(runList);

program.command('status')
  .description('Playwriter接続状態を確認する')
  .action(runStatus);

program.command('shift-excel <sheet> <member>')
  .description('シフト表 Excel を解析し、メンバーの上段行・下段行の値を JSON で出力する')
  .option('--file <path>', 'Excel ファイルパス', '.claude/skills/shift/shift.xlsx')
  .action((sheet, member, opts) => runShiftExcel(sheet, member, opts));

program.parseAsync().then(() => process.exit(process.exitCode ?? 0)).catch(() => process.exit(1));
