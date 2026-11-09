"use strict";

const J = { tab: "overview", range: "six", project: "", month: "", search: "", busy: false, error: "" };
const journey = () => S.data.journey || { victories: [], milestones: [], quests: [] };
const localDay = (d = new Date()) => `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`;
const victoryDay = (v) => /^\d{4}-\d\d-\d\d$/.test(v.at) ? v.at : v.at ? localDay(new Date(v.at)) : "";
const dateLabel = (s, month = false) => s ? new Date(s.length === 7 ? s + "-01T12:00:00" : s.length === 10 ? s + "T12:00:00" : s).toLocaleDateString(undefined, month ? { month: "long", year: "numeric" } : { month: "short", day: "numeric", year: "numeric" }) : "Date unknown";
const won = (uid) => journey().victories.find((v) => v.card_uid === uid);
const cardByUID = (uid) => S.data.cards.find((c) => c.uid === uid);
const totalXP = () => journey().victories.reduce((s, v) => s + v.xp, 0);
const levelInfo = () => { const xp = totalXP(); const level = Math.floor(xp / 250) + 1; return { xp, level, progress: xp % 250, title: level < 3 ? "Pathfinder" : level < 7 ? "Builder" : level < 15 ? "Trailblazer" : "World maker" }; };

let journeyQueue = Promise.resolve();
function changeJourney(incoming) {
  const result = journeyQueue.then(() => performJourneyChange(incoming));
  journeyQueue = result.catch(() => false);
  return result;
}

async function performJourneyChange(incoming) {
  J.busy = true;
  J.error = "";
  document.querySelectorAll("#journey-dialog button[type=submit]").forEach((b) => b.disabled = true);
  try {
    const j = await api("POST", "/api/journey", {...incoming, utc_offset_minutes: new Date().getTimezoneOffset()});
    S.data.journey = j;
    if (incoming.action === "personal-complete") {
      const c = card(incoming.card_id); if (c) c.status = "done";
      render();
    } else if (["milestone-record", "chapter-create", "chapter-update", "milestone-chapter", "milestone-create", "milestone-update"].includes(incoming.action)) {
      render();
    } else await load();
    return true;
  } catch (error) { J.error = error.message; return false; }
  finally {
    J.busy = false;
    document.querySelectorAll("#journey-dialog button[type=submit]").forEach((b) => b.disabled = false);
  }
}

function renderDailyRun() {
  const day = localDay();
  const quests = journey().quests.filter((q) => q.date === day);
  const finished = quests.filter((q) => won(q.card_uid));
  const lv = levelInfo();
  const ready = S.data.cards.filter((c) => ["done", "in-review"].includes(c.status) && !won(c.uid)).length;
  return `<section class="daily-run" aria-label="Today’s quests">
    <div class="journey-section-head"><div><span class="journey-eyebrow">TODAY’S RUN</span><h2>${quests.length && finished.length === quests.length ? "You landed your run." : "A few things worth finishing."}</h2></div><button class="btn" data-go="#/journey">Level ${lv.level} · ${lv.title} ↗</button></div>
    <div class="run-status"><span>${finished.length} / ${quests.length} quests landed</span><span>${lv.xp.toLocaleString()} lifetime XP</span></div>
    ${quests.length ? `<div class="journey-meter" role="progressbar" aria-label="Today’s quests" aria-valuenow="${finished.length}" aria-valuemin="0" aria-valuemax="${quests.length}"><span style="width:${finished.length/quests.length*100}%"></span></div>` : ""}
    <div class="run-quests">${quests.map((q) => {
      const c = cardByUID(q.card_uid), v = won(q.card_uid);
      return `<div class="run-quest ${v ? "landed" : ""}"><div><span class="journey-eyebrow">${v ? "✓ LANDED" : q.xp === 50 ? "MAIN QUEST" : "SIDE QUEST"} · ${q.xp} XP</span><div class="run-quest-title">${esc(q.title)}</div><span class="journey-muted">${c ? esc(project(c.project)?.name || c.project) : "Task no longer on the board"}${c && !v ? " · " + esc(STATUS_NAMES[c.status]) : ""}</span></div>
      <div class="journey-actions">${v ? `<span class="journey-complete">Recorded</span>` : c ? `${["in-review","done"].includes(c.status) ? `<button class="btn primary" data-journey="accept" data-card="${esc(c.id)}">Accept & record</button>` : `<button class="btn" data-journey="open" data-card="${esc(c.id)}">Open task</button>`}<button class="journey-text-button" data-journey="unquest" data-card="${esc(c.id)}" aria-label="Remove ${esc(q.title)} from today’s run">Remove</button>` : ""}</div></div>`;
    }).join("")}</div>
    <div class="run-footer">${quests.length < 3 ? `<button class="btn" data-journey="quest-picker">${quests.length ? "Add a quest" : "Choose up to three quests"}</button>` : ""}<span class="journey-muted">${ready ? `<button class="journey-text-button" data-journey="ready">${ready} result${ready === 1 ? "" : "s"} ready to record ↗</button>` : "Your progress stays. No streaks to lose."}</span></div>
  </section>`;
}

function renderCardJourney(c) {
  const v = won(c.uid);
  if (v) return `<div class="card-journey"><span class="journey-complete">✦ Saved in your Journey</span><span class="journey-muted">${dateLabel(v.at)}${v.kind === "earlier" ? " · Earlier work" : ` · ${v.xp} XP`}</span><button class="journey-text-button" data-go="#/journey">View your Journey ↗</button></div>`;
  const q = journey().quests.find((q) => q.card_uid === c.uid && q.date === localDay());
  return `<div class="card-journey"><span class="journey-eyebrow">YOUR JOURNEY</span><div class="journey-actions">${["done", "in-review"].includes(c.status) ? `<button class="btn primary" data-journey="accept" data-card="${esc(c.id)}">Accept & record win</button>` : ""}${!q && c.status !== "canceled" ? `<button class="btn" data-journey="quest-card" data-card="${esc(c.id)}">Add to today’s run</button>` : q ? `<span class="journey-muted">In today’s run · ${q.xp} XP</span>` : ""}</div></div>`;
}

function visibleVictories() {
  let start = "";
  const today = new Date();
  if (J.range === "six") { today.setDate(1); today.setMonth(today.getMonth()-5); start = localDay(today); }
  if (J.range === "month") { today.setDate(today.getDate()-29); start = localDay(today); }
  const query = J.search.toLowerCase().trim();
  return journey().victories.filter((v) => (!start || victoryDay(v) >= start) && (!J.project || v.project === J.project) && (!J.month || victoryDay(v).startsWith(J.month)) && (!query || `${v.title} ${v.reflection} ${v.project_name}`.toLowerCase().includes(query)))
    .sort((a,b) => (b.at || "").localeCompare(a.at || "") || a.id.localeCompare(b.id));
}

function renderJourney() {
  const sc = $("#content"), keep = sc.scrollTop;
  const j = journey(), lv = levelInfo();
  const wins = j.victories.filter(v => v.kind !== "milestone");
  const reached = j.milestones.filter(m => m.achieved).length;
  const chapters = storyChapters();
  const unfiled = j.milestones.filter(m => !m.archived && !m.chapter_id);
  sc.innerHTML = `<div class="journey-page journey-linear">
    <header class="story-header"><span class="journey-eyebrow">YOUR STORY, BUILT OVER TIME</span><h2>Look what you made happen.</h2>
      <div class="story-totals"><span>${wins.length.toLocaleString()} ${wins.length===1?"thing":"things"} finished</span><span>${reached} ${reached===1?"milestone":"milestones"} reached</span><span>Level ${lv.level} · ${lv.xp.toLocaleString()} XP</span></div>
      <div class="story-actions"><button class="btn primary" data-journey="milestone-record">Record an accomplishment</button><button class="btn" data-journey="chapter-new">Add a chapter</button></div>
    </header>
    <div class="story-flow" aria-label="Story structure"><span>Chapters</span><span aria-hidden="true">→</span><span>Milestones</span><span aria-hidden="true">→</span><span>Wins along the way</span></div>
    <section class="story-chapters" aria-label="Your chapters">${chapters.length ? chapters.map((ch,index)=>`<article class="story-chapter"><header class="chapter-heading"><div><span class="journey-eyebrow">CHAPTER ${String(index+1).padStart(2,"0")} · FROM ${esc(dateLabel(ch.started))}</span><h3>${esc(ch.title)}</h3>${ch.description?`<p>${esc(ch.description)}</p>`:""}</div><button class="journey-text-button" data-journey="chapter-edit" data-id="${ch.id}">Edit chapter</button></header>${renderMilestones(false,ch.id)}</article>`).join("") : `<div class="story-start"><span class="journey-eyebrow">BEGIN WITH A CHAPTER</span><h3>Give this part of your life a name.</h3><p>A new business. A season of learning. The year you finally shipped it.</p><button class="btn" data-journey="chapter-new">Add your first chapter</button></div>`}</section>
    ${unfiled.length ? `<section class="story-unfiled">${renderMilestones(false,"")}</section>` : ""}
    ${chapters.length ? `<button class="btn story-next-chapter" data-journey="chapter-new">+ Add the next chapter</button>` : ""}
    <section class="story-wins" aria-label="Wins along the way"><div class="journey-section-head"><div><span class="journey-eyebrow">WINS ALONG THE WAY</span><h3>The work that adds up.</h3></div></div>${renderHistoryFilters()}${renderMonthTrail()}${renderVictoryTimeline()}${renderPastRuns()}</section>
  </div>`;
  sc.scrollTop = S.pageChanged ? 0 : keep;
}

function storyChapters() {
  return [...(journey().chapters || [])].sort((a,b)=>a.started.localeCompare(b.started)||a.created.localeCompare(b.created));
}

function chapterField(selected = "") {
  return `<label>Chapter<select name="chapter" aria-label="Chapter"><option value="">Without a chapter</option>${storyChapters().map(ch=>`<option value="${ch.id}" ${selected===ch.id?"selected":""}>${esc(ch.title)}</option>`).join("")}</select></label>`;
}

function chapterEditor(id) {
  const ch = storyChapters().find(ch=>ch.id===id);
  const requestID = ch?.id || crypto.randomUUID().replaceAll("-", "");
  journeyDialog(ch?"Edit chapter":"Start a chapter", `<label>Chapter name<input name="title" required maxlength="240" value="${esc(ch?.title||"")}" placeholder="The year I built something of my own"></label><label>When did this chapter begin?<input name="date" type="date" required value="${ch?.started||localDay()}"></label><label>A little context · optional<textarea name="description" rows="3" maxlength="8000" placeholder="What was happening? What were you working toward?">${esc(ch?.description||"")}</textarea></label>`, ch?"Save chapter":"Create chapter", async f=>{
    const ok=await changeJourney({action:ch?"chapter-update":"chapter-create",id:requestID,title:f.get("title"),date:f.get("date"),description:f.get("description")});
    if(ok)toast(ch?"Chapter updated.":"A new chapter in your story.");return ok;
  });
}

function recordMilestone(chapterID) {
  const requestID=crypto.randomUUID().replaceAll("-", "");
  const selected=chapterID ?? storyChapters().filter(ch=>ch.started<=localDay()).at(-1)?.id ?? "";
  journeyDialog("What did you accomplish?", `<label>Milestone<input name="title" required maxlength="240" placeholder="I launched my first product"></label><label>Accomplished on<input name="date" type="date" required max="${localDay()}" value="${localDay()}"></label><label>What do you want to remember? · optional<textarea name="reflection" rows="3" maxlength="8000" placeholder="What changed, and why did it matter?"></textarea></label>${storyChapters().length?chapterField(selected):""}<details class="milestone-record-project"><summary>Project · optional</summary><label>Project<select name="project" aria-label="Project"><option value="">Personal / across projects</option>${S.data.projects.map(p=>`<option value="${esc(p.key)}">${esc(p.name)}</option>`).join("")}</select></label></details><p class="journey-muted">Earlier accomplishments count too. Choose the date it happened; it will appear there in your story. +100 XP.</p>`, "Save accomplishment", async f=>{
    const ok=await changeJourney({action:"milestone-record",id:requestID,title:f.get("title"),date:f.get("date"),reflection:f.get("reflection"),project:f.get("project")||"",chapter_id:f.get("chapter")||""});
    if(ok){toast("Milestone saved. You did that. +100 XP.");setTimeout(()=>celebrateWin(null,true),0);}return ok;
  });
  const form=$("#journey-dialog form"),chapter=form.querySelector('[name="chapter"]');
  let chosen=chapterID!==undefined;
  chapter?.addEventListener("change",()=>chosen=true);
  form.querySelector('[name="date"]').addEventListener("change",e=>{
    if(chapter&&!chosen)chapter.value=storyChapters().filter(ch=>ch.started<=e.target.value).at(-1)?.id||"";
  });
}

function renderPastRuns() {
  const groups = new Map();
  journey().quests.forEach(q=>{if(q.date<localDay()){if(!groups.has(q.date))groups.set(q.date,[]);groups.get(q.date).push(q);}});
  const days=[...groups].sort(([a],[b])=>b.localeCompare(a));
  if(!days.length)return "";
  return `<details class="past-runs"><summary>Past daily runs · ${days.length} days</summary>${days.map(([day,qs])=>`<section class="past-run"><h4>${dateLabel(day)} · ${qs.filter(q=>won(q.card_uid)).length} / ${qs.length} landed</h4>${qs.map(q=>`<div class="journey-muted">${won(q.card_uid)?"✓":"○"} ${esc(q.title)}${won(q.card_uid)?"":" · Not recorded"}</div>`).join("")}</section>`).join("")}</details>`;
}

function renderHistoryFilters() {
  const j = journey();
  const projects = new Map(S.data.projects.map((p) => [p.key, p.name]));
  j.victories.forEach((v) => { if (v.project && !projects.has(v.project)) projects.set(v.project, v.project_name); });
  return `<div class="journey-filters"><label>Look back<select id="journey-range"><option value="six" ${J.range === "six" ? "selected" : ""}>Six months</option><option value="month" ${J.range === "month" ? "selected" : ""}>Last 30 days</option><option value="all" ${J.range === "all" ? "selected" : ""}>All time</option></select></label><label>Project<select id="journey-project"><option value="">All projects</option>${[...projects].map(([key,name])=>`<option value="${esc(key)}" ${J.project===key?"selected":""}>${esc(name)}</option>`).join("")}</select></label><label class="journey-search">Find a win<input id="journey-search" type="search" value="${esc(J.search)}" placeholder="A launch, a fix, a moment…"></label>${J.month ? `<button class="btn" data-journey="clear-month">${dateLabel(J.month, true)} ×</button>` : ""}</div>`;
}

function renderMonthTrail() {
  // The bars describe recorded outcomes, not estimated productivity or time spent.
  const all = journey().victories.filter((v) => (!J.project || v.project === J.project));
  const current = new Date(); current.setDate(1);
  let count = J.range === "month" ? 2 : 6;
  if (J.range === "all" && all.length) {
    const days = all.map(victoryDay).filter(Boolean).sort();
    if (days.length) { const first = new Date(days[0].slice(0,7)+"-01T12:00:00"); count = Math.max(6,Math.min(24,(current.getFullYear()-first.getFullYear())*12+current.getMonth()-first.getMonth()+1)); }
  }
  const months = Array.from({length:count},(_,i)=>{ const d = new Date(current); d.setMonth(d.getMonth()-count+1+i); const key=localDay(d).slice(0,7); return {key, label:d.toLocaleDateString(undefined,{month:"short",year:count>12?"2-digit":undefined}), n:all.filter(v=>victoryDay(v).startsWith(key)).length}; });
  const max = Math.max(1,...months.map(m=>m.n));
  return `<section class="journey-trail" aria-label="Recorded outcomes by month"><div class="journey-section-head"><h3>Your work leaves a trail.</h3><span class="journey-muted">${count} months · wins + milestones</span></div><div class="journey-months" style="--months:${count}">${months.map(m=>`<button class="journey-month ${J.month===m.key?"selected":""}" data-journey="month" data-month="${m.key}" aria-pressed="${J.month===m.key}" aria-label="${dateLabel(m.key,true)}: ${m.n} outcomes"><span class="month-count">${m.n}</span><span class="month-bar-space"><span class="month-bar" style="height:${Math.max(m.n?4:0,m.n/max*100)}%"></span></span><span class="month-label">${esc(m.label)}</span></button>`).join("")}</div></section>`;
}

function renderMilestones(compact = false, chapterID = null) {
  const milestones = journey().milestones.filter((m) => !m.archived && (chapterID !== null ? (m.chapter_id || "") === chapterID : !J.project || m.project === J.project));
  const active = milestones.filter(m=>!m.achieved), achieved=milestones.filter(m=>m.achieved).sort((a,b)=>b.achieved.localeCompare(a.achieved));
  const shown = compact ? [...active,...achieved].slice(0,3) : [...active,...achieved];
  if (chapterID !== null) shown.sort((a,b)=>(a.achieved||a.target||a.created).localeCompare(b.achieved||b.target||b.created));
  return `<section class="journey-milestones"><div class="journey-section-head"><div><span class="journey-eyebrow">THE BIG THINGS</span><h3>${chapterID !== null ? chapterID ? "Milestones in this chapter" : "Milestones without a chapter" : compact ? active.length ? "What you’re building toward" : "Milestones along the way" : "Your milestones"}</h3></div><div class="journey-actions"><button class="btn" data-journey="milestone-record" data-chapter="${chapterID||""}">Record milestone</button><button class="journey-text-button" data-journey="milestone-new" data-chapter="${chapterID||""}">Plan a milestone</button></div></div>${shown.length ? shown.map(m=>{
    const completed=m.card_uids.filter(uid=>won(uid)).length;
    const v=journey().victories.find(v=>v.milestone_id===m.id);
    return `<article class="journey-milestone ${m.achieved?"achieved":""}"><div class="milestone-symbol" aria-hidden="true">${m.achieved?"✦":"◇"}</div><div class="milestone-body"><div class="journey-eyebrow">${m.achieved ? `REACHED ${esc(dateLabel(m.achieved))}` : m.target ? `AIMING FOR ${esc(dateLabel(m.target))}` : "AT YOUR OWN PACE"}${m.project?" · "+esc(project(m.project)?.name||m.project):""}</div><h4>${esc(m.title)}</h4>${m.description?`<p>${esc(m.description)}</p>`:""}${m.card_uids.length?`<div class="journey-meter" role="progressbar" aria-label="Accepted linked tasks" aria-valuemin="0" aria-valuemax="${m.card_uids.length}" aria-valuenow="${completed}"><span style="width:${completed/m.card_uids.length*100}%"></span></div><span class="journey-muted">${completed} / ${m.card_uids.length} linked wins recorded</span><div class="milestone-links">${m.card_uids.map(uid=>{const c=cardByUID(uid),v=won(uid);return c?`<button class="journey-text-button" data-journey="open" data-card="${esc(c.id)}">${v?"✓":"○"} ${esc(c.title)}</button>`:`<span class="journey-muted">${v?"✓ "+esc(v.title):"Task no longer on the board"}</span>`;}).join("")}</div>`:""}${v?.reflection?`<blockquote>${esc(v.reflection)}</blockquote>`:""}<div class="journey-actions">${!m.achieved?`<button class="btn primary" data-journey="milestone-finish" data-id="${m.id}" ${completed<m.card_uids.length?"disabled":""}>Mark achieved · +100 XP</button><button class="journey-text-button" data-journey="milestone-edit" data-id="${m.id}">Edit</button><button class="journey-text-button" data-journey="milestone-archive" data-id="${m.id}">Archive</button>`:`<span class="journey-complete">A permanent part of your story · +100 XP</span>`}${storyChapters().length?`<label class="milestone-chapter-picker">Chapter<select data-milestone-chapter="${m.id}" aria-label="Chapter for ${esc(m.title)}"><option value="">Without a chapter</option>${storyChapters().map(ch=>`<option value="${ch.id}" ${m.chapter_id===ch.id?"selected":""}>${esc(ch.title)}</option>`).join("")}</select></label>`:""}</div></div></article>`;
  }).join("") : `<div class="journey-empty"><h4>What will you be proud to remember?</h4><p>Record something you accomplished, or plan the next milestone.</p><button class="btn" data-journey="milestone-record" data-chapter="${chapterID||""}">Record a milestone</button></div>`}${compact && active.length>3?`<button class="journey-text-button" data-journey="tab" data-tab="milestones">View all ${active.length} active milestones ↗</button>`:""}</section>`;
}

function renderVictoryTimeline() {
  const vs=visibleVictories(), groups=new Map();
  vs.forEach(v=>{const key=victoryDay(v).slice(0,7)||"unknown";if(!groups.has(key))groups.set(key,[]);groups.get(key).push(v);});
  const accepted=vs.filter(v=>v.kind==="card").length, milestones=vs.filter(v=>v.kind==="milestone").length;
  return `<section class="journey-history"><div class="journey-section-head"><h3>${J.month?dateLabel(J.month,true):"The things you made happen"}</h3><span class="journey-muted">${vs.length} outcomes in this view</span></div>${vs.length?`<div class="journey-period-summary">${accepted} accepted wins · ${milestones} milestones · ${vs.length-accepted-milestones} earlier completions</div>`:""}${[...groups].map(([key,items])=>`<section class="journey-month-group"><h4>${key==="unknown"?"Date unknown":dateLabel(key,true)}</h4>${items.map(v=>`<article class="journey-victory ${v.kind==="milestone"?"is-milestone":""}"><div class="victory-mark" aria-hidden="true">${v.kind==="milestone"?"✦":"✓"}</div><div class="victory-body"><div class="journey-eyebrow">${v.kind==="milestone"?"MILESTONE REACHED":v.kind==="earlier"?"EARLIER WORK":"WIN RECORDED"}${v.project_name?" · "+esc(v.project_name):""}</div><h4>${esc(v.title)}</h4>${v.reflection?`<p>${esc(v.reflection)}</p>`:""}<div class="journey-muted">${esc(dateLabel(v.at))}${v.estimated?" · Date estimated from last update":""} · ${esc(v.crew)}${v.xp?` · +${v.xp} XP`:" · No retroactive XP"}</div>${v.card_uid && cardByUID(v.card_uid)?`<button class="journey-text-button" data-journey="open" data-card="${esc(cardByUID(v.card_uid).id)}">Open task ↗</button>`:""}</div></article>`).join("")}</section>`).join("") || `<div class="journey-empty"><h4>${journey().victories.length?"No wins in this view yet.":"This is where it starts."}</h4><p>${journey().victories.length?"Try another period or project, or clear your search.":"Finish a task, accept the result, and save what it meant to you."}</p><button class="btn" data-go="#/">Choose your next quest</button></div>`}</section>`;
}

function journeyDialog(title, body, submit, onSubmit) {
  const d=$("#journey-dialog");
  d.innerHTML=`<form class="journey-form"><header><h2 id="journey-dialog-title">${esc(title)}</h2><button class="journey-text-button" type="button" data-journey="dialog-close" aria-label="Close dialog">×</button></header>${body}<div class="journey-form-error" role="alert" hidden></div><footer><button class="btn" type="button" data-journey="dialog-close">Cancel</button><button class="btn primary" type="submit">${esc(submit)}</button></footer></form>`;
  const form=d.querySelector("form");
  form.addEventListener("submit",async e=>{
    e.preventDefault(); if(J.busy || !form.reportValidity())return;
    const error=form.querySelector(".journey-form-error");error.hidden=true;
    const result=await onSubmit(new FormData(form));
    if(result)d.close();else {error.textContent=J.error || "Could not save. Try again.";error.hidden=false;}
  });
  if(!d.open)d.showModal();
}

const xpField = (value=25) => `<label>Size of the outcome<select name="xp" aria-label="Size of the outcome">${[[10,"Small · 10 XP"],[25,"Meaningful · 25 XP"],[50,"Big · 50 XP"]].map(([n,label])=>`<option value="${n}" ${value===n?"selected":""}>${label}</option>`).join("")}</select></label>`;

function pickQuest(onlyCard) {
  const selected=journey().quests.filter(q=>q.date===localDay()).map(q=>q.card_uid);
  const cards=S.data.cards.filter(c=>c.status!=="canceled"&&!won(c.uid)&&!selected.includes(c.uid));
  if(!cards.length){toast("No unfinished quests to add.");return;}
  journeyDialog("Choose a quest",`<label>Task<input type="search" id="quest-search" placeholder="Find a task…" autocomplete="off"></label><label>Choose a task<select name="card" aria-label="Choose a task" size="7" required>${cards.filter(c=>!onlyCard||c.id===onlyCard).map(c=>`<option value="${esc(c.id)}">${esc(c.id)} · ${esc(c.title)}</option>`).join("")}</select></label>${xpField()}<p class="journey-muted">Up to three quests today. Pick what matters. Unfinished quests remain in your history.</p>`,"Add to today’s run",async f=>{
    const ok=await changeJourney({action:"quest",card_id:f.get("card"),date:localDay(),xp:Number(f.get("xp"))});
    if(ok)toast("Quest added. One clear next step.");return ok;
  });
  const select=$("#journey-dialog select[name=card]");
  if(select.options.length)select.selectedIndex=0;
  $("#quest-search").addEventListener("input",e=>{
    const needle=e.target.value.toLowerCase();
    select.innerHTML=cards.filter(c=>(!onlyCard||c.id===onlyCard)&&`${c.id} ${c.title}`.toLowerCase().includes(needle)).map(c=>`<option value="${esc(c.id)}">${esc(c.id)} · ${esc(c.title)}</option>`).join("");
    if(select.options.length)select.selectedIndex=0;
  });
}

function acceptWin(id) {
  const c=card(id);if(!c)return;
  const q=[...journey().quests].reverse().find(q=>q.card_uid===c.uid);
  journeyDialog("Save this win",`<div class="journey-dialog-subject">${esc(c.title)}</div>${q?`<p class="journey-muted">${q.xp} XP · ${q.xp===50?"Main":"Side"} quest</p>`:xpField()}<label>What will you want to remember?<textarea name="reflection" rows="4" maxlength="8000" placeholder="What changed? What was hard? Why did this matter?"></textarea></label><p class="journey-muted">Accepting records this outcome once and marks the task Done. Your words stay with it.</p>`,"Accept & record win",async f=>{
    const before=levelInfo().level;
    const ok=await changeJourney({action:"accept",card_id:id,xp:q?.xp||Number(f.get("xp")),reflection:f.get("reflection")});
    if(ok)toast(levelInfo().level>before?`Level ${levelInfo().level}. Look what you’re building.`:"Win recorded. That one counts.");return ok;
  });
}

function milestoneEditor(id, chapterID = "") {
  const m=journey().milestones.find(m=>m.id===id);
  const cards=S.data.cards.filter(c=>c.status!=="canceled"||m?.card_uids.includes(c.uid));
  journeyDialog(m?"Edit milestone":"Name your next milestone",`<label>Milestone<input name="title" required maxlength="240" value="${esc(m?.title||"")}" placeholder="Launch the thing I’ve been building"></label><label>What does reaching it look like?<textarea name="description" rows="3" maxlength="8000" placeholder="Give this goal a clear finish line.">${esc(m?.description||"")}</textarea></label><div class="journey-form-grid"><label>Project<select name="project" aria-label="Project"><option value="">Personal / across projects</option>${S.data.projects.map(p=>`<option value="${esc(p.key)}" ${m?.project===p.key?"selected":""}>${esc(p.name)}</option>`).join("")}</select></label><label>Target date · optional<input type="date" name="target" value="${esc(m?.target||"")}"></label></div>${chapterField(m?.chapter_id||chapterID)}<details><summary>Link tasks · optional (${m?.card_uids.length||0} selected)</summary><label>Find tasks<input type="search" id="milestone-task-search" placeholder="Search by name or ID"></label><div class="milestone-task-picker">${cards.map(c=>`<label data-task-label="${esc((c.id+" "+c.title).toLowerCase())}"><input type="checkbox" name="cards" value="${esc(c.uid)}" ${m?.card_uids.includes(c.uid)?"checked":""}><span>${esc(c.id)} · ${esc(c.title)}</span></label>`).join("")}</div></details><p class="journey-muted">Milestones can be personal or tied to a project. Reaching one saves a permanent memory and earns 100 XP.</p>`,m?"Save milestone":"Create milestone",async f=>{
    const ok=await changeJourney({action:m?"milestone-update":"milestone-create",id:id||"",title:f.get("title"),description:f.get("description"),project:f.get("project"),target:f.get("target"),card_uids:f.getAll("cards"),chapter_id:f.get("chapter")||""});
    if(ok)toast(m?"Milestone updated.":"A new milestone to build toward.");return ok;
  });
  $("#milestone-task-search").addEventListener("input",e=>{
    const needle=e.target.value.toLowerCase();
    $("#journey-dialog").querySelectorAll("[data-task-label]").forEach(label=>label.hidden=!label.dataset.taskLabel.includes(needle));
  });
  $("#journey-dialog").querySelectorAll('input[name="cards"]').forEach(input=>input.addEventListener("change",()=>{
    $("#journey-dialog summary").textContent=`Link tasks · optional (${$('#journey-dialog').querySelectorAll('input[name="cards"]:checked').length} selected)`;
  }));
}

function finishMilestone(id) {
  const m=journey().milestones.find(m=>m.id===id);if(!m)return;
  journeyDialog("You reached a milestone.",`<div class="journey-dialog-subject">${esc(m.title)}</div><label>When did it happen?<input name="date" type="date" required max="${localDay()}" value="${localDay()}"></label><label>Leave a note for your future self<textarea name="reflection" rows="5" maxlength="8000" placeholder="Six months from now, what do you want to remember about this?"></textarea></label><p class="journey-muted">This becomes a permanent chapter in your Journey. +100 XP.</p>`,"Save this milestone",async f=>{
    const ok=await changeJourney({action:"milestone-complete",id,date:f.get("date"),reflection:f.get("reflection")});
    if(ok)toast("Milestone reached. You did that.");return ok;
  });
}

document.addEventListener("click",e=>{
  const b=e.target.closest("[data-journey]");if(!b)return;
  e.preventDefault();e.stopImmediatePropagation();
  const action=b.dataset.journey;
  if(action==="dialog-close")return $("#journey-dialog").close();
  if(action==="tab"){J.tab=b.dataset.tab;S.pageChanged=true;return renderJourney();}
  if(action==="month"){J.month=J.month===b.dataset.month?"":b.dataset.month;return renderJourney();}
  if(action==="clear-month"){J.month="";return renderJourney();}
  if(action==="quest-picker")return pickQuest();
  if(action==="quest-card")return pickQuest(b.dataset.card);
  if(action==="open")return openCard(b.dataset.card);
  if(action==="accept")return acceptWin(b.dataset.card);
  if(action==="unquest")return changeJourney({action:"unquest",card_id:b.dataset.card,date:localDay()});
  if(action==="milestone-new")return milestoneEditor(undefined,b.dataset.chapter||"");
  if(action==="milestone-record")return recordMilestone(b.dataset.chapter);
  if(action==="chapter-new")return chapterEditor();
  if(action==="chapter-edit")return chapterEditor(b.dataset.id);
  if(action==="milestone-edit")return milestoneEditor(b.dataset.id);
  if(action==="milestone-finish")return finishMilestone(b.dataset.id);
  if(action==="milestone-archive")return journeyDialog("Archive this milestone?","<p class=\"journey-muted\">It leaves your active goals. Your recorded wins stay in your Journey.</p>","Archive milestone",()=>changeJourney({action:"milestone-archive",id:b.dataset.id}));
  if(action==="ready"){
    const cards=S.data.cards.filter(c=>["done","in-review"].includes(c.status)&&!won(c.uid));
    journeyDialog("Results ready to record",`<label>Choose a result<select name="card" aria-label="Choose a result" size="8" required>${cards.map(c=>`<option value="${esc(c.id)}">${esc(c.title)}</option>`).join("")}</select></label>`,"Review this win",async f=>{const id=f.get("card");if(!id)return false;setTimeout(()=>acceptWin(id),0);return true;});
  }
},true);

document.addEventListener("change",e=>{
  if(e.target.dataset.milestoneChapter){changeJourney({action:"milestone-chapter",id:e.target.dataset.milestoneChapter,chapter_id:e.target.value});return;}
  if(e.target.id==="journey-range"){J.range=e.target.value;J.month="";renderJourney();}
  if(e.target.id==="journey-project"){J.project=e.target.value;J.month="";renderJourney();}
});
document.addEventListener("input",e=>{
  if(e.target.id!=="journey-search")return;
  J.search=e.target.value;
  const start=e.target.selectionStart;
  renderJourney();
  const input=$("#journey-search");input.focus();
  try{input.setSelectionRange(start,start);}catch(_){}
});
document.addEventListener("keydown",e=>{
  // Native dialog owns its keyboard and focus. Board shortcuts cannot steal input.
  if($("#journey-dialog")?.open)e.stopImmediatePropagation();
},true);
let journeyDay=localDay();
setInterval(()=>{const next=localDay();if(next!==journeyDay){journeyDay=next;if(S.data)render();}},30000);
