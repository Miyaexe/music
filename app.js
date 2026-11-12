// YouTube Music の曲を YouTube IFrame Player API で再生するプレイヤー。
// 音声データを抽出・保存せず、公式の埋め込みプレイヤー経由で再生する。
//
// 2つの再生モード:
//  - ランダム探索: /api/random でYouTube上の音楽をジャンル別にランダム検索して再生
//  - プレイリスト: 自分で追加した曲を順番 or シャッフルで再生

const STORE_KEY = "music-player-v2";

const state = {
  tracks: [],        // プレイリスト { id, title, author }
  current: null,     // 再生中の曲 { id, title, author, genre? }
  discover: false,   // ランダム探索モード
  genre: "",         // 探索するジャンルID(空=すべて)
  shuffle: false,    // プレイリストのシャッフル
  repeat: false,
  history: [],       // 「前の曲」用
  queue: [],         // プレイリストのシャッフル用(曲ID)
  buffer: [],        // 探索で取得済みの未再生の曲
  played: new Set(), // 探索で再生済みの曲ID(重複防止)
  loading: false,
};

let player = null;
let playerReady = false;

const $ = (id) => document.getElementById(id);

// ---------- 保存 ----------
function save() {
  try {
    localStorage.setItem(STORE_KEY, JSON.stringify({
      tracks: state.tracks, shuffle: state.shuffle, repeat: state.repeat,
      genre: state.genre,
    }));
  } catch (e) { /* 保存できなくても動作は継続 */ }
}
function load() {
  try {
    const d = JSON.parse(localStorage.getItem(STORE_KEY) || "{}");
    state.tracks = Array.isArray(d.tracks) ? d.tracks : [];
    state.shuffle = !!d.shuffle;
    state.repeat = !!d.repeat;
    state.genre = typeof d.genre === "string" ? d.genre : "";
  } catch (e) { /* 無視 */ }
}

// ---------- URL 解析 ----------
function parseInput(text) {
  const out = { videos: [], playlists: [] };
  for (const raw of text.split(/\s+/).filter(Boolean)) {
    let url;
    try { url = new URL(raw); } catch (e) {
      if (/^[\w-]{11}$/.test(raw)) out.videos.push(raw);
      continue;
    }
    const v = url.searchParams.get("v");
    const list = url.searchParams.get("list");
    if (url.hostname === "youtu.be") {
      const id = url.pathname.slice(1);
      if (/^[\w-]{11}$/.test(id)) out.videos.push(id);
    } else if (v && /^[\w-]{11}$/.test(v)) {
      out.videos.push(v);
    } else if (list) {
      out.playlists.push(list);
    }
  }
  return out;
}

async function fetchMeta(id) {
  try {
    const u = "https://www.youtube.com/oembed?format=json&url=" +
      encodeURIComponent("https://www.youtube.com/watch?v=" + id);
    const r = await fetch(u);
    if (!r.ok) throw new Error(r.status);
    const j = await r.json();
    return { title: j.title, author: (j.author_name || "").replace(/ - Topic$/, "") };
  } catch (e) {
    return { title: id, author: "" };
  }
}

async function addVideo(id) {
  if (state.tracks.some((t) => t.id === id)) return false;
  const meta = await fetchMeta(id);
  state.tracks.push({ id, title: meta.title, author: meta.author });
  return true;
}

function addPlaylist(listId) {
  return new Promise((resolve) => {
    if (!playerReady) return resolve(0);
    player.cuePlaylist({ listType: "playlist", list: listId });
    let tries = 0;
    const timer = setInterval(async () => {
      tries++;
      const ids = player.getPlaylist && player.getPlaylist();
      if (ids && ids.length) {
        clearInterval(timer);
        let added = 0;
        for (const id of ids) if (await addVideo(id)) added++;
        resolve(added);
      } else if (tries > 30) {
        clearInterval(timer);
        resolve(0);
      }
    }, 300);
  });
}

// ---------- ランダム探索 ----------
function shuffleArray(a) {
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

async function refillBuffer() {
  const qs = state.genre ? "?genre=" + encodeURIComponent(state.genre) : "";
  const genreAtRequest = state.genre;
  const r = await fetch("/api/random" + qs);
  let j = {};
  try { j = await r.json(); } catch (e) { /* 下で処理 */ }
  if (!r.ok) throw new Error(j.error || "曲の取得に失敗しました (" + r.status + ")");
  // 取得中にジャンルが変わっていたら破棄
  if (genreAtRequest !== state.genre) return;
  const fresh = (j.tracks || []).filter(
    (t) => !state.played.has(t.id) && !state.buffer.some((b) => b.id === t.id)
  );
  state.buffer.push(...fresh);
}

async function nextDiscover() {
  if (state.loading) return;
  state.loading = true;
  try {
    for (let i = 0; i < 3 && !state.buffer.length; i++) {
      setStatus("曲を探しています…");
      await refillBuffer();
    }
    const t = state.buffer.shift();
    if (!t) { setStatus("条件に合う曲が見つかりませんでした。もう一度お試しください"); return; }
    state.played.add(t.id);
    playTrack(t);
    // 残りが少なくなったら先読み
    if (state.buffer.length < 5) refillBuffer().catch(() => {});
  } catch (e) {
    setStatus(e.message);
  } finally {
    state.loading = false;
  }
}

// ---------- 再生制御 ----------
function playTrack(t, pushHistory = true) {
  if (!playerReady) return;
  if (pushHistory && state.current) state.history.push(state.current);
  if (state.history.length > 100) state.history.shift();
  state.current = t;
  player.loadVideoById(t.id);
  render();
}

function refillQueue(excludeId) {
  state.queue = shuffleArray(
    state.tracks.map((t) => t.id).filter((id) => id !== excludeId)
  );
}

function nextFromList() {
  const n = state.tracks.length;
  if (!n) { setStatus("プレイリストに曲がありません"); return; }
  const curId = state.current && state.current.id;
  if (state.shuffle) {
    state.queue = state.queue.filter((id) => state.tracks.some((t) => t.id === id));
    if (!state.queue.length) {
      if (n === 1 && !state.repeat && curId) return;
      refillQueue(curId);
    }
    const id = state.queue.shift();
    const t = state.tracks.find((x) => x.id === id) || state.tracks[0];
    playTrack(t);
  } else {
    let i = state.tracks.findIndex((t) => t.id === curId) + 1; // 見つからなければ先頭
    if (i >= n) {
      if (!state.repeat) return;
      i = 0;
    }
    playTrack(state.tracks[i]);
  }
}

function next() {
  if (state.discover) nextDiscover();
  else nextFromList();
}

function prev() {
  if (playerReady && player.getCurrentTime && player.getCurrentTime() > 3) {
    player.seekTo(0, true);
    return;
  }
  if (state.history.length) playTrack(state.history.pop(), false);
}

function togglePlay() {
  if (!playerReady) return;
  if (!state.current) { next(); return; }
  const s = player.getPlayerState();
  if (s === YT.PlayerState.PLAYING) player.pauseVideo();
  else player.playVideo();
}

// ---------- YouTube IFrame API ----------
window.onYouTubeIframeAPIReady = () => {
  player = new YT.Player("player", {
    playerVars: { playsinline: 1, rel: 0, origin: location.origin },
    events: {
      onReady: () => { playerReady = true; render(); },
      onStateChange: (e) => {
        const S = YT.PlayerState;
        if (e.data === S.ENDED) next();
        $("btn-play").textContent = e.data === S.PLAYING ? "⏸" : "▶";
        if (e.data === S.PLAYING) setStatus(state.discover ? "ランダム再生中" : "再生中");
        else if (e.data === S.PAUSED) setStatus("一時停止");
        else if (e.data === S.BUFFERING) setStatus("読み込み中…");
      },
      onError: () => {
        setStatus("この曲は再生できないためスキップします");
        setTimeout(next, 800);
      },
    },
  });
};

// ---------- 画面 ----------
function setStatus(t) { $("now-status").textContent = t; }

function render() {
  const cur = state.current;
  $("now-title").textContent = cur
    ? cur.title + (cur.author ? " — " + cur.author : "") + (cur.genre ? "  [" + cur.genre + "]" : "")
    : "🎲 ランダム探索を押すと、曲を探して再生します";
  $("count").textContent = state.tracks.length ? `(${state.tracks.length}曲)` : "";
  $("btn-discover").classList.toggle("on", state.discover);
  $("btn-shuffle").classList.toggle("on", state.shuffle);
  $("btn-repeat").classList.toggle("on", state.repeat);

  const saved = cur && state.tracks.some((t) => t.id === cur.id);
  $("btn-save").textContent = saved ? "♥ 追加済み" : "♡ 追加";
  $("btn-save").disabled = !cur || saved;

  const ol = $("playlist");
  ol.innerHTML = "";
  if (!state.tracks.length) {
    ol.innerHTML = '<div class="empty">まだ曲がありません(ランダム探索で見つけた曲は「♡ 追加」で保存できます)</div>';
    return;
  }
  state.tracks.forEach((t) => {
    const li = document.createElement("li");
    if (cur && t.id === cur.id) li.className = "current";
    li.innerHTML =
      `<img loading="lazy" alt="" src="https://i.ytimg.com/vi/${t.id}/mqdefault.jpg">` +
      `<div class="meta"><div class="t"></div><div class="a"></div></div>` +
      `<button class="del" title="削除">✕</button>`;
    li.querySelector(".t").textContent = t.title;
    li.querySelector(".a").textContent = t.author;
    li.addEventListener("click", () => playTrack(t));
    li.querySelector(".del").addEventListener("click", (e) => {
      e.stopPropagation();
      removeTrack(t.id);
    });
    ol.appendChild(li);
  });
}

function removeTrack(id) {
  state.tracks = state.tracks.filter((t) => t.id !== id);
  state.queue = [];
  save();
  render();
}

async function loadGenres() {
  const sel = $("genre");
  try {
    const r = await fetch("/api/genres");
    if (!r.ok) throw new Error(r.status);
    const list = await r.json();
    for (const g of list) {
      const o = document.createElement("option");
      o.value = g.id;
      o.textContent = g.label;
      sel.appendChild(o);
    }
  } catch (e) { /* API未接続でも「すべて」だけで動作 */ }
  sel.value = state.genre;
  if (sel.value !== state.genre) { state.genre = ""; sel.value = ""; }
}

// ---------- イベント ----------
$("btn-discover").addEventListener("click", () => {
  state.discover = !state.discover;
  render();
  if (state.discover) nextDiscover();
});

$("genre").addEventListener("change", (e) => {
  state.genre = e.target.value;
  state.buffer = [];
  save();
  // 探索中なら、選んだジャンルですぐ次の曲へ
  if (state.discover) nextDiscover();
});

$("btn-save").addEventListener("click", () => {
  const c = state.current;
  if (!c || state.tracks.some((t) => t.id === c.id)) return;
  state.tracks.push({ id: c.id, title: c.title, author: c.author });
  state.queue = [];
  save();
  render();
});

$("add-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const input = $("add-input");
  const { videos, playlists } = parseInput(input.value);
  if (!videos.length && !playlists.length) {
    setStatus("URLを認識できませんでした");
    return;
  }
  input.value = "";
  setStatus("追加中…");
  let added = 0;
  for (const id of videos) if (await addVideo(id)) added++;
  for (const l of playlists) added += await addPlaylist(l);
  state.queue = [];
  save();
  render();
  setStatus(added ? `${added}曲を追加しました` : "追加できる曲がありませんでした");
});

$("btn-play").addEventListener("click", togglePlay);
$("btn-next").addEventListener("click", next);
$("btn-prev").addEventListener("click", prev);
$("btn-shuffle").addEventListener("click", () => {
  state.shuffle = !state.shuffle;
  state.queue = [];
  save();
  render();
});
$("btn-repeat").addEventListener("click", () => {
  state.repeat = !state.repeat;
  save();
  render();
});
$("btn-clear").addEventListener("click", () => {
  if (!state.tracks.length || !confirm("プレイリストを全て削除しますか?")) return;
  state.tracks = [];
  state.queue = [];
  save();
  render();
});

load();
render();
loadGenres();
