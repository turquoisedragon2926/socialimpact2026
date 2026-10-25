// One annual step at a time. Slow responses never overlap or skip years.
const speeds=[.5,1,2,4];
let preferredSpeed=1;
export function createPlayback({step,onChange,canStep=()=>true}){
  let playing=false,disposed=false,inFlight=false,pending=null,timer=null;
  const interval=()=>1000/preferredSpeed;
  function schedule(delay=interval()){
    clearTimeout(timer);
    if(playing&&!disposed&&!inFlight)timer=setTimeout(tick,delay);
  }
  function pause(){playing=false;clearTimeout(timer);timer=null;if(!disposed)onChange(false);}
  async function tick(){
    timer=null;
    if(disposed||!playing)return;
    if(document.hidden){pause();return;}
    if(!canStep()){schedule();return;}
    inFlight=true;const started=performance.now();
    try{pending=Promise.resolve().then(step);await pending;}catch{pause();}
    finally{inFlight=false;pending=null;schedule(Math.max(0,interval()-(performance.now()-started)));}
  }
  function visibility(){if(document.hidden)pause();}
  document.addEventListener('visibilitychange',visibility);
  return {
    pause,
    get pending(){return inFlight;},
    async pauseAndWait(){pause();if(pending)await pending.catch(()=>{});},
    toggle(){if(playing)pause();else{playing=true;onChange(true);schedule();}},
    bindSpeed(button){
      function render(){button.textContent=`${preferredSpeed}×`;button.setAttribute('aria-label',`Playback speed ${preferredSpeed}×. Click to change speed.`);button.dataset.tooltip=`${preferredSpeed} simulation years / second`;}
      button.onclick=()=>{preferredSpeed=speeds[(speeds.indexOf(preferredSpeed)+1)%speeds.length];render();schedule();};
      render();
    },
    dispose(){pause();disposed=true;document.removeEventListener('visibilitychange',visibility);}
  };
}

// Keep the same DOM nodes and continuous running indicator across annual requests.
export function renderPlaybackButton(button,{playing,busy,label}){
  if(!button.querySelector('.clock-glyph'))button.innerHTML='<span class="loading-spinner" aria-hidden="true"></span><span class="clock-glyph" aria-hidden="true"></span>';
  button.querySelector('.loading-spinner').hidden=!(playing||busy);
  const glyph=button.querySelector('.clock-glyph'),text=playing?'Ⅱ':busy?'':'▶';
  if(glyph.textContent!==text)glyph.textContent=text;
  button.setAttribute('aria-label',`${playing?'Pause':busy?'Updating':'Play'} ${label}`);
  button.setAttribute('aria-busy',String(busy));
  button.disabled=busy&&!playing;
}
