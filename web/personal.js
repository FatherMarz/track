"use strict";

const personalParams = new URLSearchParams(location.search);
if (!personalParams.has("full") && !personalParams.has("sticky") && ["", "#", "#/"].includes(location.hash)) {
  const nativeNote=!!window.webkit?.messageHandlers?.trackSticky;
  const touchApp=!nativeNote&&(matchMedia("(pointer: coarse)").matches||navigator.maxTouchPoints>0);
  history.replaceState(null, "", location.pathname + (touchApp ? "?full=1#/mine" : "?sticky=1#/mine"));
}
const STICKY = new URLSearchParams(location.search).has("sticky");
let personalAdding = false;
const personalCompleting = new Set();
const personalFinished = c => !OPEN(c) || personalCompleting.has(c.uid);
if (STICKY) document.documentElement.classList.add("sticky-mode");

function personalToday() {
  const today=localDay();
  const chosen=new Set((journey().personal||[]).filter(t=>t.date===today).map(t=>t.card_uid));
  const quests=new Set(journey().quests.filter(q=>q.date===today).map(q=>q.card_uid));
  return S.data.cards.filter(c=>c.assignee==="me"&&c.status!=="canceled"&&(
    chosen.has(c.uid)||quests.has(c.uid)||(OPEN(c)&&c.due&&c.due<=today)||
    (c.status==="done"&&won(c.uid)?.accepted_at&&localDay(new Date(won(c.uid).accepted_at))===today)
  )).sort((a,b)=>Number(!OPEN(a))-Number(!OPEN(b))||(a.due||"9999").localeCompare(b.due||"9999")||byPriority(a,b));
}

function renderPersonal() {
  const sc=$("#content"),keep=sc.scrollTop;
  const scratchSelection=scratchpadSelection();
  const expanded=[...sc.querySelectorAll('details[open]')].map(el=>el.className);
  const inputBefore=$("#personal-new-task"),draft=inputBefore?.value||"",wasTyping=document.activeElement===inputBefore;
  const selection=wasTyping?[inputBefore.selectionStart,inputBefore.selectionEnd,inputBefore.selectionDirection]:null;
  const cards=personalToday();
  const open=cards.filter(c=>!personalFinished(c)),done=cards.filter(personalFinished);
  const selected=new Set(cards.map(c=>c.uid));
  const others=S.data.cards.filter(c=>c.assignee==="me"&&OPEN(c)&&!selected.has(c.uid)).sort(byPriority);
  const carried=(journey().personal||[]).filter(t=>t.date<localDay());
  const carriedIDs=new Set(carried.map(t=>t.card_uid));
  const unfinished=others.filter(c=>carriedIDs.has(c.uid));
  const date=new Date().toLocaleDateString(undefined,{weekday:"long",month:"short",day:"numeric"});
  const row=c=>{const finished=personalFinished(c);return `<div class="personal-task ${finished?"is-done":""}"><button class="personal-check" data-personal="complete" data-card="${esc(c.id)}" ${finished?"disabled":""} aria-label="${finished?"Completed: ":"Complete and record: "}${esc(c.title)}">${finished?"✓":""}</button><div class="personal-task-body"><button class="personal-task-title" data-personal="open" data-card="${esc(c.id)}" title="${esc(c.title)}">${esc(c.title)}</button></div>${!finished?`<button class="personal-remove" data-personal="remove" data-card="${esc(c.id)}" aria-label="Move ${esc(c.title)} out of today">×</button>`:""}</div>`;};
  sc.innerHTML=`<section class="personal-page"><header class="personal-heading"><div><span class="journey-eyebrow">JUST YOUR THINGS</span><h2>My day<span class="personal-dot">.</span></h2><p>${esc(date)}</p></div><div class="personal-window-actions">${window.webkit?.messageHandlers?.trackSticky?`<button class="btn" data-personal="pin" aria-label="Toggle always on top" aria-pressed="${window.trackStickyPinned!==false}">${window.trackStickyPinned===false?"Pin":"Pinned"} ↟</button>`:""}${STICKY?`<button class="journey-text-button" data-personal="full-journey">Journey ↗</button>`:`<button class="journey-text-button" data-go="#/journey">Journey ↗</button>`}</div></header>
    <form class="personal-quick-add" id="personal-add-form"><label class="sr-only" for="personal-new-task">Add a task for yourself today</label><input id="personal-new-task" name="title" required maxlength="240" autocomplete="off" placeholder="What do you need to do?" ${personalAdding?"disabled":""}><button type="submit" class="personal-add" aria-label="Add task to My day" ${personalAdding?"disabled":""}>+</button></form>
    <div class="personal-progress"><span>${open.length?`${open.length} thing${open.length===1?"":"s"} for you today`:done.length?"Today’s list is done.":"Make a little room for your day."}</span><div class="personal-progress-actions"><span>${done.length?`${done.length} finished`:""}</span><button class="personal-milestone" data-personal="milestone">+ Milestone</button></div></div>
    <div class="personal-tasks">${open.map(row).join("")||`<div class="personal-empty">${done.length?"You made those things happen.":"Add a task above, or pick one from your list below."}</div>`}</div>
    ${done.length?`<details class="personal-done"><summary>Done today · ${done.length}</summary>${done.map(row).join("")}</details>`:""}
    ${unfinished.length?`<div class="personal-carry"><span class="journey-eyebrow">STILL ON YOUR MIND</span>${unfinished.map(c=>`<div><span>${esc(c.title)}</span><button class="journey-text-button" data-personal="today" data-card="${esc(c.id)}">Today +</button></div>`).join("")}</div>`:""}
    <details class="personal-backlog"><summary>Your other to-dos · ${others.length}</summary>${others.map(c=>`<div class="personal-other"><span>${esc(c.title)}</span><button class="journey-text-button" data-personal="today" data-card="${esc(c.id)}">Today +</button></div>`).join("")||`<p class="journey-muted">Assign a task to Me to keep it here.</p>`}</details>
    ${(journey().milestones||[]).some(m=>m.achieved)?`<details class="personal-milestones"><summary>Milestones · ${journey().milestones.filter(m=>m.achieved).length}</summary>${journey().milestones.filter(m=>m.achieved).sort((a,b)=>b.achieved.localeCompare(a.achieved)).slice(0,5).map(m=>`<div class="personal-milestone-memory"><span>✦ ${esc(m.title)}</span><time datetime="${m.achieved}">${dateLabel(m.achieved)}</time></div>`).join("")}</details>`:""}
    <footer class="personal-footer">${STICKY?`<button class="journey-text-button" data-personal="full">Open full Track ↗</button>`:`<span>Only tasks assigned to you. Agents have their own queue.</span>`}<span>Your finished work adds to your Journey.</span></footer>
    <div class="personal-scratchpad-slot"></div>
  </section>`;
  mountScratchpad(sc.querySelector(".personal-scratchpad-slot"),scratchSelection);
  sc.scrollTop=S.pageChanged?0:keep;
  expanded.forEach(name=>sc.querySelector('details.'+name)?.setAttribute('open',''));
  $("#personal-new-task").value=draft;
  if(wasTyping){const input=$("#personal-new-task");input.focus();if(selection)input.setSelectionRange(...selection);}
  $("#personal-add-form").addEventListener("submit",async e=>{
    e.preventDefault();const input=$("#personal-new-task"), title=input.value.trim();if(!title||personalAdding)return;
    personalAdding=true;
    const button=e.target.querySelector("button");button.disabled=true;input.disabled=true;
    try{
      input.value="";
      const c=await create(S.data.projects.some(p=>p.key==="irl")?"irl":"inbox",title,{assignee:"me"});
      await changeJourney({action:"personal-add",card_id:c.id,date:localDay()});
    }catch(error){toast(error.message,true);}
    finally{
      personalAdding=false;
      const current=$("#personal-new-task"),add=$("#personal-add-form button");
      if(current){current.disabled=false;current.focus();}if(add)add.disabled=false;
    }
  });
}

document.addEventListener("click",async e=>{
  const b=e.target.closest("[data-personal]");if(!b)return;
  e.preventDefault();e.stopImmediatePropagation();
  const a=b.dataset.personal,c=b.dataset.card&&card(b.dataset.card);
  if(a==="sticky")return window.open(location.pathname+"?sticky=1#/mine","track-my-day","popup,width=360,height=560,resizable=yes,scrollbars=yes");
  if(a==="full")return window.open(location.pathname+"?full=1#/","_blank");
  if(a==="full-journey")return window.open(location.pathname+"?full=1#/journey","_blank");
  if(a==="milestone")return recordMilestone();
  if(a==="pin")return window.webkit?.messageHandlers?.trackSticky?.postMessage({action:"togglePin"});
  if(a==="open"){
    if(STICKY){return window.open(location.pathname+"?full=1#/p/"+encodeURIComponent(c.project)+"?c="+encodeURIComponent(c.id),"_blank");}
    return openCard(c.id);
  }
  if(a==="today")return changeJourney({action:"personal-add",card_id:c.id,date:localDay()});
  if(a==="remove"){
    // A due date is a commitment. Changing it is explicit rather than silently hiding overdue work.
    if(c.due&&c.due<=localDay()){toast("Open this task to change its due date.");return;}
    const q=journey().quests.find(q=>q.card_uid===c.uid&&q.date===localDay());
    if(q)await changeJourney({action:"unquest",card_id:c.id,date:localDay()});
    return changeJourney({action:"personal-remove",card_id:c.id,date:localDay()});
  }
  if(a==="complete"){
    if(!c || personalCompleting.has(c.uid))return;
    const rect=b.getBoundingClientRect(), origin={x:rect.x+rect.width/2,y:rect.y+rect.height/2};
    personalCompleting.add(c.uid);renderPersonal();
    const ok=await changeJourney({action:"personal-complete",card_id:c.id,date:localDay()});
    personalCompleting.delete(c.uid);
    if(S.route.kind==="mine")renderPersonal();
    if(ok){celebrateWin(origin);toast("Done. Saved in your Journey.");}
  }
},true);


function celebrateWin(origin, milestone = false) {
  if(matchMedia("(prefers-reduced-motion: reduce)").matches)return;
  const layer=document.createElement("div");layer.className="personal-confetti";layer.setAttribute("aria-hidden","true");
  const point=origin||{x:innerWidth/2,y:Math.min(innerHeight*.35,160)};
  const colors=["var(--focus)","var(--journey-trophy)","var(--text)","var(--accent)"];
  for(let i=0;i<(milestone?54:32);i++){
    const particle=document.createElement("span");particle.style.left=Math.max(8,Math.min(innerWidth-8,point.x))+"px";particle.style.top=point.y+"px";
    particle.style.background=colors[i%colors.length];layer.appendChild(particle);
    const dx=(Math.random()-.5)*(milestone?420:260),lift=50+Math.random()*110,fall=100+Math.random()*140,turn=(Math.random()-.5)*720;
    particle.animate([{transform:"translate3d(0,0,0) rotate(0deg)",opacity:1},{transform:`translate3d(${dx*.5}px,${-lift}px,0) rotate(${turn*.45}deg)`,opacity:1,offset:.42},{transform:`translate3d(${dx}px,${fall}px,0) rotate(${turn}deg)`,opacity:0}],{duration:650+Math.random()*300,easing:"cubic-bezier(.2,.7,.4,1)",fill:"forwards"});
  }
  document.body.appendChild(layer);setTimeout(()=>layer.remove(),1100);
}
