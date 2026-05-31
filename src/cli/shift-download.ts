import { existsSync, statSync } from 'node:fs';
import { writeFile } from 'node:fs/promises';

const SHIFT_FILE = '.agents/skills/shift/shift.xlsx';

export async function runShiftDownload(opts: { url?: string }) {
  if (opts.url) {
    try {
      const response = await fetch(opts.url);
      if (!response.ok) {
        throw new Error(`Download failed: ${response.status} ${response.statusText}`);
      }
      const bytes = new Uint8Array(await response.arrayBuffer());
      await writeFile(SHIFT_FILE, bytes);
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
