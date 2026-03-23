import { existsSync, statSync } from 'node:fs';
import { execSync } from 'node:child_process';

const SHIFT_FILE = '.claude/skills/shift/shift.xlsx';

export async function runShiftDownload(opts: { url?: string }) {
  if (opts.url) {
    // Download mode: fetch from the given URL
    try {
      execSync(`curl -sL -o "${SHIFT_FILE}" "${opts.url}"`, {
        stdio: 'inherit',
      });
      const stat = statSync(SHIFT_FILE);
      console.log(
        JSON.stringify({
          status: 'downloaded',
          path: SHIFT_FILE,
          size: stat.size,
          modified: stat.mtime.toISOString(),
        }),
      );
    } catch {
      console.log(JSON.stringify({ status: 'error', message: 'Download failed' }));
      process.exitCode = 1;
    }
    return;
  }

  // Check mode: report existing file status
  if (existsSync(SHIFT_FILE)) {
    const stat = statSync(SHIFT_FILE);
    console.log(
      JSON.stringify({
        status: 'exists',
        path: SHIFT_FILE,
        size: stat.size,
        modified: stat.mtime.toISOString(),
      }),
    );
  } else {
    console.log(JSON.stringify({ status: 'not_found', path: SHIFT_FILE }));
  }
}
