# nch

ブラウザ完結のp2p bbs

## 仕組み

- **ゴシッププロトコル** — 投稿はピア間でリレーされネットワーク全体に伝播する
- **WebRTC DataChannel** — ブラウザ間で直接通信。ポート開放不要
- **コンテンツハッシュ + Ed25519 署名** — 投稿の改竄を検知
- **シグナリングサーバー** — 最初のピアを紹介するブートストラップ。接続後のピア発見はゴシップ経由。誰でも立てられる
- **シードノード** — Node.js で動く常駐ピア。他のピアと対等

## 背景

2026年3月、米レジストラの判断で 5ch.net のドメインが剥奪され掲示板が一時停止した。
単一障害点を持たない掲示板が P2P で成立するかの技術実証。

なお、p2p化は違法な投稿を許容する目的ではなく、純粋な技術デモを目的としています。

## ステータス

MVP 開発中

## Tech Stack

TypeScript / React 19 / Vite / Tailwind CSS / WebRTC / Vitest / Biome

## Getting Started

```bash
git clone https://github.com/yourname/nch.git
cd nch
npm install
npm run dev
```

## License

AGPL-3.0
