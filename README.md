# starscraper

GitHub のユーザー名を入れると、そのアカウントのリポジトリ群が **夜の 3D 都市**として立ち上がり、
一人称で歩き回れる Web アプリ。バックエンドなし、ブラウザだけで完結します。

```
https://ri20230701-dev.github.io/starscraper/?u=<ユーザー名>
```

URL を貼るだけで、その人の街が開きます。

## 街の読み方

| リポジトリ | 3D 表現 | なぜそうしたか |
|---|---|---|
| star 数 | 建物の高さ | **倍加ごとに一定量伸びる**。star は冪則分布なので、線形だと1棟の超高層と敷石の原っぱになる |
| リポジトリサイズ | 底面積 | 100 MiB で最大幅に達する。早く飽和させると、ほぼ全部が同じ箱になってサイズの情報が消える |
| 主要言語 | 外壁の色 | GitHub Linguist 準拠。取得はせず同梱(未認証の API 枠を食い合わないため) |
| 最終 push | **窓の点灯率** | 1ヶ月以内なら 0.9、1年放置で 0.1、5年で 0.02。**log 空間で補間**する — 効くのは1ヶ月と1年の差であって、3年と4年の差ではない |
| fork | 低層・彩度低め | 形は変えない。高さと窓が意味を運ぶのを邪魔しないため |

放置リポジトリが多いアカウントの街は、ゴーストタウンになります。

配置は**軸整列グリッド + 道路帯**です。黄金角スパイラルは「花」になって街に見えません。
新しく push されたものほど都心に建ちます。

## 操作

- **Orbit**(初期): ドラッグで回転、スクロールでズーム、右ドラッグでパン
- **Walk**: 「Walk the streets」で一人称に。WASD で移動、Shift で走る、**中央の照準**が合った建物の情報が出て Enter で開く、Esc で戻る
- **Save PNG**: 画面と同じ見た目(Bloom 込み)の画像を保存

## 開発

```bash
npm install
npm run dev
```

```bash
npm test        # 全テスト
npm run build   # 型チェック + 全テスト + バンドル
```

## 設計

実装計画と設計判断の記録は [docs/PLAN.md](docs/PLAN.md)、描画の検証記録は
[docs/RENDER_VALIDATION.md](docs/RENDER_VALIDATION.md)、取得層の設計は
[docs/GITHUB_GATEWAY.md](docs/GITHUB_GATEWAY.md) にあります。

4 層(domain / application / infrastructure / presentation)に分離し、
レイヤ規約を **AST ベースのテストで機械的に強制**しています。依存方向だけでなく:

- `three` を import してよいのは `presentation` のみ
- `domain` / `application` は `Date` を名指しできない(別名経由も不可)— 同じデータと同じ基準日時なら同じ街になる契約のため
- `domain` は `Math` のメンバー呼び出しはできるが、`Math` 自体を値として渡せない(`Math.random` の抜け道になるため)
- `requestAnimationFrame` の所有者は `CityPresenter` ただ1つ

検査器は**自分自身をテスト**します(全レイヤ組み合わせ、`globalThis` 経由の別名、コメント内の誤検知)。

各 PR には Claude Code と Codex による**ダブルレビューの記録**と、追加したテストが
実際に回帰を捕まえることを示す**変異テストの結果**が残っています。

## ライセンス

MIT
