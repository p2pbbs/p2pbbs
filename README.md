# nch

ブラウザ完結のp2p bbs

## 仕組み

- **ゴシッププロトコル** — 投稿はピア間でリレーされネットワーク全体に伝播する
- **WebRTC DataChannel** — ブラウザ間で直接通信。ポート開放不要
- **コンテンツハッシュ + Ed25519 署名** — 投稿の改竄を検知
- **シグナリングサーバー** — 最初のピアを紹介するブートストラップ。接続後のピア発見はゴシップ経由。誰でも立てられる
- **シードノード** — Node.js で動く常駐ピア。他のピアと対等

## 免責

投稿の責任は各投稿者に帰属します。シグナリングサーバーは投稿内容を中継していません。開発者はサービスの運営者ではありません。中央集権的なサービス提供者が存在しないp2p型のツールであることを理解して使用してください。ブラウザを開くと投稿内容の中継が始まります。
p2p化は技術デモが目的であり、違法な投稿を許容することは目的ではありません。

## ステータス

MVP 開発中

## Tech Stack

TypeScript / React / Vite / Tailwind CSS / WebRTC / Vitest / Biome

## Getting Started

```bash
git clone https://github.com/p2pbbs/p2pbbs.git
cd p2pbbs
npm install
npm run signaling:dev
npm run dev
```

## License

AGPL-3.0
