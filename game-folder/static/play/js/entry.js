import {createGame,renderThumbnails} from './game.js';
import {createAudio} from './audio.js';
import {connect,tileValues,CODES} from './connection.js';
import {CHALLENGES,assessChallenge} from '../challenges.js';
import {createPlayback} from '../../playback.js';
import {createCelebration} from './celebration.js';

const $=id=>document.getElementById(id);
const params=new URLSearchParams(location.search),sceneId=params.get('scene');
if(!sceneId)throw new Error('Open Play from a saved design.');
const challenge=CHALLENGES.find(c=>c.id===params.get('character'));
if(!challenge)throw new Error('Choose a character from your design first.');
const backend=await connect(sceneId,Number(params.get('year'))||undefined);
const map=backend.map;
const audio=createAudio();
const celebration=createCelebration();
const game=createGame({container:$('stage'),data:map,audio,hud:{readout(r){
  $('readout').hidden=!r;if(!r)return;
  const cell=backend.result.cells.find(c=>c.id===map.ids[r.index]);
  const ratio=cell?.degradation?.productivity?.performance_ratio;
  $('readout').textContent=`${r.name} · ${Number.isFinite(ratio)?`${ratio.toFixed(3)}× productivity performance`:'Productivity unavailable'}`;
  $('readout').style.left=`${Math.min(innerWidth-230,r.x+16)}px`;
  $('readout').style.top=`${Math.max(10,Math.min(innerHeight-70,r.y+16))}px`;
}}});
let building=false,busy=false,failed=false,playing=false,leaving=false,resetting=false;
let operation=Promise.resolve(),buildDone=null,resolveBuild=null;
const coverNames={10:'Trees',30:'Grassland',40:'Cropland',90:'Wetland',50:'Built-up',60:'Bare land',80:'Water'};
const codes=[10,30,40,90,50,60,80],thumbs=renderThumbnails(codes);
for(const code of codes){
  const button=document.createElement('button');button.className='cover';button.dataset.code=code;
  button.setAttribute('role','radio');button.setAttribute('aria-label',coverNames[code]);button.setAttribute('aria-checked','false');
  const img=document.createElement('img');img.src=thumbs[code];img.alt='';
  const label=document.createElement('span');label.textContent=coverNames[code];button.append(img,label);
  button.onclick=()=>{if(busy||building||failed||playing||!backend.canEdit)return;audio.start();game.setCover(code);};
  $('covers').append(button);
}
$('city-name').textContent=backend.scene.name;
$('goal-who').textContent=challenge.name;$('goal-title').textContent=challenge.title;
$('goal-face').src=`portraits/${challenge.id}.png`;
for(const goal of challenge.goals){const li=document.createElement('li'),name=document.createElement('span'),state=document.createElement('span');name.textContent=goal;state.className='goal-status';li.append(name,state);$('goal-rows').append(li);}
function score(){
  const assessed=backend.year===backend.targetYear;
  const outcome=assessed?assessChallenge(challenge.id,backend.result,backend.reference,map):null;
  document.querySelectorAll('.goal-status').forEach((el,i)=>{const value=outcome?.goals[i];el.dataset.state=String(value);el.textContent=!assessed?'—':value==null?'Unknown':value?'✓':'Not yet';});
  $('goal-result').textContent=!assessed?`Goals checked in ${backend.targetYear}`:outcome.won?'Challenge complete':outcome.goals.includes(null)?'Missing data for some goals.':'Some goals are not met.';
  if(outcome?.won)celebration.celebrate();
  return outcome;
}
function renderClock(){
  const button=$('clock-play'),pending=busy||building;
  if(!button.querySelector('.clock-glyph'))button.innerHTML='<span class="loading-spinner" aria-hidden="true"></span><span class="clock-glyph" aria-hidden="true"></span>';
  button.querySelector('.loading-spinner').hidden=!(playing||pending);
  const icon=playing?'<rect x="7" y="5" width="3" height="14" rx="1"/><rect x="14" y="5" width="3" height="14" rx="1"/>':'<path d="M8 5l11 7-11 7z"/>';
  const glyph=button.querySelector('.clock-glyph');
  if(glyph.dataset.playing!==String(playing)){glyph.innerHTML=`<svg viewBox="0 0 24 24" fill="currentColor">${icon}</svg>`;glyph.dataset.playing=String(playing);}
  glyph.hidden=pending&&!playing;
  button.setAttribute('aria-label',`${playing?'Pause':pending?'Updating':'Play'} simulation`);
  button.setAttribute('aria-busy',String(pending));
}
function update(){
  const locked=busy||building||failed||playing||leaving||resetting||!backend.canEdit;
  game.setActive(!(busy||failed||playing||leaving||resetting||!backend.canEdit));
  $('year').textContent=backend.year;
  renderClock();
  $('clock-play').disabled=failed||resetting||(!playing&&(busy||building||backend.year>=backend.targetYear));
  $('reset-challenge').disabled=resetting||leaving||failed;
  $('back-map').disabled=leaving||resetting;
  $('continue-year').hidden=backend.canEdit;
  $('continue-year').textContent=`Continue to ${backend.latestYear} to edit`;
  $('continue-year').disabled=busy||building||failed;
  $('sel-count').textContent=game.cover?coverNames[game.cover]:`${game.selection.length} selected`;
  $('sel-hint').textContent=busy?'Saving…':!backend.canEdit?'Viewing history. Later edits are preserved.':'Click or drag tiles to paint.';
  $('clear-btn').hidden=!game.selection.length;
  document.querySelectorAll('[data-code]').forEach(b=>{b.disabled=locked;b.setAttribute('aria-checked',String(game.cover===Number(b.dataset.code)));});
}
function showResult(){
  const cells=new Map(backend.result.cells.map(c=>[c.id,c]));
  const changes=[];
  for(let i=0;i<map.ids.length;i++){
    const code=CODES[cells.get(map.ids[i])?.cover]||0;
    if(code&&game.world.codeAt(i)!==code)changes.push({i,code,variant:map.variants[i],style:code===50?map.styles[i]:null,height:code===50?map.heights[i]:0});
  }
  if(changes.length)game.world.setCells(changes);
  game.setTileValues(tileValues(backend.result,map));score();update();
}
function error(err){
  failed=true;playback.pause();$('error-message').textContent=`Could not confirm the latest change. ${err.message}`;$('error').hidden=false;update();
}
async function run(fn){
  busy=true;update();
  operation=(async()=>{try{await fn();showResult();}catch(err){error(err);throw err;}finally{busy=false;update();}})();
  return operation;
}
const playback=createPlayback({onChange:v=>{playing=v;game.setTimelapse(v);update();},canStep:()=>!busy&&!building&&!failed,
  step:async()=>{if(backend.year>=backend.targetYear){playback.pause();return;}await run(()=>backend.advance(backend.year+1));game.clearUndo();if(backend.year>=backend.targetYear)playback.pause();}});
playback.bindSpeed($('speed'));
$('clock-play').onclick=()=>{audio.start();playback.toggle();};
$('continue-year').onclick=()=>run(()=>backend.advance(backend.latestYear)).then(()=>game.clearUndo()).catch(()=>{});
// Reset waits for any current paint or annual step, then restores the entry checkpoint.
$('reset-challenge').onclick=async()=>{
  resetting=true;update();
  try{
    await playback.pauseAndWait();
    if(buildDone)await buildDone;
    await operation.catch(()=>{});
    if(failed)return;
    await run(async()=>{await backend.reset();celebration.reset();});
    game.clearSelection();game.clearUndo();
  }catch{}finally{resetting=false;update();}
};
// The game owns no separate undo/reset history; the challenge checkpoint is authoritative.
game.setUndoHandler(()=>false);
$('clear-btn').onclick=()=>game.clearSelection();
$('health-btn').onclick=()=>game.toggleHealth();
game.on('health',on=>{$('health-btn').setAttribute('aria-pressed',String(on));$('legend').hidden=!on;});
let sound=false;$('sound-btn').onclick=()=>{sound=!sound;audio.start();audio.setMuted?.(!sound);if(!audio.setMuted)audio.toggleMute();$('sound-btn').textContent=sound?'Sound on':'Sound off';$('sound-btn').setAttribute('aria-pressed',String(sound));};
// Audio is opt-in, while preserving the branch's synthesized effects.
audio.toggleMute();
$('tray-toggle').onclick=()=>{const collapsed=$('tray').classList.toggle('collapsed');$('tray-toggle').textContent=collapsed?'Show tiles':'Hide tiles';$('tray-toggle').setAttribute('aria-expanded',String(!collapsed));};
for(const event of ['selection','cover','undo'])game.on(event,update);
game.on('busy',value=>{if(value){building=true;buildDone??=new Promise(resolve=>{resolveBuild=resolve;});update();}});
game.on('build',async()=>{
  if(game.busy)return;
  try{await run(()=>backend.save(game.getMap().codes));}catch{}finally{building=false;resolveBuild?.();buildDone=null;resolveBuild=null;update();}
});
$('back-map').onclick=async()=>{
  leaving=true;update();await playback.pauseAndWait();if(buildDone)await buildDone;await operation.catch(()=>{});
  if(!failed){try{await backend.persistYear();}catch(err){leaving=false;error(err);return;}}
  const back=new URLSearchParams({year:String(backend.year),layer:params.get('layer')||'cover'});
  location.href=`/#scene/${encodeURIComponent(sceneId)}?${back}`;
};
window.addEventListener('beforeunload',e=>{if(building||busy){e.preventDefault();e.returnValue='';}});
window.addEventListener('pagehide',()=>{playback.dispose();celebration.dispose();game.dispose();});
$('loading').hidden=true;$('hud').hidden=false;
if(challenge.cover)game.setCover(challenge.cover);
showResult();
// Useful for the same interaction checks used for the 2D application.
window.planit=game;game.backend=backend;game.assessment=score;
