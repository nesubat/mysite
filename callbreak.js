"use strict";

const ROUNDS = 5, TRICKS = 13, KEY = "callbreak:v1";

/* ---------- persistence: one key on this device, nothing leaves the phone ---------- */
let canStore = true;
try { localStorage.setItem(KEY + ":probe", "1"); localStorage.removeItem(KEY + ":probe"); }
catch (e) { canStore = false; }

let store = { current: null, history: [] };

function loadStore(){
  if (!canStore) return;
  try {
    const raw = localStorage.getItem(KEY);
    if (raw){
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed === "object"){
        store.current = parsed.current || null;
        store.history = Array.isArray(parsed.history) ? parsed.history : [];
      }
    }
  } catch (e) { store = { current: null, history: [] }; }
}
function saveStore(){
  if (!canStore) return;
  try { localStorage.setItem(KEY, JSON.stringify(store)); }
  catch (e) { canStore = false; }
}
function persist(){
  store.current = (S.phase === "setup") ? null : {
    phase: S.phase, names: S.names, rounds: S.rounds, draft: S.draft,
    editing: S.editing, matchId: S.matchId, startedAt: S.startedAt,
    endedAt: S.endedAt, archived: S.archived
  };
  saveStore();
}

/* ---------- state ---------- */
let S = {
  phase: "setup",          // setup | bid | tricks | done
  screen: "play",          // play | match
  openId: null,
  names: ["", "", "", ""],
  rounds: [],
  draft: null,
  editing: null,
  resume: null,
  matchId: null,
  startedAt: null,
  endedAt: null,
  archived: false
};

/* ---------- scoring (held in tenths so totals never drift) ---------- */
function scoreTenths(call, tricks, bonus){
  const eff = call * 10 + (bonus ? 1 : 0);
  if (tricks < call) return -eff;
  return eff + (tricks - call);
}
function fmt(t){
  if (t === null || t === undefined) return "";
  return (t % 10 === 0) ? String(t / 10) : (t / 10).toFixed(1);
}
function totalsOf(rounds){
  return [0,1,2,3].map(i => rounds.reduce((a,r) => a + r.scores[i], 0));
}
function totals(){ return totalsOf(S.rounds); }
/* ---------- standing position for every seat, ties share a rank (1,2,2,4) ---------- */
function ranksOf(tot){
  const order = [0,1,2,3].sort((a,b) => tot[b] - tot[a]);
  const rank = [];
  order.forEach((seat, p) => {
    rank[seat] = (p > 0 && tot[seat] === tot[order[p-1]]) ? rank[order[p-1]] : p + 1;
  });
  return rank;
}
function ordinal(n){
  return n === 1 ? "1st" : n === 2 ? "2nd" : n === 3 ? "3rd" : n + "th";
}
const sum = a => a.reduce((x,y) => x + y, 0);
const esc = s => String(s).replace(/[&<>"]/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;"}[c]));
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);

function when(iso){
  if (!iso) return "—";
  return new Date(iso).toLocaleString(undefined,
    { day:"numeric", month:"short", year:"numeric", hour:"numeric", minute:"2-digit" });
}
function clock(iso){
  if (!iso) return "—";
  return new Date(iso).toLocaleTimeString(undefined, { hour:"numeric", minute:"2-digit" });
}
function span(a, b){
  if (!a || !b) return "—";
  const m = Math.max(0, Math.round((new Date(b) - new Date(a)) / 60000));
  return m < 60 ? m + " min" : Math.floor(m/60) + "h " + (m % 60) + "m";
}

function freshDraft(){ return { calls:[1,1,1,1], bonus:false, tricks:[0,0,0,0], nine:false }; }
function roundNo(){ return S.editing !== null ? S.editing + 1 : S.rounds.length + 1; }
function callsBad(){ const d = S.draft; return d.calls.some(c => c < 1) || sum(d.calls) < 9; }
function beginMatch(){ S.matchId = uid(); S.startedAt = new Date().toISOString(); S.endedAt = null; S.archived = false; }

/* ---------- render ---------- */
function render(animate){
  const tag = document.getElementById("roundtag");
  if (S.screen === "match") tag.textContent = "Past match";
  else if (S.phase === "setup") tag.textContent = "";
  else if (S.phase === "done") tag.textContent = "Match complete";
  else if (S.editing !== null) tag.innerHTML = "Fixing round <b>" + roundNo() + "</b>";
  else tag.innerHTML = "Round <b>" + roundNo() + "</b> of " + ROUNDS;

  const app = document.getElementById("app");
  let html = "";

  if (S.screen === "match"){
    html = viewMatch();
  } else if (S.phase === "setup"){
    html = viewSetup() + viewHistory();
  } else {
    if (S.phase === "bid")    html += viewBid();
    if (S.phase === "tricks") html += viewTricks();
    if (S.phase === "done")   html += viewDone();
    html += padFor("Scorepad", S.names, S.rounds, true);
    html += viewHistory();
  }
  app.innerHTML = html;
  if (animate){
    const c = app.querySelector(".card");
    if (c) c.classList.add("settle");
  }
  persist();
}

function viewSetup(){
  return '<div class="card setup">' +
    '<div class="cardhead"><h2>Who is playing?</h2></div>' +
    '<p class="sub">Four seats, no more and no less. You can rename them later.</p>' +
    [0,1,2,3].map(i =>
      '<label for="n' + i + '">Seat ' + (i+1) + '</label>' +
      '<input id="n' + i + '" type="text" autocomplete="off" maxlength="14" ' +
      'placeholder="Player ' + (i+1) + '" value="' + esc(S.names[i]) + '">').join("") +
    '<button class="btn" data-act="start">Deal the first round</button>' +
  '</div>';
}

function stepRow(i, kind, value, min, note){
  const shown = (value === 0 && kind === "call") ? "" : value;
  return '<div class="row ' + (kind === "trick" ? "got" : "") + '">' +
    '<div class="who">' + esc(S.names[i]) + '</div>' +
    '<div class="step">' +
      '<button data-act="dec" data-kind="' + kind + '" data-i="' + i + '"' +
        (value <= min ? " disabled" : "") + ' aria-label="one less">&minus;</button>' +
      '<input class="numin" type="number" inputmode="numeric" pattern="[0-9]*" ' +
        'data-i="' + i + '" data-kind="' + kind + '" value="' + shown + '" ' +
        'min="' + min + '" max="13" aria-label="' + esc(S.names[i]) + ' ' + kind + '">' +
      '<button data-act="inc" data-kind="' + kind + '" data-i="' + i + '"' +
        (value >= 13 ? " disabled" : "") + ' aria-label="one more">+</button>' +
    '</div>' + (note || "") +
  '</div>';
}

/* ---------- calls ---------- */
function bidFoot(){
  const d = S.draft, t = sum(d.calls);
  const blank = d.calls.some(c => c < 1);
  let note = "";

  if (blank) note = '<p class="note bad">Every player has to call at least 1.</p>';
  else if (t < 9) note = '<p class="note bad">Calls add up to ' + t + '. The table needs at least 9 before anyone deals.</p>';
  else if (t === 9 && !d.nine) note = '<p class="note warn">Exactly 9 &mdash; the lowest a table can go. Pick how to play it below.</p>';
  else if (t === 9 && d.nine) note = d.bonus
    ? '<p class="note calm">Bare 9, playing with +0.1 on every call.</p>'
    : '<p class="note calm">Bare 9, playing straight off the calls.</p>';
  else if (t === 13) note = '<p class="note hot">All 13 spoken for. Nobody has room to miss a single trick.</p>';
  else if (t > 13) note = '<p class="note warn">Over by ' + (t - 13) + '. At least one player is going down tonight.</p>';

  const askNine = (t === 9 && !blank && !d.nine);
  const choices = askNine ? '<div class="choices">' +
      '<button class="btn small" data-act="nine-bonus">Play it with +0.1 on every call</button>' +
      '<button class="btn small ghost" data-act="nine-plain">Play it as called</button>' +
      '<button class="btn small ghost" data-act="nine-reset">Clear and call again</button>' +
    '</div>' : "";

  const lock = askNine ? "" :
    '<button class="btn" data-act="lock"' + ((t >= 9 && !blank) ? "" : " disabled") + '>Lock in calls</button>';

  return note + choices + lock;
}

function viewBid(){
  const d = S.draft;
  return '<div class="card">' +
    '<div class="cardhead"><h2>Calls' + (S.editing !== null ? " &middot; round " + roundNo() : "") + '</h2>' +
    '<div class="tally"><span id="tally">' + sum(d.calls) + '</span> <small>called</small></div></div>' +
    '<p class="sub">What each player promises to win out of 13. Tap a number to type it.</p>' +
    '<div class="rows">' + [0,1,2,3].map(i => stepRow(i, "call", d.calls[i], 1, "")).join("") + '</div>' +
    '<div id="bidfoot">' + bidFoot() + '</div>' +
    (S.editing !== null
      ? '<button class="btn ghost" data-act="cancel-edit">Cancel</button>'
      : '<button class="btn ghost" data-act="rename">Rename players</button>') +
  '</div>';
}

/* ---------- tricks won (calls stay editable here) ---------- */
function tricksFoot(){
  const d = S.draft, t = sum(d.tricks), ct = sum(d.calls), left = TRICKS - t;
  const bad = callsBad();
  let note = "";

  if (d.calls.some(c => c < 1)) note = '<p class="note bad">Every player has to call at least 1.</p>';
  else if (ct < 9) note = '<p class="note bad">Calls now add up to ' + ct + '. The table needs at least 9.</p>';
  else if (t > TRICKS) note = '<p class="note bad">That is ' + t + ' tricks. A hand only holds 13.</p>';
  else if (t < TRICKS) note = '<p class="note calm">' + left + ' trick' + (left === 1 ? "" : "s") + ' still unaccounted for.</p>';

  const toggle = (ct === 9 && !bad)
    ? '<button class="btn small ghost' + (d.bonus ? " on" : "") + '" data-act="bonus">' +
      (d.bonus ? "✓ " : "") + 'Bare 9 bonus: +0.1 on every call</button>'
    : "";

  return note + toggle +
    '<button class="btn" data-act="save"' + ((t === TRICKS && !bad) ? "" : " disabled") +
    '>Save round ' + roundNo() + '</button>';
}

function viewTricks(){
  const d = S.draft;
  const rows = [0,1,2,3].map(i => {
    const s = scoreTenths(d.calls[i], d.tricks[i], d.bonus);
    const cmp = '<span class="cmp">called ' +
      '<input class="numin callmini" type="number" inputmode="numeric" pattern="[0-9]*" ' +
        'data-i="' + i + '" data-kind="call" value="' + (d.calls[i] || "") + '" ' +
        'min="1" max="13" aria-label="' + esc(S.names[i]) + ' call">' +
      ', won <b id="w' + i + '">' + d.tricks[i] + '</b> &rarr; ' +
      '<em id="s' + i + '"' + (s < 0 ? ' class="down"' : "") + '>' + fmt(s) + '</em></span>';
    return stepRow(i, "trick", d.tricks[i], 0, cmp);
  }).join("");

  return '<div class="card">' +
    '<div class="cardhead"><h2>Tricks won</h2>' +
    '<div class="tally"><span id="ttally">' + sum(d.tricks) + '</span><small> / 13</small></div></div>' +
    '<p class="sub">Count them off. A call can still be corrected here if someone was misheard.</p>' +
    '<div class="rows">' + rows + '</div>' +
    '<div id="tfoot">' + tricksFoot() + '</div>' +
    '<button class="btn ghost" data-act="back">Back to calls</button>' +
  '</div>';
}

function standingsList(names, rounds){
  const tot = totalsOf(rounds);
  const order = [0,1,2,3].sort((a,b) => tot[b] - tot[a]);
  return '<ol class="standings">' + order.map((i,p) =>
    '<li class="' + (tot[i] < 0 ? "n" : "") + '"><span>' + (p+1) + '. ' + esc(names[i]) +
    '</span><span>' + fmt(tot[i]) + '</span></li>').join("") + '</ol>';
}

function viewDone(){
  const tot = totals();
  const order = [0,1,2,3].sort((a,b) => tot[b] - tot[a]);
  const win = order[0];
  return '<div class="card final">' +
    '<p class="sub" style="margin-bottom:0">After five rounds</p>' +
    '<div class="champ">' + esc(S.names[win]) + '</div>' +
    '<div class="score">takes it with ' + fmt(tot[win]) + '</div>' +
    standingsList(S.names, S.rounds) +
    '<p class="stamp" style="margin-top:14px">Started <b>' + clock(S.startedAt) + '</b> &middot; ' +
      'finished <b>' + clock(S.endedAt) + '</b> &middot; ' + span(S.startedAt, S.endedAt) + '</p>' +
    '<button class="btn" data-act="again">Play another five</button>' +
    '<button class="btn ghost" data-act="fresh">New players</button>' +
  '</div>';
}

/* ---------- the points table, reused for live play and for history ---------- */
function padFor(title, names, rounds, live){
  const tot = totalsOf(rounds);
  const best = Math.max.apply(null, tot);
  let body = "";
  for (let r = 0; r < ROUNDS; r++){
    const done = rounds[r];
    const label = (done && live)
      ? '<button class="rlabel" data-act="edit" data-r="' + r + '">' + (r+1) + '</button>'
      : String(r+1);
    body += '<tr><td class="rlabel">' + label + '</td>' +
      [0,1,2,3].map(i => done
        ? '<td class="' + (done.scores[i] < 0 ? "neg" : "") + '">' + fmt(done.scores[i]) + '</td>'
        : '<td class="empty">&middot;</td>').join("") + '</tr>';
  }
  const ranks = ranksOf(tot);
  const posRow = rounds.length
    ? '<tr class="posrow"><td class="rlabel">Pos</td>' +
      ranks.map(r => '<td>' + ordinal(r) + '</td>').join("") + '</tr>'
    : "";

  return '<div class="pad"><h2>' + title + '</h2><table>' +
    '<thead><tr><th></th>' + names.map(n => '<th>' + esc(n) + '</th>').join("") + '</tr></thead>' +
    '<tbody>' + body + '</tbody>' +
    '<tfoot><tr><td class="rlabel"></td>' + tot.map(v =>
      '<td class="' + (v < 0 ? "neg " : "") + ((v === best && rounds.length > 0) ? "lead" : "") + '">' +
      fmt(v) + '</td>').join("") + '</tr>' + posRow + '</tfoot></table>' +
    (live ? '<p class="padnote">' + (rounds.length
      ? "Tap a round number to correct it."
      : "Scores land here as each round is saved.") + '</p>' : "") +
  '</div>';
}

/* ---------- past matches ---------- */
function viewHistory(){
  const h = store.history.slice().sort((a,b) => (b.endedAt || "").localeCompare(a.endedAt || ""));
  let list;
  if (!h.length){
    list = '<p class="empty-state">Finished matches are kept here on this phone. None yet.</p>';
  } else {
    list = '<ul class="hist">' + h.map(m => {
      const tot = totalsOf(m.rounds);
      const w = tot.indexOf(Math.max.apply(null, tot));
      const ranks = ranksOf(tot);
      const order = [0,1,2,3].slice().sort((a,b) => ranks[a] - ranks[b]);
      const posLine = order.map(i =>
        ordinal(ranks[i]) + " " + esc(m.names[i]) + " " + fmt(tot[i])).join(" &middot; ");
      return '<li><button data-act="open" data-id="' + m.id + '">' +
        '<span><span class="win">' + esc(m.names[w]) + '</span>' +
        '<span class="meta">' + when(m.endedAt) + ' &middot; ' + span(m.startedAt, m.endedAt) + '</span>' +
        '<span class="meta standings-line">' + posLine + '</span></span>' +
        '<span class="pts' + (tot[w] < 0 ? " neg" : "") + '">' + fmt(tot[w]) + '</span>' +
        '</button></li>';
    }).join("") + '</ul>';
  }

  const warn = canStore ? "" :
    '<p class="note bad">This browser is not letting the page save. Progress will be lost on refresh. ' +
    'Opening the file from a hosted address, or turning off private browsing, fixes it.</p>';

  return '<div class="pad"><h2>Past matches</h2>' + warn + list +
    '<div class="pair" style="margin-top:12px">' +
      '<button class="btn ghost small" data-act="export">Export backup</button>' +
      '<button class="btn ghost small" data-act="import">Restore backup</button>' +
    '</div></div>';
}

function viewMatch(){
  const m = store.history.filter(x => x.id === S.openId)[0];
  if (!m) return '<div class="card"><p class="sub">That match is no longer saved.</p>' +
    '<button class="btn" data-act="closematch">Back</button></div>';
  const tot = totalsOf(m.rounds);
  const w = tot.indexOf(Math.max.apply(null, tot));
  return '<div class="card">' +
    '<div class="cardhead"><h2>' + esc(m.names[w]) + ' won</h2>' +
    '<div class="tally">' + fmt(tot[w]) + '</div></div>' +
    '<p class="stamp">' +
      'Started <b>' + when(m.startedAt) + '</b><br>' +
      'Ended <b>' + when(m.endedAt) + '</b><br>' +
      'Played for <b>' + span(m.startedAt, m.endedAt) + '</b></p>' +
    standingsList(m.names, m.rounds) +
    '<button class="btn" data-act="closematch">Back to the table</button>' +
    '<button class="btn ghost danger" data-act="delmatch" data-id="' + m.id + '">Delete this match</button>' +
  '</div>' + padFor("Round by round", m.names, m.rounds, false);
}

/* ---------- live refresh that leaves the focused field alone ---------- */
function refreshSteppers(){
  const d = S.draft;
  const btns = document.querySelectorAll(".step button[data-kind]");
  for (let k = 0; k < btns.length; k++){
    const b = btns[k], kind = b.dataset.kind, i = +b.dataset.i;
    const v = kind === "call" ? d.calls[i] : d.tricks[i];
    b.disabled = b.dataset.act === "inc" ? v >= 13 : v <= (kind === "call" ? 1 : 0);
  }
}
function refreshBid(){
  const t = document.getElementById("tally");
  if (t) t.textContent = sum(S.draft.calls);
  const f = document.getElementById("bidfoot");
  if (f) f.innerHTML = bidFoot();
  refreshSteppers();
}
function refreshTricks(){
  const d = S.draft;
  const t = document.getElementById("ttally");
  if (t) t.textContent = sum(d.tricks);
  for (let i = 0; i < 4; i++){
    const s = scoreTenths(d.calls[i], d.tricks[i], d.bonus);
    const w = document.getElementById("w" + i), sc = document.getElementById("s" + i);
    if (w) w.textContent = d.tricks[i];
    if (sc){ sc.textContent = fmt(s); sc.className = s < 0 ? "down" : ""; }
  }
  const f = document.getElementById("tfoot");
  if (f) f.innerHTML = tricksFoot();
  refreshSteppers();
}
function refresh(){ S.phase === "bid" ? refreshBid() : refreshTricks(); persist(); }

/* ---------- input ---------- */
const app = document.getElementById("app");

app.addEventListener("input", function(e){
  const el = e.target;
  if (!el.classList || !el.classList.contains("numin") || !S.draft) return;
  let v = parseInt(el.value, 10);
  if (isNaN(v) || v < 0){ v = 0; el.value = ""; }
  if (v > 13){ v = 13; el.value = "13"; }
  const i = +el.dataset.i;
  if (el.dataset.kind === "call"){
    S.draft.calls[i] = v;
    if (S.phase === "bid"){ S.draft.nine = false; S.draft.bonus = false; }
    else if (sum(S.draft.calls) !== 9) S.draft.bonus = false;
  } else {
    S.draft.tricks[i] = v;
  }
  refresh();
});

app.addEventListener("focusout", function(e){
  const el = e.target;
  if (!el.classList || !el.classList.contains("numin") || !S.draft) return;
  const kind = el.dataset.kind, i = +el.dataset.i;
  const min = kind === "call" ? 1 : 0;
  const v = Math.min(13, Math.max(min, parseInt(el.value, 10) || 0));
  el.value = v;
  const cur = kind === "call" ? S.draft.calls[i] : S.draft.tricks[i];
  if (v !== cur){
    if (kind === "call") S.draft.calls[i] = v; else S.draft.tricks[i] = v;
    refresh();
  }
});

app.addEventListener("click", function(e){
  const el = e.target.closest("[data-act]");
  if (!el) return;
  const act = el.dataset.act;
  const d = S.draft;

  if (act === "start" || act === "rename-save"){
    const names = [0,1,2,3].map(i => {
      const v = document.getElementById("n" + i).value.trim();
      return v || ("Player " + (i+1));
    });
    S.names = names.map((n,i) => names.indexOf(n) !== i ? n + " " + (i+1) : n);
    if (act === "start"){ S.draft = freshDraft(); S.phase = "bid"; beginMatch(); }
    else {
      S.phase = S.resume || "bid"; S.resume = null;
      if (S.archived) syncArchive();
    }
    return render(true);
  }

  if (act === "rename"){
    S.resume = "bid"; S.phase = "setup"; render(true);
    const b = document.querySelector('[data-act="start"]');
    b.dataset.act = "rename-save"; b.textContent = "Save names";
    return;
  }

  if (act === "inc" || act === "dec"){
    const i = +el.dataset.i, up = act === "inc";
    if (el.dataset.kind === "call"){
      d.calls[i] = Math.min(13, Math.max(1, d.calls[i] + (up ? 1 : -1)));
      if (S.phase === "bid"){ d.nine = false; d.bonus = false; }
      else if (sum(d.calls) !== 9) d.bonus = false;
    } else {
      d.tricks[i] = Math.min(13, Math.max(0, d.tricks[i] + (up ? 1 : -1)));
    }
    return render(false);
  }

  if (act === "nine-bonus"){ d.bonus = true;  d.nine = true; S.phase = "tricks"; return render(true); }
  if (act === "nine-plain"){ d.bonus = false; d.nine = true; S.phase = "tricks"; return render(true); }
  if (act === "nine-reset"){ S.draft = freshDraft(); return render(false); }
  if (act === "bonus"){ d.bonus = !d.bonus; return render(false); }

  if (act === "lock"){ if (callsBad()) return; S.phase = "tricks"; return render(true); }
  if (act === "back"){ S.phase = "bid"; return render(true); }

  if (act === "save"){
    if (sum(d.tricks) !== TRICKS || callsBad()) return;
    const entry = {
      calls: d.calls.slice(), bonus: d.bonus, tricks: d.tricks.slice(),
      scores: [0,1,2,3].map(i => scoreTenths(d.calls[i], d.tricks[i], d.bonus))
    };
    if (S.editing !== null){ S.rounds[S.editing] = entry; S.editing = null; }
    else S.rounds.push(entry);

    if (S.rounds.length >= ROUNDS){
      S.phase = "done"; S.draft = null;
      if (!S.archived){
        S.endedAt = new Date().toISOString();
        store.history.push({
          id: S.matchId, names: S.names.slice(), rounds: JSON.parse(JSON.stringify(S.rounds)),
          startedAt: S.startedAt, endedAt: S.endedAt
        });
        S.archived = true;
      } else syncArchive();
    } else {
      if (S.archived) syncArchive();
      S.draft = freshDraft(); S.phase = "bid";
    }
    return render(true);
  }

  if (act === "edit"){
    const r = +el.dataset.r, old = S.rounds[r];
    S.editing = r;
    S.draft = { calls: old.calls.slice(), bonus: old.bonus, tricks: old.tricks.slice(), nine: true };
    S.phase = "bid";
    window.scrollTo({ top: 0, behavior: "smooth" });
    return render(true);
  }
  if (act === "cancel-edit"){
    S.editing = null;
    S.phase = S.rounds.length >= ROUNDS ? "done" : "bid";
    S.draft = S.rounds.length >= ROUNDS ? null : freshDraft();
    return render(true);
  }

  if (act === "again"){
    S.rounds = []; S.draft = freshDraft(); S.phase = "bid"; beginMatch();
    return render(true);
  }
  if (act === "fresh"){
    S.phase = "setup"; S.screen = "play"; S.names = ["","","",""]; S.rounds = [];
    S.draft = null; S.editing = null; S.resume = null;
    S.matchId = null; S.startedAt = null; S.endedAt = null; S.archived = false;
    return render(true);
  }

  if (act === "open"){
    S.openId = el.dataset.id; S.screen = "match";
    window.scrollTo({ top: 0, behavior: "smooth" });
    return render(true);
  }
  if (act === "closematch"){ S.screen = "play"; S.openId = null; return render(true); }
  if (act === "delmatch"){
    if (!window.confirm("Delete this match for good?")) return;
    store.history = store.history.filter(m => m.id !== el.dataset.id);
    if (S.matchId === el.dataset.id) S.archived = false;
    S.screen = "play"; S.openId = null; saveStore();
    return render(true);
  }

  if (act === "export") return exportBackup();
  if (act === "import") return document.getElementById("filepick").click();
});

/* keep the archived copy in step when a finished match is corrected */
function syncArchive(){
  for (let i = 0; i < store.history.length; i++){
    if (store.history[i].id === S.matchId){
      store.history[i].rounds = JSON.parse(JSON.stringify(S.rounds));
      store.history[i].names = S.names.slice();
      break;
    }
  }
  saveStore();
}

function exportBackup(){
  const blob = new Blob([JSON.stringify({ version:1, exportedAt:new Date().toISOString(),
    history: store.history }, null, 2)], { type:"application/json" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = "call-break-history-" + new Date().toISOString().slice(0,10) + ".json";
  document.body.appendChild(a); a.click();
  setTimeout(function(){ URL.revokeObjectURL(a.href); a.remove(); }, 1000);
}

document.getElementById("filepick").addEventListener("change", function(e){
  const file = e.target.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = function(){
    let added = 0;
    try {
      const data = JSON.parse(reader.result);
      const incoming = Array.isArray(data) ? data : (data.history || []);
      const have = {};
      store.history.forEach(m => { have[m.id] = true; });
      incoming.forEach(m => {
        if (m && m.id && !have[m.id] && Array.isArray(m.rounds)){ store.history.push(m); added++; }
      });
      saveStore();
      window.alert(added ? added + " match" + (added === 1 ? "" : "es") + " restored."
                         : "Nothing new in that file.");
    } catch (err){ window.alert("That file could not be read as a backup."); }
    e.target.value = "";
    render(false);
  };
  reader.readAsText(file);
});

/* ---------- boot ---------- */
loadStore();
if (store.current){
  const c = store.current;
  S.phase = c.phase || "setup";
  S.names = c.names || S.names;
  S.rounds = c.rounds || [];
  S.draft = c.draft || null;
  S.editing = (c.editing === 0 || c.editing) ? c.editing : null;
  S.matchId = c.matchId || null;
  S.startedAt = c.startedAt || null;
  S.endedAt = c.endedAt || null;
  S.archived = !!c.archived;
  if (S.phase !== "setup" && S.phase !== "done" && !S.draft) S.draft = freshDraft();
}
render(false);
