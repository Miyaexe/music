# Music Player

YouTube / YouTube Music の曲を再生する、ウェブアプリです。GitHub + Vercel で動きます。

## 機能
- **🎲 ランダム探索**: YouTube上の音楽をランダムに検索して、次々に再生
- **ジャンル絞り込み**: J-POP / アニメ / ボカロ / ロック / ジャズ など(`api/_genres.js` で編集可能)
- 気に入った曲は「♡ 追加」でプレイリストに保存
- YouTube Music / YouTube の曲URL・プレイリストURLを貼り付けて追加
- プレイリストのシャッフル / リピート、前へ / 次へ、曲の終了で自動的に次へ
- プレイリストはブラウザに保存(localStorage)
- 再生できない曲は自動でスキップ

## 仕組み
- 再生は YouTube 公式の IFrame Player API。音声データの抽出・保存は行いません。
- ランダム探索は Vercel の関数(`api/random.js`)が YouTube Data API v3 で
  音楽カテゴリを検索します(ジャンルごとのキーワード × ランダムな年代)。
  埋め込み再生できる 1.5〜10分 の動画だけを返します。

## デプロイ
1. このリポジトリを Vercel にインポート(ビルド設定は不要)
2. [Google Cloud Console](https://console.cloud.google.com/) で **YouTube Data API v3** を有効化し、APIキーを作成
3. Vercel の Project Settings → Environment Variables に `YOUTUBE_API_KEY` を追加して再デプロイ

APIの無料枠は1日10,000ユニットで、ランダム探索1回(最大約50曲)が約101ユニットです。
