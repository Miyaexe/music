// GET /api/random?genre=<id>
// YouTube Data API で音楽(カテゴリ: Music)をランダムに検索し、
// 埋め込み再生できる曲を最大約50件返す。
// 必要な環境変数: YOUTUBE_API_KEY

const GENRES = require("./_genres");

const API = "https://www.googleapis.com/youtube/v3";
const MIN_SEC = 90;   // 短すぎる動画(ショート等)を除外
const MAX_SEC = 600;  // 長すぎる動画(ミックス・ライブ等)を除外

const pick = (a) => a[Math.floor(Math.random() * a.length)];
const shuffle = (a) => {
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
};

function isoToSec(d) {
  const m = /^P(?:(\d+)D)?T?(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?$/.exec(d || "");
  if (!m) return 0;
  return (+m[1] || 0) * 86400 + (+m[2] || 0) * 3600 + (+m[3] || 0) * 60 + (+m[4] || 0);
}

async function yt(path, params, key) {
  const url = `${API}/${path}?${new URLSearchParams({ ...params, key })}`;
  const r = await fetch(url);
  const j = await r.json();
  if (!r.ok) {
    const msg = (j.error && j.error.message) || `YouTube API error ${r.status}`;
    const err = new Error(msg);
    err.status = r.status;
    err.reason = j.error && j.error.errors && j.error.errors[0] && j.error.errors[0].reason;
    throw err;
  }
  return j;
}

async function searchOnce(genre, key) {
  const now = new Date().getUTCFullYear();
  const year = 2009 + Math.floor(Math.random() * (now - 2009 + 1));
  const q = pick(genre.queries);
  const search = await yt("search", {
    part: "snippet",
    type: "video",
    videoCategoryId: "10",
    videoEmbeddable: "true",
    videoSyndicated: "true",
    maxResults: "50",
    q,
    order: pick(["viewCount", "viewCount", "relevance"]),
    publishedAfter: `${year}-01-01T00:00:00Z`,
    publishedBefore: `${year + 1}-01-01T00:00:00Z`,
  }, key);

  const ids = (search.items || []).map((i) => i.id && i.id.videoId).filter(Boolean);
  if (!ids.length) return [];

  const vids = await yt("videos", {
    part: "snippet,contentDetails,status",
    id: ids.join(","),
    maxResults: "50",
  }, key);

  return (vids.items || [])
    .filter((v) => {
      const sec = isoToSec(v.contentDetails && v.contentDetails.duration);
      return v.status && v.status.embeddable && sec >= MIN_SEC && sec <= MAX_SEC;
    })
    .map((v) => ({
      id: v.id,
      title: v.snippet.title,
      author: (v.snippet.channelTitle || "").replace(/ - Topic$/, ""),
      genre: genre.label,
    }));
}

module.exports = async (req, res) => {
  res.setHeader("Cache-Control", "no-store");
  const key = process.env.YOUTUBE_API_KEY;
  if (!key) {
    return res.status(500).json({ error: "サーバーに YOUTUBE_API_KEY が設定されていません" });
  }

  const wanted = req.query && req.query.genre;
  const fixed = wanted ? GENRES.find((g) => g.id === wanted) : null;
  if (wanted && !fixed) return res.status(400).json({ error: "不明なジャンルです" });

  try {
    // 条件に合う曲が0件のときは、ジャンル・年代を変えて数回やり直す
    for (let attempt = 0; attempt < 4; attempt++) {
      const genre = fixed || pick(GENRES);
      const tracks = await searchOnce(genre, key);
      if (tracks.length) {
        return res.status(200).json({ tracks: shuffle(tracks) });
      }
    }
    return res.status(200).json({ tracks: [] });
  } catch (e) {
    const quota = e.reason === "quotaExceeded" || e.reason === "dailyLimitExceeded";
    return res.status(quota ? 429 : 502).json({
      error: quota ? "YouTube APIの本日の利用上限に達しました" : e.message,
    });
  }
};
