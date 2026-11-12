# Music Player

YouTube / YouTube Music の曲を再生する、静的ウェブアプリです。GitHub + Vercel でそのまま動きます。

## 機能
- YouTube Music / YouTube の曲URL・プレイリストURLを追加して再生
- ランダム再生(一巡するまで同じ曲が重複しない)
- 前へ / 次へ / リピート、曲の終了で自動的に次の曲へ
- プレイリストはブラウザに保存(localStorage)
- 再生できない曲は自動でスキップ

## 仕組み
音声データの抽出・保存は行わず、YouTube公式の IFrame Player API で再生します。

## デプロイ
1. このリポジトリをGitHubにプッシュ
2. Vercelで「Add New → Project」からこのリポジトリをインポート(設定変更なしでOK)
