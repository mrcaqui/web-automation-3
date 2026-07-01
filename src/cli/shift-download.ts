import { existsSync, statSync } from 'node:fs';
import { writeFile } from 'node:fs/promises';
import { DEFAULT_SHIFT_FILE } from './shift-path.js';

export async function runShiftDownload(opts: { url?: string }) {
  if (opts.url) {
    try {
      const response = await fetch(opts.url);
      if (!response.ok) {
        throw new Error(`Download failed: ${response.status} ${response.statusText}`);
      }
      const bytes = new Uint8Array(await response.arrayBuffer());
      await writeFile(DEFAULT_SHIFT_FILE, bytes);
      const stat = statSync(DEFAULT_SHIFT_FILE);
      console.log(
        JSON.stringify({
          status: 'downloaded',
          path: DEFAULT_SHIFT_FILE,
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
  if (existsSync(DEFAULT_SHIFT_FILE)) {
    const stat = statSync(DEFAULT_SHIFT_FILE);
    console.log(
      JSON.stringify({
        status: 'exists',
        path: DEFAULT_SHIFT_FILE,
        size: stat.size,
        modified: stat.mtime.toISOString(),
      }),
    );
  } else {
    console.log(JSON.stringify({ status: 'not_found', path: DEFAULT_SHIFT_FILE }));
  }
}
