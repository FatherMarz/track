"use strict";

const scratchpad = {
  element:null, text:"", loaded:false, dirty:false, saving:false,
  generation:0, timer:null, queue:Promise.resolve(), error:""
};
const SCRATCHPAD_DRAFT = "track.scratchpad.draft";
try {
  const draft=JSON.parse(localStorage.getItem(SCRATCHPAD_DRAFT)||"null");
  if(draft && typeof draft.text==="string"){scratchpad.text=draft.text;scratchpad.dirty=true;}
} catch (_) {}

function scratchpadSelection() {
  const input=scratchpad.element?.querySelector("textarea");
  return input && document.activeElement===input ? {start:input.selectionStart,end:input.selectionEnd,direction:input.selectionDirection,scroll:input.scrollTop} : null;
}

function mountScratchpad(slot, selection) {
  if(!scratchpad.element){
    const el=document.createElement("section");el.className="personal-scratchpad";el.setAttribute("aria-label","Scratchpad");
    el.innerHTML=`<div class="scratchpad-heading"><label for="personal-scratchpad">Scratchpad</label><div><span class="scratchpad-status" role="status" aria-live="polite"></span><button class="scratchpad-clear" type="button">Clear</button></div></div><textarea id="personal-scratchpad" placeholder="Jot something down…" spellcheck="true"></textarea>`;
    scratchpad.element=el;
    const input=el.querySelector("textarea");input.value=scratchpad.text;
    input.addEventListener("input",()=>{
      scratchpad.text=input.value;scratchpad.dirty=true;scratchpad.generation++;scratchpad.error="";
      keepScratchpadDraft();paintScratchpad();clearTimeout(scratchpad.timer);
      scratchpad.timer=setTimeout(saveScratchpad,300);
    });
    input.addEventListener("blur",()=>{if(scratchpad.dirty)saveScratchpad();});
    el.querySelector("button").addEventListener("click",()=>{
      scratchpad.text="";input.value="";scratchpad.dirty=true;scratchpad.generation++;scratchpad.error="";
      keepScratchpadDraft();clearTimeout(scratchpad.timer);paintScratchpad();saveScratchpad();input.focus();
    });
  }
  slot.replaceWith(scratchpad.element);
  if(selection){const input=scratchpad.element.querySelector("textarea");input.focus({preventScroll:true});input.setSelectionRange(selection.start,selection.end,selection.direction);input.scrollTop=selection.scroll;}
  paintScratchpad();
  if(!scratchpad.loaded)loadScratchpad();
}

function keepScratchpadDraft() {
  try{localStorage.setItem(SCRATCHPAD_DRAFT,JSON.stringify({text:scratchpad.text}));}catch(_){scratchpad.error="Storage unavailable";}
}

function paintScratchpad() {
  if(!scratchpad.element)return;
  const status=scratchpad.element.querySelector(".scratchpad-status");
  status.textContent=scratchpad.error||(!scratchpad.loaded?"Loading…":scratchpad.dirty||scratchpad.saving?"Saving…":"Saved");
  status.classList.toggle("scratchpad-error",!!scratchpad.error);
  scratchpad.element.querySelector("button").disabled=!scratchpad.text;
}

async function loadScratchpad() {
  if(scratchpad.loading)return;
  const generation=scratchpad.generation;
  scratchpad.loading=true;
  try{
    const response=await fetch("/api/scratchpad",{cache:"no-store"});
    if(!response.ok)throw new Error();
    const note=await response.json();
    if(!scratchpad.dirty&&generation===scratchpad.generation){
      scratchpad.text=note.text||"";
      const input=scratchpad.element?.querySelector("textarea");if(input)input.value=scratchpad.text;
    }
    scratchpad.loaded=true;if(generation===scratchpad.generation)scratchpad.error="";
    if(scratchpad.dirty)saveScratchpad();
  }catch(_){if(generation===scratchpad.generation)scratchpad.error="Not saved · draft kept";}
  finally{scratchpad.loading=false;paintScratchpad();}
}

function saveScratchpad() {
  clearTimeout(scratchpad.timer);
  if(!scratchpad.dirty)return scratchpad.queue;
  const text=scratchpad.text,generation=scratchpad.generation;
  scratchpad.queue=scratchpad.queue.then(async()=>{
    // A newer queued save includes this edit. Never send stale intermediate text.
    if(generation!==scratchpad.generation)return;
    scratchpad.saving=true;paintScratchpad();
    try{
      const response=await fetch("/api/scratchpad",{method:text?"PUT":"DELETE",headers:{"Content-Type":"application/json"},body:text?JSON.stringify({text}):undefined,keepalive:true});
      if(!response.ok)throw new Error();
      if(generation===scratchpad.generation){scratchpad.dirty=false;scratchpad.loaded=true;scratchpad.error="";try{localStorage.removeItem(SCRATCHPAD_DRAFT);}catch(_){}}
    }catch(_){if(generation===scratchpad.generation){scratchpad.error="Not saved · draft kept";scratchpad.timer=setTimeout(saveScratchpad,3000);}}
    finally{scratchpad.saving=false;paintScratchpad();}
  });
  return scratchpad.queue;
}

addEventListener("pagehide",()=>{if(scratchpad.dirty)saveScratchpad();});
addEventListener("online",()=>{if(scratchpad.dirty)saveScratchpad();else if(scratchpad.element)loadScratchpad();});
document.addEventListener("visibilitychange",()=>{if(document.visibilityState==="visible"&&scratchpad.element){if(scratchpad.dirty)saveScratchpad();else if(document.activeElement!==scratchpad.element.querySelector("textarea"))loadScratchpad();}});
