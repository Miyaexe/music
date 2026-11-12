// YouTube Music の曲を YouTube IFrame Player API で再生するプレイヤー。
// 音声データを抽出・保存せず、公式の埋め込みプレイヤー経由で再生する。

const STORE_KEY = "music-player-v1";

const state = {
  tracks: [],      // { id, title, author }
  index: -1,       // 現在の曲(tracks のインデックス)
  shuffle: false,
  repeat: false,
  history: [],     // ランダム再生時の「前の曲」用
  queue: [],       // ランダム再生の未再生キュー(重複なしで一巡)
};

let player = null;
let playerReady = false;

const $ = (id) => document.getElementById(id);

// ---------- 保存 ----------
function save() {
  try {
    localStorage.setItem(STORE_KEY, JSON.stringify({
      tracks: state.tracks, shuffle: state.shuffle, repeat: state.repeat,
    }));
  } catch (e) { /* 保存できなくても動作は継続 */ }
}
function load() {
  try {
    const d = JSON.parse(localStorage.getItem(STORE_KEY) || "{}");
    state.tracks = Array.isArray(d.tracks) ? d.tracks : [];
    state.shuffle = !!d.shuffle;
    state.repeat = !!d.repeat;
  } catch (e) { /* 無視 */ }
}

// ---------- URL 解析 ----------
function parseInput(text) {
  const out = { videos: [], playlists: [] };
  for (const raw of text.split(/\s+/).filter(Boolean)) {
    let url;
    try { url = new URL(raw); } catch (e) {
      if (/^[\w-]{11}$/.test(raw)) out.videos.push(raw); // 動画IDだけの場合
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

// 曲名・アーティスト名は公式の oEmbed から取得する(失敗してもIDだけで動く)
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

// プレイリストはプレイヤー自身に読み込ませ、動画IDの一覧を取得する
function addPlaylist(listId) {
  return new Promise((resolve) => {
    if (!playerReady) return resolve(0);
    const onState = () => {};
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

// ---------- 再生制御 ----------
function shuffleArray(a) {
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

// 一巡するまで同じ曲が出ないランダム再生
function refillQueue(exclude) {
  state.queue = shuffleArray(
    state.tracks.map((_, i) => i).filter((i) => i !== exclude)
  );
}

function playIndex(i, pushHistory = true) {
  if (i < 0 || i >= state.tracks.length || !playerReady) return;
  if (pushHistory && state.index >= 0) state.history.push(state.index);
  state.index = i;
  player.loadVideoById(state.tracks[i].id);
  render();
}

function next() {
  const n = state.tracks.length;
  if (!n) return;
  if (state.shuffle) {
    if (!state.queue.length) {
      if (n === 1 && !state.repeat) return;
      refillQueue(state.index);
    }
    const i = state.queue.shift();
    if (i === undefined) return playIndex(state.index);
    playIndex(i);
  } else {
    let i = state.index + 1;
    if (i >= n) {
      if (!state.repeat) return;
      i = 0;
    }
    playIndex(i);
  }
}

function prev() {
  if (!state.tracks.length) return;
  // 3秒以上再生していたら曲の頭に戻す
  if (playerReady && player.getCurrentTime && player.getCurrentTime() > 3) {
    player.seekTo(0, true);
    return;
  }
  if (state.history.length) {
    playIndex(state.history.pop(), false);
  } else if (!state.shuffle) {
    playIndex(Math.max(0, state.index - 1), false);
  }
}

function togglePlay() {
  if (!playerReady) return;
  if (state.index < 0) {
    if (!state.tracks.length) return;
    if (state.shuffle) {
      refillQueue(-1);
      playIndex(state.queue.shift());
    } else {
      playIndex(0);
    }
    return;
  }
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
        if (e.data === S.PLAYING) setStatus("再生中");
        else if (e.data === S.PAUSED) setStatus("一時停止");
        else if (e.data === S.BUFFERING) setStatus("読み込み中…");
      },
      onError: () => {
        // 埋め込み不可・削除済みの曲は自動でスキップ
        setStatus("この曲は再生できないためスキップします");
        setTimeout(next, 800);
      },
    },
  });
};

// ---------- 画面 ----------
function setStatus(t) { $("now-status").textContent = t; }

function render() {
  const cur = state.tracks[state.index];
  $("now-title").textContent = cur
    ? cur.title + (cur.author ? " — " + cur.author : "")
    : "曲を追加して再生してください";
  $("count").textContent = state.tracks.length ? `(${state.tracks.length}曲)` : "";
  $("btn-shuffle").classList.toggle("on", state.shuffle);
  $("btn-repeat").classList.toggle("on", state.repeat);

  const ol = $("playlist");
  ol.innerHTML = "";
  if (!state.tracks.length) {
    ol.innerHTML = '<div class="empty">まだ曲がありません</div>';
    return;
  }
  state.tracks.forEach((t, i) => {
    const li = document.createElement("li");
    if (i === state.index) li.className = "current";
    li.innerHTML =
      `<img loading="lazy" alt="" src="https://i.ytimg.com/vi/${t.id}/mqdefault.jpg">` +
      `<div class="meta"><div class="t"></div><div class="a"></div></div>` +
      `<button class="del" title="削除">✕</button>`;
    li.querySelector(".t").textContent = t.title;
    li.querySelector(".a").textContent = t.author;
    li.addEventListener("click", () => playIndex(i));
    li.querySelector(".del").addEventListener("click", (e) => {
      e.stopPropagation();
      removeTrack(i);
    });
    ol.appendChild(li);
  });
}

function removeTrack(i) {
  state.tracks.splice(i, 1);
  if (i < state.index) state.index--;
  else if (i === state.index) {
    state.index = -1;
    if (playerReady) player.stopVideo();
  }
  state.history = [];
  state.queue = [];
  save();
  render();
}

// ---------- イベント ----------
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
  state.index = -1;
  state.history = [];
  state.queue = [];
  if (playerReady) player.stopVideo();
  save();
  render();
});

load();
render();
