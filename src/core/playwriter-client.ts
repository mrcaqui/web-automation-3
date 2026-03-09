import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { config } from './config.js';

export class PlaywriterClient {
  private client: Client | null = null;
  private transport: StdioClientTransport | null = null;

  async connect(): Promise<void> {
    this.transport = new StdioClientTransport({
      command: config.playwriter.serverCommand,
      args: config.playwriter.serverArgs,
      stderr: 'pipe',
    });

    this.client = new Client({
      name: 'web-automation',
      version: '0.1.0',
    });

    await this.client.connect(this.transport);
  }

  async execute(code: string, timeout?: number): Promise<string> {
    if (!this.client) {
      throw new Error('PlaywriterClient is not connected. Call connect() first.');
    }

    const result = await this.client.callTool({
      name: 'execute',
      arguments: {
        code,
        timeout: timeout ?? config.playwriter.timeout,
      },
    });

    if (result.isError) {
      const errorText = Array.isArray(result.content)
        ? result.content.map((c) => ('text' in c ? c.text : '')).join('\n')
        : String(result.content);
      throw new Error(`Playwriter execute error: ${errorText}`);
    }

    const texts = Array.isArray(result.content)
      ? result.content.filter((c): c is { type: 'text'; text: string } => c.type === 'text').map((c) => c.text)
      : [];

    return texts.join('\n');
  }

  async disconnect(): Promise<void> {
    if (this.client) {
      await this.client.close();
      this.client = null;
    }
    if (this.transport) {
      await this.transport.close();
      this.transport = null;
    }
  }

  isConnected(): boolean {
    return this.client !== null;
  }
}

export async function ensurePlaywriterReady(
  client: PlaywriterClient,
  options?: { timeoutMs?: number; intervalMs?: number }
): Promise<{ url: string; title: string }> {
  const timeoutMs = options?.timeoutMs ?? 10000;
  const intervalMs = options?.intervalMs ?? 1000;

  await client.connect();

  const deadline = Date.now() + timeoutMs;
  let lastError: Error | undefined;

  while (Date.now() < deadline) {
    try {
      const remainingMs = deadline - Date.now();
      const attemptTimeout = Math.min(remainingMs, 5000);
      if (attemptTimeout <= 0) break;

      const result = await client.execute(
        `console.log(JSON.stringify({ url: page.url(), title: await page.title() }))`,
        attemptTimeout
      );

      const jsonMatch = result.match(/\[log\]\s*(.+)/s);
      const info = JSON.parse(jsonMatch ? jsonMatch[1] : result);
      return { url: info.url, title: info.title };
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));
      const msg = lastError.message;
      const isTransient = msg.includes('extension is not connected')
        || msg.includes('Extension not connected')
        || msg.includes('No Playwright pages')
        || msg.includes('no browser tabs');
      if (!isTransient) {
        throw lastError;
      }
      await new Promise(resolve => setTimeout(resolve, intervalMs));
    }
  }

  // スタックトレースを除去し、最初の意味のある行だけを残す
  const rawMsg = lastError?.message ?? '';
  const firstLine = rawMsg.split('\n').find(l => l.trim() && !l.trim().startsWith('at ')) ?? rawMsg;
  throw new Error(firstLine.replace(/^Playwriter execute error:\s*/, '').replace(/^Error executing code:\s*/, '').trim()
    || 'Playwriter拡張がタイムアウト内に接続されませんでした。\n'
    + 'ChromeでPlaywriter拡張アイコンをクリックして有効化してから、再度コマンドを実行してください。');
}
