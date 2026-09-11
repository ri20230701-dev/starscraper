# starscraper

GitHub のユーザー名を入れると、そのアカウントのリポジトリ群が **夜の 3D 都市**として立ち上がり、
一人称で歩き回れる Web アプリ。バックエンドなし、ブラウザだけで完結します。

> 🚧 WIP — 開発中です。

現在は issue #1 の描画検証用に、固定 100 棟のサンプル都市を表示します。
ドラッグで Orbit、スクロールでズーム、右ドラッグでパン、Save PNG で Bloom を含む画像を保存します。
GitHub 連携・本来の街生成・Walk は後続 issue の範囲です。

## 街の読み方

| リポジトリ | 3D 表現 |
|---|---|
| star 数 | 建物の高さ(log スケール) |
| リポジトリサイズ | 底面積 |
| 主要言語 | 外壁の色(GitHub Linguist 準拠) |
| 最終 push | **窓の点灯率** — 直近なら煌々と、放置されていれば真っ暗 |
| fork | 低層・彩度低め |

放置リポジトリが多いアカウントの街は、ゴーストタウンになります。

## 開発

```bash
npm install
npm run dev
```

```bash
npm test        # 全テスト
npm run typecheck
npx vite build  # issue #1 のバンドル検証
```

既存の `npm run build` は `tests/architecture.test.ts` を要求します。
そのテストは issue #6 で追加予定のため、現段階では上記の個別コマンドを使用します。
描画方式・検証結果・実ブラウザでの未確認項目は [docs/RENDER_VALIDATION.md](docs/RENDER_VALIDATION.md) を参照してください。

## 設計

実装計画と設計判断の記録は [docs/PLAN.md](docs/PLAN.md) にあります。
Codex による敵対的レビューの指摘と、それに対する裁定も同ファイルの §12 に残しています。

4 層(domain / application / infrastructure / presentation)に分離し、
レイヤ間の依存方向を AST ベースのテストで機械的に検証する予定です(issue #6)。
描画ループの所有者は `src/presentation/CityPresenter.ts` です。
現在のテストは窓の実寸計算と固定サンプルの 100 棟・箱メッシュ数を検証します。

## ライセンス

MIT
