#!/usr/bin/env node
import { Command } from 'commander';
import { runStatus } from './status.js';
import { runRecord } from './record.js';

const program = new Command();
program
  .name('wa')
  .description('Web Automation V2 - ブラウザ操作の記録・分析・自動化');

program.command('record <name>')
  .description('ブラウザ操作を記録する')
  .option('--url <url>', 'ナビゲーション先URL')
  .option('--analyze', '記録完了後に自動で分析を実行する')
  .action(runRecord);

program.command('analyze <name>')
  .description('記録を分析しanalysis-brief.mdを生成する（スキル生成はClaude Codeが担当）')
  .action(() => console.log('Not implemented yet'));

program.command('list')
  .description('記録・スキル一覧を表示する')
  .action(() => console.log('Not implemented yet'));

program.command('status')
  .description('Playwriter接続状態を確認する')
  .action(runStatus);

program.parseAsync().then(() => process.exit(process.exitCode ?? 0)).catch(() => process.exit(1));
