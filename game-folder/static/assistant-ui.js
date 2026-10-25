export function renderMarkdown(text){
    return DOMPurify.sanitize(marked.parse(text,{gfm:true,breaks:false}),{
      ALLOWED_TAGS:['p','br','strong','em','del','h1','h2','h3','h4','ul','ol','li','blockquote','pre','code','table','thead','tbody','tr','th','td','a','hr'],
      ALLOWED_ATTR:['href','title','align'],ALLOW_DATA_ATTR:false
    });
  }

// Persistent outside the routed map. Closing it never cancels server-side work.
export function createAssistantUI({api,post,escapeHtml:esc,context,onMutation,onView}){
  const root=document.createElement('aside');root.id='assistant-panel';root.hidden=true;root.setAttribute('aria-label','Planning assistant');document.body.append(root);
  const launcher=document.createElement('button');launcher.id='assistant-toggle';launcher.hidden=true;launcher.setAttribute('aria-label','Open assistant');launcher.setAttribute('aria-controls','assistant-panel');launcher.setAttribute('aria-expanded','false');
  launcher.innerHTML='<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20 11.5a7.5 7.5 0 0 1-7.5 7.5H5l-3 3V11.5A7.5 7.5 0 0 1 9.5 4h3A7.5 7.5 0 0 1 20 11.5Z"/><path d="M7 10h8M7 14h5"/></svg><span id="assistant-running" class="sr-only"></span>';
  document.body.append(launcher);
  root.innerHTML=`<button id="close-assistant" class="ghost" aria-label="Close assistant">✕</button><section id="assistant-chat"><div id="assistant-messages" aria-live="polite"></div></section><section id="assistant-tasks" hidden><div class="row between"><strong>Evaluations</strong><button id="back-to-conversation" class="ghost small" aria-label="Back to conversation">←</button></div><div id="task-list"></div></section><div id="assistant-progress" role="status"></div><form id="assistant-form"><label class="sr-only" for="assistant-input">Message the assistant. Enter sends; Shift+Enter inserts a new line; Escape stops the current response. Commands: /clear for a new conversation; /tasks for evaluations.</label><textarea id="assistant-input" placeholder="Add an airport in northeast corner of the city" required maxlength="16000" rows="2"></textarea></form>`;
  const $=id=>document.getElementById(id),terminal=status=>['complete','failed','cancelled','interrupted'].includes(status);
  let user=null,cid=null,tasks=[],history=[],active=null,timer=null,busy=false,lastHistory='',seen=new Set(),tab='chat',generation=0,refreshing=false,initialized=false,errorMessage='',expanded=false,motion=null;
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
    $('task-list').innerHTML=tasks.filter(t=>t.kind==='evaluation').map(t=>`<article class="task-card"><strong>${t.payload.designs.map(d=>esc(d.name)).join(' / ')}</strong><p>${t.payload.designs.map(d=>`revision ${d.revision}`).join(' · ')} · ${t.payload.years.join(', ')}</p><progress max="1" value="${t.progress}"></progress><p>${esc(t.message)}</p><div class="row"><a href="#evaluation/${t.id}">${t.status==='complete'?'View saved results':'View progress'} ↗</a>${!terminal(t.status)?`<button class="small" data-stop-task="${t.id}">Stop</button>`:''}</div></article>`).join('')||'<p class="muted tiny">No evaluations yet. They run independently of your map and playback.</p>';
    root.querySelectorAll('[data-stop-task]').forEach(b=>b.onclick=()=>stopTask(b.dataset.stopTask));
    displayHistory();
  }
  async function refresh(){
    if(!user||refreshing)return;const version=generation;refreshing=true;
    try{
      const next=await api('/tasks');if(version!==generation)return;
      tasks=next;
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
  function open(section=tab){selectTab(section);expanded=true;root.hidden=false;root.inert=false;render();animate(true);$('assistant-input').focus({preventScroll:true});}
  function close(){expanded=false;root.inert=true;render();if(!root.hidden)animate(false);launcher.focus({preventScroll:true});}
  function activate(id){
    if(user!==id){generation++;user=id;cid=id?localStorage.getItem('land-conversation-'+id):null;history=[];tasks=[];seen=new Set();initialized=false;errorMessage='';lastHistory='';clearInterval(timer);if(id){refresh();timer=setInterval(refresh,1500);}else close();}
    launcher.hidden=!id;launcher.onclick=()=>expanded?close():open();render();
  }
  $('close-assistant').onclick=close;
  function selectTab(section){tab=section;$('assistant-chat').hidden=tab!=='chat';$('assistant-tasks').hidden=tab!=='tasks';}
  $('back-to-conversation').onclick=()=>selectTab('chat');
  $('assistant-input').oninput=updateComposer;
  $('assistant-input').onkeydown=e=>{if(e.key==='Enter'&&!e.shiftKey&&!e.isComposing){e.preventDefault();$('assistant-form').requestSubmit();}};
  async function stopTask(id){try{await post(`/tasks/${id}/cancel`);await refresh();}catch(e){errorMessage=e.message;render();}}
  root.addEventListener('keydown',e=>{if(e.key==='Escape'&&!e.isComposing&&expanded&&active){e.preventDefault();e.stopPropagation();if(!e.repeat)stopTask(active.id);}});
  $('assistant-form').onsubmit=async e=>{
    e.preventDefault();const message=$('assistant-input').value.trim();if(!message||busy)return;
    const command=message.toLowerCase();
    if(command==='/tasks'){$('assistant-input').value='';errorMessage='';selectTab('tasks');render();await refresh();return;}
    if(command==='/clear'){
      if(active){errorMessage='Press Escape to stop the current response before clearing.';render();return;}
      generation++;errorMessage='';cid=null;history=[];lastHistory='';$('assistant-input').value='';localStorage.removeItem('land-conversation-'+user);selectTab('chat');render();return;
    }
    if(active)return;
    selectTab('chat');
    busy=true;errorMessage='';render();
    try{const job=await post('/assistant',{message,conversation_id:cid,context:context()});generation++;cid=job.payload.conversation_id;tasks=[job,...tasks.filter(t=>t.id!==job.id)];localStorage.setItem('land-conversation-'+user,cid);$('assistant-input').value='';await refresh();}
    catch(error){errorMessage=error.message;}
    finally{busy=false;render();}
  };
  return {activate,open,close,refresh};
}
