# パッケージマネージャ
pnpm を使用。npx ではなく `pnpm exec` を使うこと。

# モジュール形式
ESM（`"type": "module"`）。import パスには `.js` 拡張子を付けること。

# CLI
`pnpm wa <command>` で実行（tsx 経由）。

# 社内情報の取り扱い

GitHub にも push されるファイル（`src/`, `docs/`, `CLAUDE.md`, `package.json` 等）には、社内情報を記載しないこと。
`.gitattributes` で `export-ignore` が設定されているファイル（`.claude/`, `plans/`, `recordings/` 等）は GitLab のみに保存されるため制約なし。

- 社名、社内 URL、社内システム名、社員名、プロジェクト固有の ID やトークンなどを GitHub 公開ファイルに書かない
- 文脈上どうしても必要な場合は、固有値をマスク（`<company-url>`, `example.com` 等）するか汎用的な表現に置き換える
