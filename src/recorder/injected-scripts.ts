import { config } from '../core/config.js';

/**
 * アクション記録スクリプトを生成する。
 * Playwriter execute 内で実行され、page.exposeFunction + page.evaluate で
 * ブラウザ側のイベントリスナーを注入する。
 */
export function getActionRecorderScript(): string {
  const debounceMs = config.recording.snapshotDebounceMs;

  return `
    // --- アクション記録: Node側ハンドラ登録 ---
    if (!state.__waRecordActionBound) {
      try {
        await page.exposeFunction('__waRecordAction', async (actionData) => {
          state.actions.push(actionData);
          // デバウンスタイマー: 操作後にスナップショットを取得
          if (state.__waSnapshotTimer) clearTimeout(state.__waSnapshotTimer);
          state.__waSnapshotTimer = setTimeout(async () => {
            try {
              const snap = await accessibilitySnapshot({ page });
              state.snapshots.push({
                timestamp: Date.now(),
                actionIndex: state.actions.length - 1,
                pageUrl: page.url(),
                content: snap,
              });
            } catch (e) {
              // スナップショット失敗は無視（ページ遷移中など）
            }
            state.__waSnapshotTimer = null;
          }, ${debounceMs});
        });
      } catch (e) {
        // 二重登録エラーは無視
      }
      state.__waRecordActionBound = true;
    }

    // --- アクション記録: ブラウザ側イベントリスナー注入 ---
    const __waInjectDomListeners = async () => {
      await page.evaluate(() => {
        if (window.__waListenersAttached) return;
        window.__waListenersAttached = true;

        function getElementInfo(el) {
          var text = (el.textContent || '').trim().slice(0, 100);
          var tag = el.tagName.toLowerCase();
          var id = el.id || '';
          var name = el.getAttribute('name') || '';
          var role = el.getAttribute('role') || el.tagName.toLowerCase();
          var ariaLabel = el.getAttribute('aria-label') || '';
          var contextEl = el.closest('[aria-label], [role], nav, form, section, header, footer, main');
          var context = contextEl && contextEl !== el
            ? (contextEl.getAttribute('aria-label') || contextEl.getAttribute('role') || contextEl.tagName.toLowerCase())
            : '';

          return { tag: tag, text: text, id: id, name: name, role: role, ariaLabel: ariaLabel, context: context };
        }

        window.__waHandlers = {};

        window.__waHandlers.click = function(e) {
          var target = e.target;
          if (!target) return;
          window.__waRecordAction({
            timestamp: Date.now(),
            type: 'click',
            pageUrl: location.href,
            element: getElementInfo(target),
          });
        };
        document.addEventListener('click', window.__waHandlers.click, true);

        window.__waHandlers.change = function(e) {
          var target = e.target;
          if (!target) return;
          window.__waRecordAction({
            timestamp: Date.now(),
            type: 'change',
            pageUrl: location.href,
            element: getElementInfo(target),
          });
        };
        document.addEventListener('change', window.__waHandlers.change, true);

        window.__waHandlers.input = function(e) {
          var target = e.target;
          if (!target) return;
          window.__waRecordAction({
            timestamp: Date.now(),
            type: 'input',
            pageUrl: location.href,
            element: getElementInfo(target),
          });
        };
        document.addEventListener('input', window.__waHandlers.input, true);

        window.__waHandlers.keypress = function(e) {
          var target = e.target;
          if (!target) return;
          if (e.key !== 'Enter') return;
          window.__waRecordAction({
            timestamp: Date.now(),
            type: 'keypress',
            pageUrl: location.href,
            element: getElementInfo(target),
          });
        };
        document.addEventListener('keypress', window.__waHandlers.keypress, true);
      });
    };

    await __waInjectDomListeners();

    // --- ナビゲーション後にDOMリスナーを再注入 ---
    if (!state.__waFrameNavigatedBound) {
      state.__waFrameNavigatedHandler = async (frame) => {
        if (frame !== page.mainFrame()) return;
        try {
          await __waInjectDomListeners();
        } catch (e) {
          // ナビゲーション中のタイミングエラーを無視
        }
      };
      page.on('framenavigated', state.__waFrameNavigatedHandler);
      state.__waFrameNavigatedBound = true;
    }
  `;
}

/**
 * ネットワーク記録スクリプトを生成する。
 * page.on('request'/'response') でAPIリクエストを監視し、state に蓄積する。
 */
export function getNetworkRecorderScript(): string {
  const excludeExts = JSON.stringify(config.recording.networkFilter.excludeExtensions);
  const excludePatterns = JSON.stringify(config.recording.networkFilter.excludePatterns);
  const maxResponseLen = config.recording.maxResponseSummaryLength;
  const maxRequestBodyLen = config.recording.maxRequestBodyLength;

  return `
    // --- ネットワーク記録: ハンドラ登録 ---
    const excludeExts = ${excludeExts};
    const excludePatterns = ${excludePatterns};

    function shouldExclude(url) {
      const lower = url.toLowerCase();
      if (excludeExts.some(ext => lower.includes(ext))) return true;
      if (excludePatterns.some(pat => lower.includes(pat))) return true;
      return false;
    }

    state.__waRequestHandler = (request) => {
      const url = request.url();
      if (shouldExclude(url)) return;

      const method = request.method();
      let requestBody = undefined;
      let contentType = undefined;
      try {
        requestBody = request.postData();
        if (requestBody && requestBody.length > ${maxRequestBodyLen}) {
          requestBody = requestBody.slice(0, ${maxRequestBodyLen}) + '...(truncated)';
        }
        contentType = request.headers()['content-type'] || undefined;
      } catch (e) {}

      // authInfo の検出
      const headers = request.headers();
      let authType = 'none';
      let csrfTokenSource = undefined;
      if (headers['authorization']?.startsWith('Bearer ')) authType = 'bearer';
      else if (headers['authorization']?.startsWith('Basic ')) authType = 'basic';
      else if (headers['cookie']) authType = 'cookie';
      // CSRF トークンの検出
      const csrfHeaders = ['x-csrf-token', 'x-xsrf-token', 'csrf-token'];
      for (const h of csrfHeaders) {
        if (headers[h]) {
          authType = 'csrf';
          csrfTokenSource = h;
          break;
        }
      }

      state.requests.push({
        timestamp: Date.now(),
        method,
        url,
        requestBody,
        contentType,
        authInfo: { type: authType, csrfTokenSource },
      });
    };

    state.__waResponseHandler = async (response) => {
      const url = response.url();
      if (shouldExclude(url)) return;

      // 対応する request エントリを探して更新
      const entry = [...state.requests].reverse().find(r => r.url === url && !r.responseStatus);
      if (!entry) return;

      entry.responseStatus = response.status();
      entry.responseContentType = response.headers()['content-type'] || undefined;
      try {
        const body = await response.text();
        entry.responseSummary = body.length > ${maxResponseLen}
          ? body.slice(0, ${maxResponseLen}) + '...(truncated)'
          : body;
      } catch (e) {
        entry.responseSummary = '(response body unavailable)';
      }
    };

    page.on('request', state.__waRequestHandler);
    page.on('response', state.__waResponseHandler);
  `;
}

/**
 * スナップショット取得スクリプトを生成する。
 */
export function getSnapshotScript(): string {
  return `
    const snap = await accessibilitySnapshot({ page });
    console.log(JSON.stringify(snap));
  `;
}

/**
 * デバウンスタイマーをフラッシュし、未取得のスナップショットを強制取得する。
 */
export function getFlushSnapshotScript(): string {
  return `
    if (state.__waSnapshotTimer) {
      clearTimeout(state.__waSnapshotTimer);
      state.__waSnapshotTimer = null;
      const snap = await accessibilitySnapshot({ page });
      state.snapshots.push({
        timestamp: Date.now(),
        actionIndex: state.actions.length - 1,
        pageUrl: page.url(),
        content: snap,
      });
    }
  `;
}

/**
 * 最終スナップショットを取得して state.snapshots に追加するスクリプト。
 */
export function getFinalSnapshotScript(): string {
  return `
    const snap = await accessibilitySnapshot({ page });
    state.snapshots.push({
      timestamp: Date.now(),
      actionIndex: state.actions.length - 1,
      pageUrl: page.url(),
      content: snap,
    });
  `;
}

/**
 * state から全データを回収するスクリプト。
 * Playwriter の出力は10000文字で切り詰められるため、ファイル経由で受け渡す。
 */
export function getCollectDataScript(tmpFilePath: string): string {
  const escaped = JSON.stringify(tmpFilePath);
  return `
    const __fs = require('fs');
    __fs.writeFileSync(${escaped}, JSON.stringify({
      actions: state.actions || [],
      requests: state.requests || [],
      snapshots: state.snapshots || [],
    }));
    console.log('__wa_collected_ok');
  `;
}

/**
 * ネットワークリスナーを解除するスクリプト。
 */
export function getCleanupNetworkScript(): string {
  return `
    if (state.__waRequestHandler) {
      page.off('request', state.__waRequestHandler);
      page.off('response', state.__waResponseHandler);
      state.__waRequestHandler = null;
      state.__waResponseHandler = null;
    }
  `;
}

/**
 * ブラウザ側のDOMリスナーを解除するスクリプト。
 */
export function getCleanupDomScript(): string {
  return `
    await page.evaluate(() => {
      if (window.__waHandlers) {
        document.removeEventListener('click', window.__waHandlers.click, true);
        document.removeEventListener('change', window.__waHandlers.change, true);
        document.removeEventListener('input', window.__waHandlers.input, true);
        document.removeEventListener('keypress', window.__waHandlers.keypress, true);
        delete window.__waHandlers;
      }
      window.__waListenersAttached = false;
    });
    // framenavigated ハンドラを解除
    if (state.__waFrameNavigatedHandler) {
      page.off('framenavigated', state.__waFrameNavigatedHandler);
      state.__waFrameNavigatedHandler = null;
      state.__waFrameNavigatedBound = false;
    }
    state.__waRecordActionBound = false;
  `;
}

/**
 * state をリセットするスクリプト。
 */
export function getResetStateScript(): string {
  return `
    state.actions = [];
    state.requests = [];
    state.snapshots = [];
    state.__waRecordActionBound = false;
    state.__waSnapshotTimer = null;
    state.__waRequestHandler = null;
    state.__waResponseHandler = null;
    state.__waFrameNavigatedBound = false;
    state.__waFrameNavigatedHandler = null;
  `;
}
