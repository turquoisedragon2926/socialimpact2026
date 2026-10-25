function appRoute(href){
  try{
    const url=new URL(href,location.href);
    if(url.origin===location.origin&&(url.pathname==='/'||url.pathname===location.pathname)
        &&/^#(?:(?:scene|compare)\/[^?]+|projects|new)(?:\?.*)?$/.test(url.hash))return url.hash;
  }catch{}
  return null;
}

export function renderMarkdown(text){
    const template=document.createElement('template');
    template.innerHTML=DOMPurify.sanitize(marked.parse(text,{gfm:true,breaks:false}),{
      ALLOWED_TAGS:['p','br','strong','em','del','h1','h2','h3','h4','ul','ol','li','blockquote','pre','code','table','thead','tbody','tr','th','td','a','hr'],
      ALLOWED_ATTR:['href','title','align'],ALLOW_DATA_ATTR:false
    });
    for(const link of template.content.querySelectorAll('a[href]')){
      const route=appRoute(link.getAttribute('href'));
      if(route){link.setAttribute('href',route);link.setAttribute('target','_self');}
    }
    return template.innerHTML;
  }

// Persistent outside the routed map. Closing it never cancels server-side work.
export function createAssistantUI({api,post,escapeHtml:esc,context,onMutation,onView}){
  const root=document.createElement('aside');root.id='assistant-panel';root.hidden=true;root.setAttribute('aria-label','Planning assistant');document.body.append(root);
  const launcher=document.createElement('button');launcher.id='assistant-toggle';launcher.hidden=true;launcher.setAttribute('aria-label','Open assistant');launcher.setAttribute('aria-controls','assistant-panel');launcher.setAttribute('aria-expanded','false');
  launcher.innerHTML='<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20 11.5a7.5 7.5 0 0 1-7.5 7.5H5l-3 3V11.5A7.5 7.5 0 0 1 9.5 4h3A7.5 7.5 0 0 1 20 11.5Z"/><path d="M7 10h8M7 14h5"/></svg><span id="assistant-running" class="sr-only"></span>';
  document.body.append(launcher);
  root.innerHTML=`<button id="close-assistant" class="ghost" aria-label="Close assistant">✕</button><section id="assistant-chat"><div id="assistant-messages" aria-live="polite"></div></section><div id="assistant-progress" role="status"></div><form id="assistant-form"><label class="sr-only" for="assistant-input">Message the assistant. Enter sends; Shift+Enter inserts a new line; Escape stops the current response. Use /clear for a new conversation.</label><textarea id="assistant-input" placeholder="Add an airport in northeast corner of the city" required maxlength="16000" rows="2"></textarea></form>`;
  const $=id=>document.getElementById(id),terminal=status=>['complete','failed','cancelled','interrupted'].includes(status);
  root.addEventListener('click',event=>{
    if(event.defaultPrevented||event.button!==0||event.metaKey||event.ctrlKey||event.shiftKey||event.altKey)return;
    const link=event.target.closest('a[href]');
    if(!link||!root.contains(link))return;
    const route=appRoute(link.getAttribute('href'));
    if(!route)return;
    event.preventDefault();event.stopPropagation();location.hash=route;
  });
  let user=null,cid=null,tasks=[],history=[],active=null,timer=null,busy=false,lastHistory='',seen=new Set(),generation=0,refreshing=false,initialized=false,errorMessage='',expanded=false,motion=null;
  function displayHistory(){
    const serialized=JSON.stringify(history);if(serialized===lastHistory)return;lastHistory=serialized;
    const el=$('assistant-messages'),nearBottom=el.scrollHeight-el.scrollTop-el.clientHeight<70;
    el.innerHTML=history.length?history.map(m=>`<article class="assistant-message ${m.role==='user'?'from-user':'from-assistant'}"><div class="markdown">${renderMarkdown(m.text)}</div></article>`).join(''):'';
    if(nearBottom)el.scrollTop=el.scrollHeight;
  }
  function updateComposer(){
    $('assistant-input').disabled=busy;
  }
  function render(){
    active=tasks.find(t=>t.kind==='assistant'&&t.payload.conversation_id===cid&&!terminal(t.status));
    const count=tasks.filter(t=>!terminal(t.status)).length,toggle=$('assistant-toggle');
    if(toggle){$('assistant-running').textContent=count?`${count} running`:'';toggle.classList.toggle('working',count>0);toggle.setAttribute('aria-expanded',String(expanded));toggle.setAttribute('aria-label',`${expanded?'Close':'Open'} assistant${count?` · ${count} running`:''}`);toggle.title=expanded?'Close assistant':'Open assistant';}
    updateComposer();
    $('assistant-progress').textContent=errorMessage||active?.message||'';
    const recent=tasks.find(t=>t.kind==='assistant'&&t.payload.conversation_id===cid);
    if(!active&&!errorMessage&&recent&&['failed','interrupted','cancelled'].includes(recent.status))$('assistant-progress').textContent=recent.message;
    displayHistory();
  }
  async function refresh(){
    if(!user||refreshing)return;const version=generation;refreshing=true;
    try{
      const next=await api('/tasks');if(version!==generation)return;
      tasks=next.filter(t=>t.kind==='assistant');
      const recent=tasks.find(t=>t.kind==='assistant'&&t.payload.conversation_id===cid);
      if(recent){const detail=await api('/tasks/'+recent.id);if(version!==generation)return;Object.assign(recent,detail);}
      if(cid){const requested=cid,c=await api('/conversations/'+requested);if(version!==generation||requested!==cid)return;history=c.history;}
      for(const t of tasks)for(let i=0;i<(t.events||[]).length;i++){
        const key=t.id+':'+i;if(seen.has(key))continue;seen.add(key);
        const event=t.events[i];if(!initialized&&terminal(t.status))continue;
        if(event.kind==='tool_result'&&event.mutation&&!event.result?.error){if(await onMutation(event.result)===false)seen.delete(key);}
        if(event.kind==='view')onView(event.url);
      }
      initialized=true;render();
    }catch(e){if(version===generation)$('assistant-progress').textContent=e.message;}finally{refreshing=false;}
  }
  function animate(opening){
    motion?.cancel();
    const duration=matchMedia('(prefers-reduced-motion: reduce)').matches?0:180;
    motion=root.animate(opening?[{opacity:0,transform:'translateY(12px) scale(.96)'},{opacity:1,transform:'none'}]:[{opacity:1,transform:'none'},{opacity:0,transform:'translateY(12px) scale(.96)'}],{duration,easing:'cubic-bezier(.2,.8,.2,1)'});
    motion.onfinish=()=>{if(!expanded)root.hidden=true;motion=null;};
  }
  function open(){expanded=true;root.hidden=false;root.inert=false;render();animate(true);$('assistant-input').focus({preventScroll:true});}
  function close(){expanded=false;root.inert=true;render();if(!root.hidden)animate(false);launcher.focus({preventScroll:true});}
  function activate(id){
    if(user!==id){generation++;user=id;cid=id?localStorage.getItem('land-conversation-'+id):null;busy=false;active=null;$('assistant-input').value='';history=[];tasks=[];seen=new Set();initialized=false;errorMessage='';lastHistory='';clearInterval(timer);if(id){refresh();timer=setInterval(refresh,1500);}else close();}
    launcher.hidden=!id;launcher.onclick=()=>expanded?close():open();render();
  }
  $('close-assistant').onclick=close;
  $('assistant-input').oninput=updateComposer;
  $('assistant-input').onkeydown=e=>{if(e.key==='Enter'&&!e.shiftKey&&!e.isComposing){e.preventDefault();$('assistant-form').requestSubmit();}};
  async function stopTask(id){try{await post(`/tasks/${id}/cancel`);await refresh();}catch(e){errorMessage=e.message;render();}}
  root.addEventListener('keydown',e=>{if(e.key==='Escape'&&!e.isComposing&&expanded&&active){e.preventDefault();e.stopPropagation();if(!e.repeat)stopTask(active.id);}});
  $('assistant-form').onsubmit=async e=>{
    e.preventDefault();const message=$('assistant-input').value.trim();if(!message||busy)return;
    const command=message.toLowerCase();
    if(command==='/clear'){
      if(active){errorMessage='Press Escape to stop the current response before clearing.';render();return;}
      generation++;errorMessage='';cid=null;history=[];lastHistory='';$('assistant-input').value='';localStorage.removeItem('land-conversation-'+user);render();return;
    }
    if(active)return;

    busy=true;errorMessage='';render();
    let requestGeneration=generation;
    try{
      const job=await post('/assistant',{message,conversation_id:cid,context:context()});
      // A workspace switch invalidates pending UI work, even if we switch back later.
      if(requestGeneration!==generation)return;
      requestGeneration=++generation;cid=job.payload.conversation_id;tasks=[job,...tasks.filter(t=>t.id!==job.id)];localStorage.setItem('land-conversation-'+user,cid);$('assistant-input').value='';await refresh();
    }catch(error){if(requestGeneration===generation)errorMessage=error.message;}
    finally{if(requestGeneration===generation){busy=false;render();}}
  };
  return {activate,open,close,refresh};
}
