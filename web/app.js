"use strict";

const S = {
  data: null,
  route: { kind: "home" },
  focus: { c: 0, r: 0 },
  open: null,
  pal: { mode: "search", items: [], sel: 0, prompt: null },
};

const STATUS_NAMES = { backlog: "Backlog", todo: "Todo", "in-progress": "In Progress", "in-review": "In Review", done: "Done", canceled: "Canceled" };
const PRI_NAMES = { urgent: "Urgent", high: "High", medium: "Medium", low: "Low", none: "No priority" };
const PRI_ORDER = { urgent: 0, high: 1, medium: 2, low: 3, none: 4 };
const OPEN = (c) => c.status !== "done" && c.status !== "canceled";

const PHONE = matchMedia("(max-width: 760px)");
PHONE.addEventListener("change", () => render());
const $ = (s) => document.querySelector(s);

// List groups fold on a tap. Done starts folded. The phone remembers the choice.
const FOLD = (() => { try { return JSON.parse(localStorage.getItem("track.fold")) || {}; } catch { return {}; } })();
const folded = (key) => (key in FOLD ? FOLD[key] : key === "done" || key === "canceled");
function toggleFold(key) {
  FOLD[key] = !folded(key);
  localStorage.setItem("track.fold", JSON.stringify(FOLD));
  render();
}
function groupHead(key, label, n, icon) {
  const f = folded(key);
  return `<button class="group-head" data-fold="${key}" aria-expanded="${!f}">${icon || ""}<span>${label}</span><span class="n">${n}</span>` +
    `<svg class="chev" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M6 9l6 6 6-6"/></svg></button>`;
}
const GRIP = `<span class="grip" aria-label="Drag to reorder"><svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><circle cx="9" cy="6" r="1.7"/><circle cx="15" cy="6" r="1.7"/><circle cx="9" cy="12" r="1.7"/><circle cx="15" cy="12" r="1.7"/><circle cx="9" cy="18" r="1.7"/><circle cx="15" cy="18" r="1.7"/></svg></span>`;
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[ch]);

// ---------- data ----------

async function api(method, path, body) {
  const res = await fetch(path, {
    method,
    headers: { "Content-Type": "application/json", "X-Track-Actor": "me" },
    body: body ? JSON.stringify(body) : undefined,
  });
  const out = await res.json().catch(() => ({}));
  if (!res.ok) {
    toast(out.error || "Something went wrong", true);
    throw new Error(out.error);
  }
  return out;
}

async function load() {
  S.data = await api("GET", "/api/state");
  render();
}

let reloadTimer;
function listen() {
  const es = new EventSource("/api/events");
  es.onmessage = () => {
    clearTimeout(reloadTimer);
    reloadTimer = setTimeout(load, 120);
  };
  es.onerror = () => {}; // The browser reconnects by itself.
}

const project = (key) => S.data.projects.find((p) => p.key === key);
const card = (id) => S.data.cards.find((c) => c.id === id);

async function patch(id, body) {
  const c = await api("PATCH", "/api/cards/" + encodeURIComponent(id), body);
  const i = S.data.cards.findIndex((x) => x.id === id);
  if (i >= 0) S.data.cards[i] = c;
  if (S.open === id) S.open = c.id;
  render();
  return c;
}

async function create(projectKey, title, extra = {}) {
  const c = await api("POST", "/api/cards", { project: projectKey, title, ...extra });
  S.data.cards.unshift(c);
  render();
  toast(`Added ${c.id}`);
  return c;
}

// ---------- filters (same rules as filter.go) ----------

function normStatus(s) {
  s = s.toLowerCase().replace(/[ _]/g, "-");
  return { progress: "in-progress", doing: "in-progress", started: "in-progress", wip: "in-progress", review: "in-review", cancelled: "canceled", cancel: "canceled" }[s] || s;
}

function matches(c, filter) {
  for (const tok of filter.split(/\s+/).filter(Boolean)) {
    const i = tok.indexOf(":");
    if (i < 1 || i === tok.length - 1) {
      if (!(c.id + " " + c.title + " " + c.body).toLowerCase().includes(tok.toLowerCase())) return false;
      continue;
    }
    const k = tok.slice(0, i).toLowerCase();
    const vals = tok.slice(i + 1).toLowerCase().split(",");
    const hit = vals.some((v) => {
      switch (k) {
        case "project": {
          const p = S.data.projects.find((p) => [p.key, p.prefix, p.name].some((x) => x.toLowerCase() === v));
          return p && p.key === c.project;
        }
        case "status": return v === "open" ? OPEN(c) : normStatus(v) === c.status;
        case "priority": return v === c.priority;
        case "label": return c.labels.some((l) => l.toLowerCase() === v);
        case "assignee": return v === (c.assignee || "none");
        default: return c.title.toLowerCase().includes(tok.toLowerCase());
      }
    });
    if (!hit) return false;
  }
  return true;
}

const byPriority = (a, b) => PRI_ORDER[a.priority] - PRI_ORDER[b.priority] || (b.updated > a.updated ? 1 : -1);
const byUpdated = (a, b) => (b.updated > a.updated ? 1 : -1);
// The order you set by hand wins. Cards you have not placed yet sit on top, by priority.
const byRank = (a, b) => (!a.rank && !b.rank ? byPriority(a, b) : !a.rank ? -1 : !b.rank ? 1 : a.rank - b.rank);

// Projects open as a list. The Board stays one click away and the choice is remembered.
const listMode = () => S.route.kind === "project" && (PHONE.matches || localStorage.getItem("track.view") !== "board");
const LIST_ORDER = ["in-progress", "in-review", "todo", "backlog", "done", "canceled"];
const CLOSED = (st) => st === "done" || st === "canceled";

// ---------- routing ----------

// The open card rides in the URL (#/p/vigi?c=VIGI-3). Opening one is a step in
// history, so the phone's back swipe closes the card and stays on the page.
function parseRoute() {
  const [path, query] = location.hash.replace(/^#\/?/, "").split("?c=");
  const h = decodeURIComponent(path);
  const open = query ? decodeURIComponent(query) : null;
  if (h === "inbox") return { kind: "inbox", open };
  if (h.startsWith("p/")) return { kind: "project", key: h.slice(2), open };
  if (h.startsWith("v/")) return { kind: "view", key: h.slice(2), open };
  return { kind: "home", open };
}

function baseHash() {
  return "#/" + location.hash.replace(/^#\/?/, "").split("?c=")[0];
}

function go(hash) {
  if (location.hash === hash) return;
  location.hash = hash;
}

let pushedCard = false;
function showCard(id) {
  S.open = id;
  const want = baseHash() + "?c=" + encodeURIComponent(id);
  if (location.hash === want) return render();
  if (S.route.open) history.replaceState(null, "", want);
  else { history.pushState(null, "", want); pushedCard = true; }
  S.route = parseRoute();
  render();
}

function closeCard() {
  if (!S.route.open) { S.open = null; return render(); }
  if (pushedCard) { pushedCard = false; history.back(); return; }
  history.replaceState(null, "", baseHash());
  S.route = parseRoute();
  S.open = null;
  render();
}

window.addEventListener("hashchange", () => onRoute());
window.addEventListener("popstate", () => onRoute());
function onRoute() {
  const before = S.route;
  S.route = parseRoute();
  const samePage = before.kind === S.route.kind && before.key === S.route.key;
  // Closing a card is not a new page. Keep the place in the list.
  if (!samePage) { S.focus = { c: 0, r: 0 }; S.pageChanged = true; }
  if (!S.route.open) pushedCard = false;
  S.open = S.route.open;
  if (S.open) focusCard(S.open);
  document.getElementById("app").classList.remove("menu-open");
  render();
}

// The cards on screen, as columns. A list page is one column. Keyboard moves use this.
function layout() {
  const cards = S.data.cards;
  const r = S.route;
  if (r.kind === "project") {
    const cols = projectCols(r.key);
    if (!listMode()) return cols;
    // The list is one column in screen order, so the arrow keys walk it top to bottom.
    return [{ cards: listGroups(cols).flatMap((g) => (folded(g.status) ? [] : shown(g))) }];
  }
  if (r.kind === "inbox") return [{ cards: cards.filter((c) => c.project === "inbox" && OPEN(c)).sort(byUpdated) }];
  if (r.kind === "view") {
    const v = S.data.views.find((v) => v.name === r.key);
    const list = v ? cards.filter((c) => matches(c, v.filter)) : [];
    const so = S.data.statuses;
    return [{ cards: list.sort((a, b) => so.indexOf(a.status) - so.indexOf(b.status) || byPriority(a, b)) }];
  }
  return [{ cards: homeCards(cards) }];
}

// Home is your life and your Inbox: the IRL work you have said yes to (In
// Progress, In Review, Todo) plus everything not yet filed. Work projects
// keep their own tabs.
const HOME = ["in-progress", "in-review", "todo"];
const homeCards = (cards) => [
  ...cards.filter((c) => c.project === "inbox" && OPEN(c)).sort(byUpdated),
  ...cards.filter((c) => c.project === "irl" && HOME.includes(c.status)).sort(byHome),
];
const byHome = (a, b) => HOME.indexOf(a.status) - HOME.indexOf(b.status) || byDue(a, b) || byPriority(a, b);
const byDue = (a, b) => (a.due || "9999") < (b.due || "9999") ? -1 : (a.due || "9999") > (b.due || "9999") ? 1 : 0;

const projectCols = (key) => S.data.statuses.map((st) => {
  const list = S.data.cards.filter((c) => c.project === key && c.status === st);
  return { status: st, cards: list.sort(CLOSED(st) ? byUpdated : byRank) };
});
const listGroups = (cols) => LIST_ORDER.map((st) => cols.find((col) => col.status === st)).filter((col) => col && col.cards.length);
const shown = (g) => (g.status === "done" ? g.cards.slice(0, 10) : g.cards);

function focused() {
  const cols = layout();
  const col = cols[S.focus.c];
  return col && col.cards[S.focus.r];
}

function focusCard(id) {
  const cols = layout();
  cols.forEach((col, c) => col.cards.forEach((x, r) => { if (x.id === id) S.focus = { c, r }; }));
}

// ---------- render ----------

function statusIcon(st) { return `<span class="st ${st}" title="${STATUS_NAMES[st]}"></span>`; }
function priIcon(p) {
  if (p === "urgent") return `<span class="pri-urgent" title="Urgent">!</span>`;
  if (p === "none") return "";
  return `<span class="pri ${p}" title="${PRI_NAMES[p]}"><i></i><i></i><i></i></span>`;
}
function projChip(c) {
  const p = project(c.project);
  return p ? `<span class="chip"><span class="dot" style="background:${esc(p.color)}"></span>${esc(p.name)}</span>` : "";
}
function dueChip(c) {
  if (!c.due) return "";
  const late = OPEN(c) && c.due < new Date().toISOString().slice(0, 10);
  return `<span class="chip ${late ? "late" : ""}">${esc(c.due)}</span>`;
}
function metaChips(c, opt) {
  return c.labels.map((l) => `<span class="chip ${opt || ""}">${esc(l)}</span>`).join("") + dueChip(c) +
    (c.assignee ? `<span class="chip">@${esc(c.assignee)}</span>` : "");
}

function renderNav() {
  const cards = S.data.cards;
  const r = S.route;
  const item = (hash, label, count, active, dot) =>
    `<button class="nav-item ${active ? "active" : ""}" data-go="${hash}">${dot || ""}<span>${esc(label)}</span>${count ? `<span class="count">${count}</span>` : ""}</button>`;
  let h = item("#/", "Home", homeCards(cards).length, r.kind === "home", "");
  h += item("#/inbox", "Inbox", cards.filter((c) => c.project === "inbox" && OPEN(c)).length, r.kind === "inbox");
  h += `<div class="nav-head">Projects</div>`;
  for (const p of S.data.projects.filter((p) => p.key !== "inbox")) {
    const n = cards.filter((c) => c.project === p.key && OPEN(c)).length;
    h += item("#/p/" + encodeURIComponent(p.key), p.name, n, r.kind === "project" && r.key === p.key, `<span class="dot" style="background:${esc(p.color)}"></span>`);
  }
  if (S.data.views.length) {
    h += `<div class="nav-head">Views</div>`;
    for (const v of S.data.views) h += item("#/v/" + encodeURIComponent(v.name), v.name, 0, r.kind === "view" && r.key === v.name);
  }
  $("#nav").innerHTML = h;
}

// On a phone the sidebar hides, so every page sits in one row of pills under the title.
function renderPills() {
  const cards = S.data.cards;
  const r = S.route;
  const pill = (hash, label, n, on, color) =>
    `<button class="pill ${on ? "on" : ""}" data-go="${hash}">${color ? `<span class="dot" style="background:${esc(color)}"></span>` : ""}${esc(label)}${n ? `<span class="n">${n}</span>` : ""}</button>`;
  let h = `<button class="pill icon" id="search" aria-label="Search"><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="11" cy="11" r="7"/><path d="M20 20l-3.5-3.5"/></svg></button>`;
  h += pill("#/", "Home", 0, r.kind === "home");
  const inbox = cards.filter((c) => c.project === "inbox" && OPEN(c)).length;
  if (inbox || r.kind === "inbox") h += pill("#/inbox", "Inbox", inbox, r.kind === "inbox");
  for (const p of S.data.projects.filter((p) => p.key !== "inbox")) {
    h += pill("#/p/" + encodeURIComponent(p.key), p.name, cards.filter((c) => c.project === p.key && OPEN(c)).length, r.kind === "project" && r.key === p.key, p.color);
  }
  for (const v of S.data.views) h += pill("#/v/" + encodeURIComponent(v.name), v.name, 0, r.kind === "view" && r.key === v.name);
  const el = $("#pills");
  const left = el.scrollLeft;
  el.innerHTML = h;
  el.scrollLeft = left;
  const on = el.querySelector(".on");
  // Bring the current page's pill into view when the page changes, and only then.
  if (on && S.pageChanged) el.scrollTo({ left: on.offsetLeft - (el.clientWidth - on.offsetWidth) / 2, behavior: "smooth" });
}

function pageName() {
  const r = S.route;
  if (r.kind === "inbox") return "Inbox";
  if (r.kind === "project") return project(r.key)?.name || "Project";
  if (r.kind === "view") return r.key;
  return "Home";
}

function renderMain() {
  const r = S.route;
  const name = pageName();
  document.title = `Track | ${name}`;
  const p = r.kind === "project" ? project(r.key) : null;
  $("#title").innerHTML = (p ? `<span class="dot" style="background:${esc(p.color)}"></span>` : "") + esc(name) +
    (r.kind === "view" ? ` <span class="chip">${esc(S.data.views.find((v) => v.name === r.key)?.filter || "")}</span>` : "");
  $("#top-actions").innerHTML = (p && !PHONE.matches ? `<button class="btn" id="view-switch">${listMode() ? "Board" : "List"}</button>` : "") +
    `<button class="btn primary" id="new-card">New card</button>`;

  const br = S.data.broken;
  $("#broken").hidden = !br.length;
  $("#broken").innerHTML = br.map((b) => `Cannot read ${esc(b.path)}: ${esc(b.error)}`).join("<br>");

  const keep = { top: $("#content").scrollTop, left: $("#content").scrollLeft };
  const cols = layout();
  S.focus.c = Math.max(0, Math.min(S.focus.c, cols.length - 1));
  if (!cols[S.focus.c].cards.length) {
    const first = cols.findIndex((col) => col.cards.length);
    if (first >= 0) S.focus = { c: first, r: 0 };
  }
  S.focus.r = Math.max(0, Math.min(S.focus.r, cols[S.focus.c].cards.length - 1));
  const f = focused();

  const sortable = r.kind === "project" && listMode();
  const row = (c, showProject) => {
    // The outermost element of each row carries data-sort, so a drag moves the whole thing.
    const wrapped = PHONE.matches && OPEN(c);
    const tag = sortable && !wrapped ? ` data-sort="${esc(c.id)}"` : "";
    const inner = PHONE.matches ? `
      <div class="row m ${OPEN(c) ? "" : "closed"}" data-id="${esc(c.id)}"${tag}>
        ${statusIcon(c.status)}
        <div class="rb"><span class="t">${esc(c.title)}</span>
          <span class="meta">${priIcon(c.priority)}<span class="id">${esc(c.id)}</span>${metaChips(c, "opt")}${showProject ? projChip(c) : ""}</span></div>
        ${sortable ? GRIP : ""}
      </div>` : `
      <div class="row ${f && f.id === c.id ? "focus" : ""}" data-id="${esc(c.id)}"${tag}>
        ${statusIcon(c.status)} ${priIcon(c.priority) || `<span style="width:13px"></span>`}
        <span class="id">${esc(c.id)}</span><span class="t">${esc(c.title)}</span>
        <span class="chips">${metaChips(c, "opt")}${showProject ? projChip(c) : ""}</span>
      </div>`;
    if (!wrapped) return inner;
    return `<div class="swipe" data-id="${esc(c.id)}"${sortable ? ` data-sort="${esc(c.id)}"` : ""}>
        <div class="sw-left"><button data-sw="canceled">Cancel</button></div>
        <div class="sw-right">${c.status !== "in-progress" ? `<button data-sw="in-progress">Start</button>` : ""}<button data-sw="done">Done</button></div>
        ${inner}</div>`;
  };
  // A project reads as one list, grouped by status, with the active work first.
  // Drag a row to put it in your own order, or into another group to change its status.
  if (r.kind === "project" && listMode()) {
    const groups = listGroups(projectCols(r.key));
    $("#content").innerHTML = groups.length ? `<div class="list sortable">` + groups.map((col) =>
      groupHead(col.status, STATUS_NAMES[col.status], col.cards.length, statusIcon(col.status)) +
      (folded(col.status) ? "" : shown(col).map((c) => row(c, false)).join(""))).join("") + `</div>`
      : `<div class="empty">No cards yet.</div>`;
  } else if (r.kind === "project") {
    $("#content").innerHTML = `<div class="board">` + cols.map((col, ci) => `
      <div class="col ${col.status === "done" || col.status === "canceled" ? "narrow" : ""}" data-status="${col.status}">
        <div class="col-head">${statusIcon(col.status)} ${STATUS_NAMES[col.status]} <span class="n">${col.cards.length}</span>
          <button class="add" data-add="${col.status}" title="Add a card">+</button></div>
        <div class="col-body">${col.cards.map((c) => `
          <div class="card ${f && f.id === c.id ? "focus" : ""} ${S.open === c.id ? "open" : ""}" draggable="true" data-id="${esc(c.id)}">
            <div class="card-top">${esc(c.id)} ${priIcon(c.priority)}</div>
            <div class="card-title">${esc(c.title)}</div>
            ${c.labels.length || c.due || c.assignee ? `<div class="card-meta">${metaChips(c)}</div>` : ""}
          </div>`).join("")}</div>
      </div>`).join("") + `</div>`;
  } else {
    const list = cols[0].cards;
    let head = "";
    if (r.kind === "inbox") {
      head = `<div class="hint">Cards with no project yet. Open one to file it.</div>`;
    }
    const empty = {
      home: "Nothing to do.<br>Your Inbox and your IRL cards in Todo, In Progress and In Review show here.",
      inbox: "The Inbox is empty.",
      view: "No cards match this view.",
    }[r.kind];
    let body = "";
    if (r.kind === "home" && list.length) {
      // Grouped by status, so the one thing you are doing is not lost among the rest.
      const inbox = list.filter((c) => c.project === "inbox");
      body = `<div class="list">` +
        (inbox.length ? groupHead("inbox", "Inbox", inbox.length) + (folded("inbox") ? "" : inbox.map((c) => row(c, false)).join("")) : "") +
        HOME.map((st) => {
          const g = list.filter((c) => c.project !== "inbox" && c.status === st);
          return g.length ? groupHead(st, STATUS_NAMES[st], g.length, statusIcon(st)) + (folded(st) ? "" : g.map((c) => row(c, true)).join("")) : "";
        }).join("") + `</div>`;
    } else if (list.length) {
      body = `<div class="list">` + list.map((c) => row(c, r.kind !== "inbox")).join("") + `</div>`;
    } else body = `<div class="empty">${empty}</div>`;
    $("#content").innerHTML = head + body;
  }
  const sc = $("#content");
  if (S.pageChanged) { sc.scrollTop = 0; sc.scrollLeft = 0; animate(sc, "page-in"); }
  else { sc.scrollTop = keep.top; sc.scrollLeft = keep.left; }
  // Follow the selection only when the keyboard moved it. A tap or a swipe keeps your place.
  if (S.kbd) {
    const el = document.querySelector(".focus");
    if (el) el.scrollIntoView({ block: "nearest", inline: "nearest", behavior: "smooth" });
  }
}

function movePills(c, cls) {
  return `<div class="move ${cls}">` + S.data.projects.filter((p) => p.key !== "inbox").map((p) =>
    `<button data-move="${esc(p.key)}" data-id="${esc(c.id)}"><span class="dot" style="background:${esc(p.color)}"></span>${esc(p.name)}</button>`).join("") + `</div>`;
}

async function moveProject(id, key) {
  const before = card(id);
  if (!before) return;
  const from = before.project;
  const c = await patch(id, { project: key });
  // The id changes with the project (IN-4 becomes VIGI-11). Follow it.
  if (S.open === id || S.route.open === id) {
    S.open = null;
    history.replaceState(null, "", baseHash());
    S.route = parseRoute();
    render();
  }
  toast(`Moved to ${project(key).name} as ${c.id}`, false, { label: "Undo", run: () => patch(c.id, { project: from }) });
}

function renderPanel() {
  const panel = $("#panel");
  const c = S.open && card(S.open);
  if (!c) {
    S.open = null;
    if (!panel.hidden && !panel.classList.contains("panel-out")) {
      panel.classList.add("panel-out");
      panel.addEventListener("animationend", () => { panel.hidden = true; panel.classList.remove("panel-out"); }, { once: true });
    }
    return;
  }
  // Leave the panel alone while you type in it. A live update redraws it after.
  if (panel.contains(document.activeElement) && /INPUT|TEXTAREA/.test(document.activeElement.tagName) && panel.dataset.id === c.id) return;
  if (panel.hidden || panel.classList.contains("panel-out")) {
    panel.classList.remove("panel-out");
    panel.hidden = false;
    animate(panel, "panel-in");
  }
  panel.dataset.id = c.id;
  const opt = (list, cur, names) => list.map((v) => `<option value="${esc(v)}" ${v === cur ? "selected" : ""}>${esc(names ? names[v] : v)}</option>`).join("");
  const acts = c.activity.map((a) => {
    const m = a.match(/^(\d{4}-\d\d-\d\d \d\d:\d\d) (\S+?)( noted)?: (.*)$/);
    if (!m) return `<div class="act">${esc(a)}</div>`;
    return `<div class="act ${m[3] ? "note" : ""}"><span class="when">${esc(m[1])}</span>${esc(m[2])}${m[3] ? "" : ":"} ${esc(m[4])}</div>`;
  }).join("");
  panel.innerHTML = `
    <div class="p-top"><button class="back" data-close>‹ Back</button>${projChip(c)} <span>${esc(c.id)}</span><button class="x" data-close title="Close (Esc)">×</button></div>
    ${c.project === "inbox" ? `<div class="p-sec first">Which project is this for?</div>${movePills(c, "in-panel")}` : ""}
    <textarea class="p-title" rows="1" data-f="title">${esc(c.title)}</textarea>
    <div class="p-fields">
      <label>Status</label><select data-f="status">${opt(S.data.statuses, c.status, STATUS_NAMES)}</select>
      <label>Priority</label><select data-f="priority">${opt(S.data.priorities, c.priority, PRI_NAMES)}</select>
      <label>Assignee</label><select data-f="assignee">${opt(["", "me", "agent"], c.assignee, { "": "Nobody", me: "Me", agent: "Agent" })}</select>
      <label>Project</label><select data-f="project">${S.data.projects.map((p) => `<option value="${esc(p.key)}" ${p.key === c.project ? "selected" : ""}>${esc(p.name)}</option>`).join("")}</select>
      <label>Labels</label><input data-f="labels" value="${esc(c.labels.join(", "))}" placeholder="bug, ui">
      <label>Due</label><input data-f="due" type="date" value="${esc(c.due)}">
      <label>Parent</label><input data-f="parent" value="${esc(c.parent)}" placeholder="WEB-10">
    </div>
    <textarea class="p-body" data-f="body" placeholder="Add a description">${esc(c.body)}</textarea>
    <div class="p-sec">Activity</div>
    ${acts}
    <input class="p-note" data-note placeholder="Add a note and press Enter">
    <div class="p-path">cards/${esc(c.project)}/${esc(c.id)}…md · created ${esc(c.created)} · updated ${esc(c.updated)}</div>`;
  const t = panel.querySelector(".p-title");
  t.style.height = "auto";
  t.style.height = t.scrollHeight + "px";
}

function render() {
  if (!S.data) return;
  // A redraw mid-drag would pull the row out from under the pointer. The drop redraws.
  if (sort && sort.on) return;
  renderNav();
  renderPills();
  renderMain();
  renderPanel();
  S.pageChanged = false;
  S.kbd = false;
}

// Play a one-shot CSS animation on an element.
function animate(el, name) {
  el.classList.remove(name);
  void el.offsetWidth;
  el.classList.add(name);
  el.addEventListener("animationend", () => el.classList.remove(name), { once: true });
}

function openCard(id) {
  const c = card(id);
  if (!c) return;
  const visible = layout().some((col) => col.cards.some((x) => x.id === id));
  if (!visible) {
    const hash = c.project === "inbox" ? "#/inbox" : "#/p/" + encodeURIComponent(c.project);
    history.pushState(null, "", hash);
    S.route = parseRoute();
    S.focus = { c: 0, r: 0 };
  }
  focusCard(id);
  showCard(id);
}

// ---------- events ----------

document.addEventListener("click", (e) => {
  const t = e.target;
  const fold = t.closest("[data-fold]");
  if (fold) return toggleFold(fold.dataset.fold);
  const goEl = t.closest("[data-go]");
  if (goEl) return go(goEl.dataset.go);
  if (t.closest("#menu")) return document.getElementById("app").classList.toggle("menu-open");
  if (t.closest("#open-palette")) return openPalette();
  if (t.closest("[data-close]")) return closeCard();
  const sw = t.closest("[data-sw]");
  if (sw) return swipeAct(sw.closest(".swipe").dataset.id, sw.dataset.sw);
  if (openSwipe) { closeSwipe(); if (t.closest(".swipe")) return; }
  if (t.closest("#new-card") || t.closest("#fab")) return PHONE.matches ? openSheet() : newCardPrompt();
  if (t.closest("#search")) return openPalette();
  if (t.closest("#view-switch")) {
    localStorage.setItem("track.view", listMode() ? "board" : "list");
    S.focus = { c: 0, r: 0 };
    return render();
  }
  if (t.closest("[data-sheet-close]") || t.id === "sheet") return closeSheet();
  const pk = t.closest("[data-pick]");
  if (pk) { pk.parentElement.querySelectorAll(".on").forEach((x) => x.classList.remove("on")); pk.classList.add("on"); return; }
  const mv = t.closest("[data-move]");
  if (mv) return moveProject(mv.dataset.id, mv.dataset.move);
  const add = t.closest("[data-add]");
  if (add) return PHONE.matches ? openSheet(S.route.key, add.dataset.add) : newCardPrompt(S.route.key, add.dataset.add);
  const el = t.closest(".card, .row");
  if (el) {
    if (Date.now() - swipedAt < 400 || Date.now() - sortedAt < 400) return;
    focusCard(el.dataset.id);
    return showCard(el.dataset.id);
  }
  if (!t.closest("#side") && !t.closest("#menu")) document.getElementById("app").classList.remove("menu-open");
});

// Panel edits save when a field changes or loses focus.
document.addEventListener("change", (e) => {
  const f = e.target.dataset && e.target.dataset.f;
  if (!f || !S.open) return;
  let v = e.target.value;
  if (f === "labels") v = v.split(",").map((s) => s.trim()).filter(Boolean);
  if (f === "title" && !v.trim()) return;
  patch(S.open, { [f]: v });
});

document.addEventListener("input", (e) => {
  if (e.target.classList.contains("p-title")) {
    e.target.style.height = "auto";
    e.target.style.height = e.target.scrollHeight + "px";
  }
});

let dragId = null;
document.addEventListener("dragstart", (e) => {
  const el = e.target.closest && e.target.closest(".card");
  if (el) { dragId = el.dataset.id; e.dataTransfer.effectAllowed = "move"; }
});
document.addEventListener("dragover", (e) => {
  const col = e.target.closest && e.target.closest(".col");
  if (!col || !dragId) return;
  e.preventDefault();
  document.querySelectorAll(".col.drop").forEach((c) => c !== col && c.classList.remove("drop"));
  col.classList.add("drop");
});
document.addEventListener("drop", (e) => {
  const col = e.target.closest && e.target.closest(".col");
  document.querySelectorAll(".col.drop").forEach((c) => c.classList.remove("drop"));
  if (col && dragId) {
    e.preventDefault();
    const c = card(dragId);
    if (c && c.status !== col.dataset.status) patch(dragId, { status: col.dataset.status }).then(() => { focusCard(c.id); render(); });
  }
  dragId = null;
});

document.addEventListener("keydown", (e) => {
  if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
    e.preventDefault();
    return $("#palette").hidden ? openPalette() : closePalette();
  }
  if (!$("#palette").hidden) return paletteKey(e);

  const tag = document.activeElement && document.activeElement.tagName;
  const typing = /INPUT|TEXTAREA|SELECT/.test(tag);
  if (typing) {
    const el = document.activeElement;
    if (e.key === "Escape") return el.blur();
    if (e.key === "Enter" && el.dataset.note !== undefined && el.value.trim()) {
      const text = el.value;
      el.value = "";
      el.blur();
      return patch(S.open, { note: text });
    }
    if (e.key === "Enter" && el.classList.contains("p-title")) { e.preventDefault(); return el.blur(); }
    if (e.key === "Enter" && el.tagName === "INPUT") return el.blur();
    return;
  }
  const cols = layout();
  const f = S.focus;
  switch (e.key) {
    case "ArrowDown": f.r = Math.min(f.r + 1, cols[f.c].cards.length - 1); break;
    case "ArrowUp": f.r = Math.max(f.r - 1, 0); break;
    case "ArrowRight":
    case "ArrowLeft": {
      const d = e.key === "ArrowRight" ? 1 : -1;
      if (e.shiftKey && S.route.kind === "project") {
        const c = focused();
        const st = c && S.data.statuses[S.data.statuses.indexOf(c.status) + d];
        if (c && st) {
          e.preventDefault();
          patch(c.id, { status: st }).then(() => { focusCard(c.id); render(); });
        }
        return;
      }
      let nc = f.c + d;
      // Skip empty columns so the focus lands on a card.
      while (cols[nc] && !cols[nc].cards.length) nc += d;
      if (!cols[nc]) return;
      f.c = nc;
      f.r = Math.min(f.r, cols[nc].cards.length - 1);
      break;
    }
    case "Enter": { const c = focused(); if (c) { e.preventDefault(); return showCard(c.id); } return; }
    case "Escape": e.preventDefault(); return closeCard();
    default: return;
  }
  e.preventDefault();
  S.kbd = true;
  if (S.open && e.key.startsWith("Arrow")) { const c = focused(); if (c) return showCard(c.id); }
  render();
});

// ---------- new card sheet (phone) ----------
// The project is picked right here, so a card made on the phone never lands in the Inbox by accident.

function openSheet(projectKey, status) {
  const r = S.route;
  const key = projectKey || (r.kind === "project" ? r.key : localStorage.getItem("track.lastProject") || S.data.projects.find((p) => p.key !== "inbox").key);
  const st = status || "todo";
  $("#sheet-projects").innerHTML = S.data.projects.filter((p) => p.key !== "inbox").map((p) =>
    `<button type="button" data-pick="${esc(p.key)}" class="${p.key === key ? "on" : ""}"><span class="dot" style="background:${esc(p.color)}"></span>${esc(p.name)}</button>`).join("") +
    `<button type="button" data-pick="inbox" class="${key === "inbox" ? "on" : ""}">Not sure</button>`;
  $("#sheet-status").innerHTML = ["todo", "in-progress", "backlog"].map((s) =>
    `<button type="button" data-pick="${s}" class="${s === st ? "on" : ""}">${statusIcon(s)} ${STATUS_NAMES[s]}</button>`).join("");
  $("#sheet").hidden = false;
  animate($("#sheet"), "sheet-in");
  const t = $("#sheet-title");
  t.value = "";
  t.focus();
}

function closeSheet() {
  const sh = $("#sheet");
  $("#sheet-title").blur();
  if (sh.hidden) return;
  sh.classList.add("sheet-out");
  sh.addEventListener("animationend", () => { sh.hidden = true; sh.classList.remove("sheet-out"); }, { once: true });
}

$("#sheet form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const title = $("#sheet-title").value.trim();
  if (!title) return $("#sheet-title").focus();
  const key = $("#sheet-projects .on")?.dataset.pick || "inbox";
  const status = $("#sheet-status .on")?.dataset.pick || "todo";
  if (key !== "inbox") localStorage.setItem("track.lastProject", key);
  closeSheet();
  await create(key, title, { status });
});
$("#sheet-title").addEventListener("keydown", (e) => {
  if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); $("#sheet form").requestSubmit(); }
  if (e.key === "Escape") closeSheet();
});

// ---------- reorder (list) ----------
// Drag a row with the mouse, or by its grip on the phone. A line shows where it
// will land. Dropping it in another group also changes its status.

let sort = null;
let sortedAt = 0;

document.addEventListener("pointerdown", (e) => {
  const list = e.target.closest(".list.sortable");
  if (!list || e.button !== 0) return;
  const grip = e.target.closest(".grip");
  if (e.pointerType !== "mouse" && !grip) return;
  const el = e.target.closest("[data-sort]");
  if (!el) return;
  const sc = $("#content");
  sort = { el, list, sc, id: el.dataset.sort, pid: e.pointerId, y0: e.clientY, y: e.clientY, scroll0: sc.scrollTop, on: false, raf: 0, line: null };
  if (grip) { e.preventDefault(); beginSort(); }
});

function beginSort() {
  sort.on = true;
  closeSwipe();
  getSelection().removeAllRanges();
  sort.el.classList.add("lifting");
  document.body.classList.add("sorting");
  sort.line = document.createElement("div");
  sort.line.className = "drop-line";
}

document.addEventListener("pointermove", (e) => {
  if (!sort || e.pointerId !== sort.pid) return;
  if (!document.body.contains(sort.el)) { sort = null; return; }
  sort.y = e.clientY;
  if (!sort.on) {
    if (Math.abs(e.clientY - sort.y0) < 6) return;
    beginSort();
  }
  e.preventDefault();
  if (!sort.raf) sort.raf = requestAnimationFrame(sortFrame);
}, { passive: false });

function sortFrame() {
  const s = sort;
  if (!s) return;
  s.raf = 0;
  // Near the top or bottom edge the list scrolls by itself.
  const box = s.sc.getBoundingClientRect();
  const edge = 56;
  const v = s.y < box.top + edge ? -(box.top + edge - s.y) / 3 : s.y > box.bottom - edge ? (s.y - box.bottom + edge) / 3 : 0;
  if (v) { s.sc.scrollTop += v; s.raf = requestAnimationFrame(sortFrame); }
  s.el.style.transform = `translateY(${s.y - s.y0 + s.sc.scrollTop - s.scroll0}px)`;
  const items = [...s.list.querySelectorAll("[data-sort], .group-head")].filter((x) => x !== s.el);
  let before = items.find((x) => { const b = x.getBoundingClientRect(); return s.y < b.top + b.height / 2; }) || null;
  // Above the first group still means the top of the first group.
  if (before && before === items[0] && before.classList.contains("group-head")) before = before.nextElementSibling;
  if (before === s.line) return;
  s.list.insertBefore(s.line, before);
}

async function endSort(e) {
  const s = sort;
  if (!s || e.pointerId !== s.pid) return;
  if (!s.on) { sort = null; return; }
  // Place the line for the final spot, in case the last move has not drawn yet.
  if (s.raf) cancelAnimationFrame(s.raf);
  sortFrame();
  if (s.raf) cancelAnimationFrame(s.raf);
  sort = null;
  sortedAt = Date.now();
  document.body.classList.remove("sorting");
  s.el.classList.remove("lifting");
  s.el.style.transform = "";
  let head = null, idx = 0;
  for (let x = s.line.previousElementSibling; x; x = x.previousElementSibling) {
    if (x.classList.contains("group-head")) { head = x; break; }
    if (x !== s.el && x.dataset.sort) idx++;
  }
  s.line.remove();
  const c = card(s.id);
  if (e.type === "pointercancel" || !head || !c) return render();
  const st = head.dataset.fold;
  // Done and Canceled keep the newest first, so a drop there only changes the status.
  if (CLOSED(st)) return c.status === st ? render() : patch(c.id, { status: st });
  const ids = projectCols(c.project).find((col) => col.status === st).cards.map((x) => x.id).filter((id) => id !== c.id);
  ids.splice(idx, 0, c.id);
  ids.forEach((id, i) => { const x = card(id); x.rank = i + 1; x.status = st; });
  focusCard(c.id);
  render();
  await api("POST", "/api/order", { status: st, ids }).catch(() => load());
}
document.addEventListener("pointerup", endSort);
document.addEventListener("pointercancel", endSort);

// ---------- swipe (phone) ----------
// Like Mail: a short swipe opens the buttons, a long one does the action.
// Swipe left for Start and Done, right for Cancel. Every swipe can be undone.

let openSwipe = null;
let swipedAt = 0;
let drag = null;
// A long pull past 38% of the width, or a quick flick, does the action on release.
const FULL = 0.38;
const FLICK = 0.6; // px per ms

function rowOf(el) { return el.querySelector(".row"); }
const EASE = "cubic-bezier(.22, .9, .25, 1)";
function setX(el, x, smooth) {
  const r = rowOf(el);
  r.style.transition = smooth ? `transform .32s ${EASE}` : "none";
  r.style.transform = x ? `translate3d(${x}px,0,0)` : "";
  el.classList.toggle("sw-l", x > 0);
  el.classList.toggle("sw-r", x < 0);
  const full = Math.abs(x) > el.offsetWidth * FULL;
  el.classList.toggle("sw-full", full);
}
function closeSwipe() {
  if (openSwipe && document.body.contains(openSwipe)) setX(openSwipe, 0, true);
  openSwipe = null;
}

document.addEventListener("touchstart", (e) => {
  const el = e.target.closest(".swipe");
  if (!el || e.target.closest("[data-sw]") || e.target.closest(".grip")) return;
  if (openSwipe && openSwipe !== el) closeSwipe();
  const t = e.touches[0];
  // An open row starts from where it sits, so a second swipe carries on from there.
  const base = openSwipe === el ? parseFloat((rowOf(el).style.transform.match(/-?[\d.]+/) || [0])[0]) : 0;
  drag = { el, x0: t.clientX, y0: t.clientY, base, dx: 0, dir: null, frame: 0, lastX: t.clientX, lastT: e.timeStamp, v: 0 };
}, { passive: true });

document.addEventListener("touchmove", (e) => {
  if (!drag) return;
  const t = e.touches[0];
  const dx = t.clientX - drag.x0, dy = t.clientY - drag.y0;
  if (!drag.dir) {
    if (Math.abs(dx) < 8 && Math.abs(dy) < 8) return;
    drag.dir = Math.abs(dx) > Math.abs(dy) ? "x" : "y";
  }
  if (drag.dir !== "x") return;
  e.preventDefault();
  // Speed over the last move, smoothed, so a flick can finish the action.
  const dt = Math.max(1, e.timeStamp - drag.lastT);
  drag.v = 0.6 * ((t.clientX - drag.lastX) / dt) + 0.4 * drag.v;
  drag.lastX = t.clientX;
  drag.lastT = e.timeStamp;
  const w = drag.el.offsetWidth;
  let x = drag.base + dx;
  // Past most of the width the row slows down, so it feels held rather than loose.
  const lim = w * 0.8;
  if (Math.abs(x) > lim) x = Math.sign(x) * (lim + (Math.abs(x) - lim) * 0.35);
  drag.dx = x;
  if (!drag.frame) {
    const d = drag;
    d.frame = requestAnimationFrame(() => { d.frame = 0; setX(d.el, d.dx, false); });
  }
}, { passive: false });

document.addEventListener("touchend", () => {
  if (!drag) return;
  const { el, dx, dir, frame, v } = drag;
  if (frame) cancelAnimationFrame(frame);
  drag = null;
  if (dir !== "x") return;
  swipedAt = Date.now();
  const w = el.offsetWidth;
  if (dx < -w * FULL || (dx < -60 && v < -FLICK)) return swipeAct(el.dataset.id, "done");
  if (dx > w * FULL || (dx > 60 && v > FLICK)) return swipeAct(el.dataset.id, "canceled");
  const right = el.querySelector(".sw-right").offsetWidth, left = el.querySelector(".sw-left").offsetWidth;
  if (dx < -40) { setX(el, -right, true); openSwipe = el; return; }
  if (dx > 40) { setX(el, left, true); openSwipe = el; return; }
  setX(el, 0, true);
  openSwipe = null;
});

async function swipeAct(id, status) {
  const c = card(id);
  if (!c) return;
  const was = c.status;
  openSwipe = null;
  // The row slides off, then its space closes up, and only then does the list redraw.
  const el = document.querySelector(`.swipe[data-id="${CSS.escape(id)}"]`);
  if (el) {
    const dir = status === "canceled" ? 1 : -1;
    setX(el, dir * el.offsetWidth, true);
    await new Promise((r) => setTimeout(r, 220));
    el.style.height = el.offsetHeight + "px";
    void el.offsetHeight;
    el.style.transition = `height .24s ${EASE}, opacity .24s`;
    el.style.height = "0px";
    el.style.opacity = "0";
    await new Promise((r) => setTimeout(r, 240));
  }
  await patch(id, { status });
  toast(`${id} moved to ${STATUS_NAMES[status]}`, false, { label: "Undo", run: () => patch(id, { status: was }) });
}

// ---------- command menu ----------

function openPalette(prompt) {
  S.pal = { mode: prompt ? "prompt" : "search", sel: 0, prompt: prompt || null, items: [] };
  $("#palette").hidden = false;
  animate($("#palette"), "pal-in");
  const input = $("#pal-input");
  input.value = prompt && prompt.value ? prompt.value : "";
  input.placeholder = prompt ? prompt.placeholder : "Search cards or type a command";
  input.focus();
  palRefresh();
}

function closePalette() {
  $("#palette").hidden = true;
  $("#pal-input").blur();
}

function newCardPrompt(projectKey, status) {
  const r = S.route;
  const key = projectKey || (r.kind === "project" ? r.key : "inbox");
  const p = project(key);
  openPalette({
    placeholder: `New card in ${p.name}${status ? " · " + STATUS_NAMES[status] : ""}. Type the title`,
    submit: async (title) => {
      const c = await create(key, title, status ? { status } : {});
      focusCard(c.id);
      render();
    },
  });
}

function commands() {
  const out = [];
  const add = (label, kind, run, keys = "") => out.push({ label, kind, run, keys });
  const words = (p) => (p ? [p.name, p.prefix, ...(p.aliases || [])].join(" ") : "");
  const target = (S.open && card(S.open)) || focused();
  add("Go to Home", "Go", () => go("#/"));
  add("Go to Inbox", "Go", () => go("#/inbox"));
  for (const p of S.data.projects.filter((p) => p.key !== "inbox")) add(`Go to ${p.name}`, "Go", () => go("#/p/" + encodeURIComponent(p.key)), words(p));
  for (const v of S.data.views) add(`Open view: ${v.name}`, "View", () => go("#/v/" + encodeURIComponent(v.name)));
  add("New card", "Create", () => newCardPrompt());
  for (const p of S.data.projects) add(`New card in ${p.name}`, "Create", () => newCardPrompt(p.key), words(p));
  if (target) {
    for (const st of S.data.statuses) if (st !== target.status) add(`${target.id}: move to ${STATUS_NAMES[st]}`, "Card", () => patch(target.id, { status: st }));
    for (const pr of S.data.priorities) if (pr !== target.priority) add(`${target.id}: priority ${PRI_NAMES[pr]}`, "Card", () => patch(target.id, { priority: pr }));
    if (target.assignee !== "me") add(`${target.id}: assign to me`, "Card", () => patch(target.id, { assignee: "me" }));
    if (target.assignee !== "agent") add(`${target.id}: assign to agent`, "Card", () => patch(target.id, { assignee: "agent" }));
    for (const p of S.data.projects) if (p.key !== target.project) add(`${target.id}: move to project ${p.name}`, "Card", () => patch(target.id, { project: p.key }));
  }
  add("New saved view", "View", () => setTimeout(() => openPalette({
    placeholder: "View name",
    submit: (name) => setTimeout(() => openPalette({
      placeholder: "Filter, e.g. status:open priority:urgent,high project:web label:bug",
      submit: async (filter) => {
        await api("POST", "/api/views", { name, filter });
        await load();
        go("#/v/" + encodeURIComponent(name));
      },
    })),
  })));
  if (S.route.kind === "view") {
    const name = S.route.key;
    add(`Delete view: ${name}`, "View", async () => {
      await api("DELETE", "/api/views/" + encodeURIComponent(name));
      await load();
      go("#/");
    });
  }
  return out;
}

function palRefresh() {
  const q = $("#pal-input").value.trim().toLowerCase();
  if (S.pal.mode === "prompt") {
    $("#pal-list").innerHTML = `<div class="pal-sec">Press Enter to save, Esc to cancel</div>`;
    return;
  }
  const words = q.split(/\s+/).filter(Boolean);
  const hit = (s) => words.every((w) => s.toLowerCase().includes(w));
  let items = commands().filter((c) => hit(c.label + " " + c.kind + " " + c.keys));
  const pw = (key) => { const p = project(key); return p ? [p.name, ...(p.aliases || [])].join(" ") : ""; };
  const cards = S.data.cards.filter((c) => hit(c.id + " " + c.title + " " + c.labels.join(" ") + " " + pw(c.project)))
    .sort((a, b) => (OPEN(b) - OPEN(a)) || byUpdated(a, b))
    .map((c) => ({ label: `${c.id}  ${c.title}`, kind: STATUS_NAMES[c.status], run: () => openCard(c.id), st: c.status }));
  items = q ? [...items.filter((c) => c.kind === "Go"), ...cards.slice(0, 30), ...items.filter((c) => c.kind !== "Go")] : [...items.filter((c) => c.kind === "Card" || c.kind === "Create").slice(0, 8), ...cards.slice(0, 12), ...items.filter((c) => c.kind === "Go" || c.kind === "View")];
  S.pal.items = items.slice(0, 60);
  S.pal.sel = Math.min(S.pal.sel, Math.max(0, S.pal.items.length - 1));
  $("#pal-list").innerHTML = S.pal.items.map((it, i) =>
    `<div class="pal-item ${i === S.pal.sel ? "sel" : ""}" data-i="${i}">${it.st ? statusIcon(it.st) : ""}<span>${esc(it.label)}</span><span class="k">${esc(it.kind)}</span></div>`).join("") ||
    `<div class="pal-sec">Nothing found</div>`;
  const sel = document.querySelector(".pal-item.sel");
  if (sel) sel.scrollIntoView({ block: "nearest" });
}

function palRun(i) {
  const pal = S.pal;
  if (pal.mode === "prompt") {
    const v = $("#pal-input").value.trim();
    if (!v) return;
    closePalette();
    return pal.prompt.submit(v);
  }
  const it = pal.items[i];
  if (!it) return;
  closePalette();
  it.run();
}

function paletteKey(e) {
  if (e.key === "Escape") { e.preventDefault(); return closePalette(); }
  if (e.key === "Enter") { e.preventDefault(); return palRun(S.pal.sel); }
  if (e.key === "ArrowDown" || e.key === "ArrowUp") {
    e.preventDefault();
    const n = S.pal.items.length;
    if (!n) return;
    S.pal.sel = (S.pal.sel + (e.key === "ArrowDown" ? 1 : -1) + n) % n;
    palRefresh();
  }
}

$("#pal-input").addEventListener("input", () => { S.pal.sel = 0; palRefresh(); });
$("#palette").addEventListener("click", (e) => {
  const it = e.target.closest(".pal-item");
  if (it) return palRun(Number(it.dataset.i));
  if (e.target.id === "palette") closePalette();
});

// ---------- toast ----------

let toastTimer;
function toast(msg, err, action) {
  const t = $("#toast");
  t.textContent = msg;
  t.className = err ? "err" : "";
  if (action) {
    const b = document.createElement("button");
    b.textContent = action.label;
    b.onclick = () => { t.hidden = true; action.run(); };
    t.appendChild(b);
  }
  t.hidden = false;
  animate(t, "toast-in");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (t.hidden = true), action ? 5000 : 2600);
}

S.route = parseRoute();
S.open = S.route.open;
load().then(() => { if (S.open) focusCard(S.open); render(); listen(); });
