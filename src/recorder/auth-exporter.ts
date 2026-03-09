import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import { PlaywriterClient } from '../core/playwriter-client.js';
import { PlaywrightStorageState } from './recording-types.js';

export async function exportAuthState(client: PlaywriterClient): Promise<PlaywrightStorageState> {
  const tmpFile = path.join(os.tmpdir(), `__wa_auth_${Date.now()}.json`);
  const escapedPath = JSON.stringify(tmpFile);

  await client.execute(`
    const __fs = require('fs');
    let __cookies = [];
    let __origins = [];
    const __errors = [];

    // Step A: CDP Network.getAllCookies でブラウザの全 Cookie を取得（正式ソース）
    try {
      const cdp = await getCDPSession({ page });
      const result = await cdp.send('Network.getAllCookies');
      __cookies = (result.cookies || []).map(c => ({
        name: c.name,
        value: c.value,
        domain: c.domain,
        path: c.path,
        expires: c.expires,
        httpOnly: c.httpOnly,
        secure: c.secure,
        sameSite: c.sameSite ?? 'Lax',
        ...(c.partitionKey ? {
          partitionKey: typeof c.partitionKey === 'string' ? c.partitionKey : c.partitionKey.topLevelSite,
          _crHasCrossSiteAncestor: typeof c.partitionKey === 'object' ? c.partitionKey.hasCrossSiteAncestor : undefined,
        } : {}),
      }));
    } catch (e) {
      __errors.push('CDP getAllCookies: ' + (e instanceof Error ? e.message : String(e)));
    }

    // CDP 呼び出し自体が失敗した場合はエラーを報告して例外を送出
    // CDP が成功して Cookie が 0 件の場合は正常（localStorage のみで認証するサイト等）
    if (__errors.some(e => e.startsWith('CDP getAllCookies:'))) {
      const msg = '[auth-exporter] CDP call failed. ' + __errors.join('; ');
      console.error(msg);
      throw new Error(msg);
    }

    // Step B: origins（localStorage）を取得 — page.evaluate で現在のオリジンから直接読む
    try {
      const lsData = await page.evaluate(() => {
        try {
          const entries = [];
          for (let i = 0; i < localStorage.length; i++) {
            const key = localStorage.key(i);
            if (key) entries.push({ name: key, value: localStorage.getItem(key) || '' });
          }
          return { origin: location.origin, localStorage: entries, error: null };
        } catch (e) {
          return { origin: location.origin, localStorage: [], error: e instanceof Error ? e.message : String(e) };
        }
      });
      if (lsData.error) {
        __errors.push('localStorage evaluate: ' + lsData.error);
      }
      if (lsData.localStorage.length > 0) {
        __origins = [{ origin: lsData.origin, localStorage: lsData.localStorage }];
      }
    } catch (e) {
      __errors.push('localStorage page.evaluate: ' + (e instanceof Error ? e.message : String(e)));
    }

    __fs.writeFileSync(${escapedPath}, JSON.stringify({
      cookies: __cookies,
      origins: __origins,
      _warnings: __errors.length > 0 ? __errors : undefined,
    }));
  `);

  const raw = JSON.parse(await fs.readFile(tmpFile, 'utf-8'));
  await fs.unlink(tmpFile).catch(() => {});

  // 警告をホスト側でターミナルに出力（VM 内の console.log は client.execute の戻り値にキャプチャされるためターミナルに届かない）
  if (raw._warnings) {
    console.log('[auth-exporter] Warnings:', raw._warnings.join('; '));
  }

  return { cookies: raw.cookies, origins: raw.origins };
}
