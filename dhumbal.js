"use strict";
const MINP = 2, MAXP = 8, KEY = "dhumbal:v1";

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
  phase: "setup",     // setup | round | done
  screen: "play",     // play | match
  openId: null,
  count: 4,
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

/* ---------- scoring ----------
   Plain win  : winner takes 1 off every other player   -> winner +(n-1), rest -1
   Caught win : winner takes 2 off the player who was caught and 1 off each of the
                others                                  -> winner +n, caught -2, rest -1
   Either way the round sums to zero.                                          */
function scoreRound(n, winner, caught){
  const s = [];
  for (let i = 0; i < n; i++) s.push(-1);
  if (caught === null || caught === undefined){
    s[winner] = n - 1;
  } else {
    s[caught] = -2;
    s[winner] = n;
  }
  return s;
}

function totalsOf(rounds, n){
  const t = [];
  for (let i = 0; i < n; i++) t.push(0);
  rounds.forEach(r => { for (let i = 0; i < n; i++) t[i] += (r.scores[i] || 0); });
  return t;
}
function totals(){ return totalsOf(S.rounds, S.names.length); }

const sum = a => a.reduce((x,y) => x + y, 0);
const esc = s => String(s).replace(/[&<>"]/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;"}[c]));
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
const plus = v => (v > 0 ? "+" + v : String(v));

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

function freshDraft(){ return { winner: null, caught: null, isCatch: false }; }
function roundNo(){ return S.editing !== null ? S.editing + 1 : S.rounds.length + 1; }
function draftReady(){
  const d = S.draft;
  if (!d || d.winner === null) return false;
  if (d.isCatch && (d.caught === null || d.caught === d.winner)) return false;
  return true;
}
function beginMatch(){ S.matchId = uid(); S.startedAt = new Date().toISOString(); S.endedAt = null; S.archived = false; }

/* ---------- render ---------- */
function render(animate){
  const tag = document.getElementById("roundtag");
  if (S.screen === "match") tag.textContent = "Past match";
  else if (S.phase === "setup") tag.textContent = "";
  else if (S.phase === "done") tag.textContent = "Match complete";
  else if (S.editing !== null) tag.innerHTML = "Fixing round <b>" + roundNo() + "</b>";
  else tag.innerHTML = "Round <b>" + roundNo() + "</b>";

  const app = document.getElementById("app");
  let html = "";

  if (S.screen === "match"){
    html = viewMatch();
  } else if (S.phase === "setup"){
    html = viewSetup() + viewHistory();
  } else {
    if (S.phase === "round") html += viewRound();
    if (S.phase === "done")  html += viewDone();
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

/* ---------- setup ---------- */
function viewSetup(){
  const n = S.count;
  let fields = "";
  for (let i = 0; i < n; i++){
    fields += '<label for="n' + i + '">Seat ' + (i+1) + '</label>' +
      '<input id="n' + i + '" type="text" autocomplete="off" maxlength="14" ' +
      'placeholder="Player ' + (i+1) + '" value="' + esc(S.names[i] || "") + '">';
  }
  return '<div class="card setup">' +
    '<div class="cardhead"><h2>Who is playing?</h2></div>' +
    '<p class="sub">Anywhere from two to eight at the table. You can rename them later.</p>' +
    '<div class="counter">' +
      '<button data-act="fewer"' + (n <= MINP ? " disabled" : "") + ' aria-label="one fewer player">&minus;</button>' +
      '<span class="n">' + n + '</span>' +
      '<button data-act="more"' + (n >= MAXP ? " disabled" : "") + ' aria-label="one more player">+</button>' +
      '<span class="lbl">players</span>' +
    '</div>' +
    fields +
    '<button class="btn" data-act="start">Deal the first round</button>' +
    '</div>';
}

/* ---------- the round ---------- */
function seatButtons(kind, selected, disableIdx){
  let out = '<div class="seats">';
  for (let i = 0; i < S.names.length; i++){
    const off = (disableIdx !== null && disableIdx !== undefined && i === disableIdx);
    out += '<button class="seat' + (selected === i ? " pick" : "") +
      (selected === i && kind === "caught" ? " red" : "") + '" ' +
      'data-act="pick" data-kind="' + kind + '" data-i="' + i + '"' + (off ? " disabled" : "") + '>' +
      esc(S.names[i]) + '</button>';
  }
  return out + '</div>';
}

function roundPreview(){
  const d = S.draft, n = S.names.length;
  if (!draftReady()) return "";
  const s = scoreRound(n, d.winner, d.isCatch ? d.caught : null);
  let rows = "";
  for (let i = 0; i < n; i++){
    let tagtext = "";
    if (i === d.winner) tagtext = "<i>won</i>";
    else if (d.isCatch && i === d.caught) tagtext = "<i>caught</i>";
    rows += '<div class="prow"><div class="who">' + esc(S.names[i]) + tagtext + '</div>' +
      '<div class="d' + (s[i] < 0 ? " down" : "") + '">' + plus(s[i]) + '</div></div>';
  }
  const bal = sum(s) === 0
    ? '<p class="note calm">Adds up to zero, as it should.</p>'
    : '<p class="note bad">These do not balance. Something is wrong.</p>';
  return '<div class="preview">' + rows + '</div>' + bal;
}

function viewRound(){
  const d = S.draft;
  const n = S.names.length;
  const catchAsk = d.isCatch
    ? '<p class="seclabel">Who got caught?</p>' + seatButtons("caught", d.caught, d.winner) +
      (d.winner === null ? '<p class="note warn">Pick the winner first.</p>' : "")
    : "";
  return '<div class="card">' +
    '<div class="cardhead"><h2>Round ' + roundNo() + '</h2>' +
    '<div class="tally">' + n + ' <small>at the table</small></div></div>' +
    '<p class="sub">Only one player wins. Everyone else drops a point, or two if they were caught.</p>' +
    '<p class="seclabel">Who won?</p>' +
    seatButtons("winner", d.winner, null) +
    '<button class="btn small ghost' + (d.isCatch ? " on" : "") + '" data-act="catch">' +
      (d.isCatch ? "✓ " : "") + 'Won by catching a dhumbal call</button>' +
    catchAsk +
    roundPreview() +
    '<button class="btn" data-act="save"' + (draftReady() ? "" : " disabled") + '>' +
      (S.editing !== null ? "Save the correction" : "Save round " + roundNo()) + '</button>' +
    (S.editing !== null
      ? '<button class="btn ghost" data-act="cancel-edit">Cancel</button>'
      : '<button class="btn ghost" data-act="rename">Rename players</button>' +
        '<button class="btn ghost" data-act="finish"' + (S.rounds.length ? "" : " disabled") + '>' +
        'Finish the match</button>') +
    '</div>';
}

/* ---------- finished ---------- */
function standingsList(names, rounds){
  const tot = totalsOf(rounds, names.length);
  const order = names.map((_,i) => i).sort((a,b) => tot[b] - tot[a]);
  return '<ol class="standings">' + order.map((i,p) =>
    '<li class="' + (tot[i] < 0 ? "n" : "") + '"><span>' + (p+1) + '. ' + esc(names[i]) +
    '</span><span>' + plus(tot[i]) + '</span></li>').join("") + '</ol>';
}

function viewDone(){
  const tot = totals();
  const order = S.names.map((_,i) => i).sort((a,b) => tot[b] - tot[a]);
  const win = order[0];
  return '<div class="card final">' +
    '<p class="sub" style="margin-bottom:0">After ' + S.rounds.length +
      ' round' + (S.rounds.length === 1 ? "" : "s") + '</p>' +
    '<div class="champ">' + esc(S.names[win]) + '</div>' +
    '<div class="score">takes it with ' + plus(tot[win]) + '</div>' +
    standingsList(S.names, S.rounds) +
    '<p class="stamp" style="margin-top:14px">Started <b>' + clock(S.startedAt) + '</b> &middot; ' +
      'finished <b>' + clock(S.endedAt) + '</b> &middot; ' + span(S.startedAt, S.endedAt) + '</p>' +
    '<button class="btn" data-act="again">Play another match</button>' +
    '<button class="btn ghost" data-act="reopen">Add one more round</button>' +
    '<button class="btn ghost" data-act="fresh">New players</button>' +
    '</div>';
}

/* ---------- the points table, reused for live play and for history ---------- */
function padFor(title, names, rounds, live){
  const n = names.length;
  const tot = totalsOf(rounds, n);
  const best = tot.length ? Math.max.apply(null, tot) : 0;
  let body = "";

  for (let r = 0; r < rounds.length; r++){
    const done = rounds[r];
    const label = live
      ? '<button class="rlabel" data-act="edit" data-r="' + r + '">' + (r+1) + '</button>'
      : String(r+1);
    let cells = "";
    for (let i = 0; i < n; i++){
      const v = done.scores[i];
      const cls = (done.caught !== null && done.caught === i) ? "caught"
                : (v < 0 ? "neg" : "");
      cells += '<td class="' + cls + '">' + plus(v) + '</td>';
    }
    body += '<tr><td class="rlabel">' + label + '</td>' + cells + '</tr>';
  }
  if (!rounds.length){
    body = '<tr><td class="rlabel">1</td>' +
      names.map(() => '<td class="empty">&middot;</td>').join("") + '</tr>';
  }

  return '<div class="pad"><h2>' + title + '</h2><div class="padscroll"><table>' +
    '<thead><tr><th></th>' + names.map(x => '<th>' + esc(x) + '</th>').join("") + '</tr></thead>' +
    '<tbody>' + body + '</tbody>' +
    '<tfoot><tr><td class="rlabel"></td>' + tot.map(v =>
      '<td class="' + (v < 0 ? "neg " : "") + ((v === best && rounds.length > 0) ? "lead" : "") + '">' +
      plus(v) + '</td>').join("") + '</tr></tfoot></table></div>' +
    (live ? '<p class="padnote">' + (rounds.length
      ? "Tap a round number to correct it. A dotted score is the player who was caught."
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
      const tot = totalsOf(m.rounds, m.names.length);
      const w = tot.indexOf(Math.max.apply(null, tot));
      return '<li><button data-act="open" data-id="' + m.id + '">' +
        '<span><span class="win">' + esc(m.names[w]) + '</span>' +
        '<span class="meta">' + when(m.endedAt) + ' &middot; ' + m.rounds.length + ' rounds &middot; ' +
        m.names.map(esc).join(", ") + '</span></span>' +
        '<span class="pts' + (tot[w] < 0 ? " neg" : "") + '">' + plus(tot[w]) + '</span>' +
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
  const tot = totalsOf(m.rounds, m.names.length);
  const w = tot.indexOf(Math.max.apply(null, tot));
  return '<div class="card">' +
    '<div class="cardhead"><h2>' + esc(m.names[w]) + ' won</h2>' +
    '<div class="tally">' + plus(tot[w]) + '</div></div>' +
    '<p class="stamp">' +
      'Started <b>' + when(m.startedAt) + '</b><br>' +
      'Ended <b>' + when(m.endedAt) + '</b><br>' +
      'Played for <b>' + span(m.startedAt, m.endedAt) + '</b> over <b>' + m.rounds.length + '</b> rounds</p>' +
    standingsList(m.names, m.rounds) +
    '<button class="btn" data-act="closematch">Back to the table</button>' +
    '<button class="btn ghost danger" data-act="delmatch" data-id="' + m.id + '">Delete this match</button>' +
    '</div>' + padFor("Round by round", m.names, m.rounds, false);
}

/* ---------- input ---------- */
const app = document.getElementById("app");

function readRaw(n){
  const out = [];
  for (let i = 0; i < n; i++){
    const el = document.getElementById("n" + i);
    out.push(el ? el.value.trim() : (S.names[i] || ""));
  }
  return out;
}

function readNames(n){
  const names = [];
  for (let i = 0; i < n; i++){
    const el = document.getElementById("n" + i);
    const v = el ? el.value.trim() : "";
    names.push(v || ("Player " + (i+1)));
  }
  return names.map((x,i) => names.indexOf(x) !== i ? x + " " + (i+1) : x);
}

app.addEventListener("click", function(e){
  const el = e.target.closest("[data-act]");
  if (!el) return;
  const act = el.dataset.act;
  const d = S.draft;

  if (act === "more" || act === "fewer"){
    S.names = readRaw(S.count);
    S.count = Math.min(MAXP, Math.max(MINP, S.count + (act === "more" ? 1 : -1)));
    while (S.names.length < S.count) S.names.push("");
    S.names = S.names.slice(0, S.count);
    return render(false);
  }

  if (act === "start" || act === "rename-save"){
    S.names = readNames(S.count);
    if (act === "start"){ S.draft = freshDraft(); S.phase = "round"; beginMatch(); }
    else {
      S.phase = S.resume || "round"; S.resume = null;
      if (!S.draft && S.phase === "round") S.draft = freshDraft();
      if (S.archived) syncArchive();
    }
    return render(true);
  }

  if (act === "rename"){
    S.resume = "round"; S.phase = "setup"; S.count = S.names.length;
    render(true);
    const b = document.querySelector('[data-act="start"]');
    b.dataset.act = "rename-save"; b.textContent = "Save names";
    return;
  }

  if (act === "pick"){
    const i = +el.dataset.i;
    if (el.dataset.kind === "winner"){
      d.winner = (d.winner === i) ? null : i;
      if (d.caught === d.winner) d.caught = null;
    } else {
      d.caught = (d.caught === i) ? null : i;
    }
    return render(false);
  }

  if (act === "catch"){
    d.isCatch = !d.isCatch;
    if (!d.isCatch) d.caught = null;
    return render(false);
  }

  if (act === "save"){
    if (!draftReady()) return;
    const n = S.names.length;
    const caught = d.isCatch ? d.caught : null;
    const entry = { winner: d.winner, caught: caught, scores: scoreRound(n, d.winner, caught) };
    if (S.editing !== null){ S.rounds[S.editing] = entry; S.editing = null; }
    else S.rounds.push(entry);
    S.draft = freshDraft();
    S.phase = "round";
    if (S.archived) syncArchive();
    window.scrollTo({ top: 0, behavior: "smooth" });
    return render(true);
  }

  if (act === "finish"){
    if (!S.rounds.length) return;
    S.phase = "done"; S.draft = null;
    if (!S.archived){
      S.endedAt = new Date().toISOString();
      store.history.push({
        id: S.matchId, names: S.names.slice(), rounds: JSON.parse(JSON.stringify(S.rounds)),
        startedAt: S.startedAt, endedAt: S.endedAt
      });
      S.archived = true;
      saveStore();
    } else syncArchive();
    window.scrollTo({ top: 0, behavior: "smooth" });
    return render(true);
  }

  if (act === "reopen"){
    S.phase = "round"; S.draft = freshDraft();
    return render(true);
  }

  if (act === "edit"){
    const r = +el.dataset.r, old = S.rounds[r];
    S.editing = r;
    S.draft = { winner: old.winner, caught: old.caught, isCatch: old.caught !== null };
    S.phase = "round";
    window.scrollTo({ top: 0, behavior: "smooth" });
    return render(true);
  }

  if (act === "cancel-edit"){
    S.editing = null;
    S.draft = freshDraft();
    S.phase = "round";
    return render(true);
  }

  if (act === "again"){
    S.rounds = []; S.draft = freshDraft(); S.phase = "round"; beginMatch();
    return render(true);
  }

  if (act === "fresh"){
    S.phase = "setup"; S.screen = "play"; S.count = 4; S.names = ["","","",""]; S.rounds = [];
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
  const blob = new Blob([JSON.stringify({ version:1, game:"dhumbal",
    exportedAt:new Date().toISOString(), history: store.history }, null, 2)],
    { type:"application/json" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = "dhumbal-history-" + new Date().toISOString().slice(0,10) + ".json";
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
        if (m && m.id && !have[m.id] && Array.isArray(m.rounds) && Array.isArray(m.names)){
          store.history.push(m); added++;
        }
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
  S.names = Array.isArray(c.names) && c.names.length ? c.names : S.names;
  S.count = S.names.length;
  S.rounds = Array.isArray(c.rounds) ? c.rounds : [];
  S.draft = c.draft || null;
  S.editing = (c.editing === 0 || c.editing) ? c.editing : null;
  S.matchId = c.matchId || null;
  S.startedAt = c.startedAt || null;
  S.endedAt = c.endedAt || null;
  S.archived = !!c.archived;
  if (S.phase === "round" && !S.draft) S.draft = freshDraft();
}
render(false);
