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

// ---------- routing ----------

function parseRoute() {
  const h = decodeURIComponent(location.hash.replace(/^#\/?/, ""));
  if (h === "inbox") return { kind: "inbox" };
  if (h.startsWith("p/")) return { kind: "project", key: h.slice(2) };
  if (h.startsWith("v/")) return { kind: "view", key: h.slice(2) };
  return { kind: "home" };
}

function go(hash) {
  if (location.hash === hash) return;
  location.hash = hash;
}

window.addEventListener("hashchange", () => {
  S.route = parseRoute();
  S.focus = { c: 0, r: 0 };
  document.getElementById("app").classList.remove("menu-open");
  render();
});

// The cards on screen, as columns. A list page is one column. Keyboard moves use this.
function layout() {
  const cards = S.data.cards;
  const r = S.route;
  if (r.kind === "project") {
    return S.data.statuses.map((st) => {
      const list = cards.filter((c) => c.project === r.key && c.status === st);
      return { status: st, cards: list.sort(st === "done" || st === "canceled" ? byUpdated : byPriority) };
    });
  }
  if (r.kind === "inbox") return [{ cards: cards.filter((c) => c.project === "inbox" && OPEN(c)).sort(byUpdated) }];
  if (r.kind === "view") {
    const v = S.data.views.find((v) => v.name === r.key);
    const list = v ? cards.filter((c) => matches(c, v.filter)) : [];
    const so = S.data.statuses;
    return [{ cards: list.sort((a, b) => so.indexOf(a.status) - so.indexOf(b.status) || byPriority(a, b)) }];
  }
  return [{ cards: cards.filter((c) => c.status === "in-progress").sort(byPriority) }];
}

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
  let h = item("#/", "Home", cards.filter((c) => c.status === "in-progress").length, r.kind === "home", "");
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
  $("#top-actions").innerHTML = `<button class="btn primary" id="new-card">New card</button>`;

  const br = S.data.broken;
  $("#broken").hidden = !br.length;
  $("#broken").innerHTML = br.map((b) => `Cannot read ${esc(b.path)}: ${esc(b.error)}`).join("<br>");

  const cols = layout();
  S.focus.c = Math.max(0, Math.min(S.focus.c, cols.length - 1));
  if (!cols[S.focus.c].cards.length) {
    const first = cols.findIndex((col) => col.cards.length);
    if (first >= 0) S.focus = { c: first, r: 0 };
  }
  S.focus.r = Math.max(0, Math.min(S.focus.r, cols[S.focus.c].cards.length - 1));
  const f = focused();

  const row = (c, showProject) => `
      <div class="row ${f && f.id === c.id ? "focus" : ""}" data-id="${esc(c.id)}">
        ${statusIcon(c.status)} ${priIcon(c.priority) || `<span style="width:13px"></span>`}
        <span class="id">${esc(c.id)}</span><span class="t">${esc(c.title)}</span>
        <span class="chips">${metaChips(c, "opt")}${showProject ? projChip(c) : ""}</span>
      </div>`;
  // On a phone a project reads as one list, grouped by status, with the active work first.
  if (r.kind === "project" && PHONE.matches) {
    const order = ["in-progress", "in-review", "todo", "backlog", "done"];
    const groups = order.map((st) => cols.find((col) => col.status === st)).filter((col) => col.cards.length);
    $("#content").innerHTML = groups.length ? `<div class="list">` + groups.map((col) =>
      `<div class="group-head">${statusIcon(col.status)} ${STATUS_NAMES[col.status]} <span class="n">${col.cards.length}</span></div>` +
      (col.status === "done" ? col.cards.slice(0, 10) : col.cards).map((c) => row(c, false)).join("")).join("") + `</div>`
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
    if (r.kind === "home") {
      const n = S.data.cards.filter((c) => c.project === "inbox" && OPEN(c)).length;
      if (n) head = `<div class="hint">${n} card${n > 1 ? "s" : ""} in the <a href="#/inbox">Inbox</a> to sort.</div>`;
    }
    const empty = {
      home: "Nothing in progress.<br>Open a project and move a card to In Progress.",
      inbox: "The Inbox is empty.",
      view: "No cards match this view.",
    }[r.kind];
    $("#content").innerHTML = head + (list.length ? `<div class="list">` + list.map((c) => row(c, r.kind !== "inbox")).join("") + `</div>` : `<div class="empty">${empty}</div>`);
  }
  const el = document.querySelector(".focus");
  if (el) el.scrollIntoView({ block: "nearest", inline: "nearest" });
}

function renderPanel() {
  const panel = $("#panel");
  const c = S.open && card(S.open);
  if (!c) {
    panel.hidden = true;
    S.open = null;
    return;
  }
  // Leave the panel alone while you type in it. A live update redraws it after.
  if (panel.contains(document.activeElement) && /INPUT|TEXTAREA/.test(document.activeElement.tagName) && panel.dataset.id === c.id) return;
  panel.hidden = false;
  panel.dataset.id = c.id;
  const opt = (list, cur, names) => list.map((v) => `<option value="${esc(v)}" ${v === cur ? "selected" : ""}>${esc(names ? names[v] : v)}</option>`).join("");
  const acts = c.activity.map((a) => {
    const m = a.match(/^(\d{4}-\d\d-\d\d \d\d:\d\d) (\S+?)( noted)?: (.*)$/);
    if (!m) return `<div class="act">${esc(a)}</div>`;
    return `<div class="act ${m[3] ? "note" : ""}"><span class="when">${esc(m[1])}</span>${esc(m[2])}${m[3] ? "" : ":"} ${esc(m[4])}</div>`;
  }).join("");
  panel.innerHTML = `
    <div class="p-top">${projChip(c)} <span>${esc(c.id)}</span><button class="x" data-close title="Close (Esc)">×</button></div>
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
  renderNav();
  renderMain();
  renderPanel();
}

function openCard(id) {
  const c = card(id);
  if (!c) return;
  const visible = layout().some((col) => col.cards.some((x) => x.id === id));
  if (!visible) {
    const hash = c.project === "inbox" ? "#/inbox" : "#/p/" + encodeURIComponent(c.project);
    history.pushState(null, "", hash);
    S.route = parseRoute();
  }
  focusCard(id);
  S.open = id;
  render();
}

// ---------- events ----------

document.addEventListener("click", (e) => {
  const t = e.target;
  const goEl = t.closest("[data-go]");
  if (goEl) return go(goEl.dataset.go);
  if (t.closest("#menu")) return document.getElementById("app").classList.toggle("menu-open");
  if (t.closest("#open-palette")) return openPalette();
  if (t.closest("[data-close]")) { S.open = null; return render(); }
  if (t.closest("#new-card")) return newCardPrompt();
  const add = t.closest("[data-add]");
  if (add) return newCardPrompt(S.route.key, add.dataset.add);
  const el = t.closest(".card, .row");
  if (el) {
    focusCard(el.dataset.id);
    S.open = el.dataset.id;
    return render();
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
        const st = S.data.statuses[f.c + d];
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
    case "Enter": { const c = focused(); if (c) S.open = c.id; break; }
    case "Escape": S.open = null; break;
    default: return;
  }
  e.preventDefault();
  if (S.open && e.key.startsWith("Arrow")) { const c = focused(); if (c) S.open = c.id; }
  render();
});

// ---------- command menu ----------

function openPalette(prompt) {
  S.pal = { mode: prompt ? "prompt" : "search", sel: 0, prompt: prompt || null, items: [] };
  $("#palette").hidden = false;
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
function toast(msg, err) {
  const t = $("#toast");
  t.textContent = msg;
  t.className = err ? "err" : "";
  t.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (t.hidden = true), 2600);
}

S.route = parseRoute();
load().then(listen);
