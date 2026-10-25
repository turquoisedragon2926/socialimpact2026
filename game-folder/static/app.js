import {createPlayback,renderPlaybackButton} from './playback.js?v=cdb452bd9692';
import {hideHover} from './hover-ui.js';
import {loadingState,errorState} from './loading-ui.js';
import {createAssistantUI} from './assistant-ui.js';
import {renderComparisonChart} from './comparison-chart.js?v=3c96c8153697';
const $ = id => document.getElementById(id);
const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const numberFormats=new Map();
const fmt=(v,digits=1)=>{
  if(v==null||!Number.isFinite(v))return '—';
  if(!numberFormats.has(digits))numberFormats.set(digits,new Intl.NumberFormat(undefined,{maximumFractionDigits:digits}));
  return numberFormats.get(digits).format(v);
};
const signed = v => v == null ? '—' : `${v > 0 ? '+' : ''}${fmt(v)}`;
const colors = {trees:'#688d57',grass:'#b5cc79',crops:'#dbc889',wetland:'#86b7a3',built:'#b9aaa1',bare:'#e3d7bb',water:'#88b7c7',unknown:'#d9dcd6'};
const names = {trees:'Forest',grass:'Grassland',crops:'Cropland',wetland:'Wetland',built:'Artificial area',bare:'Bare land',water:'Water',unknown:'Unknown'};
const statusColors = {improving:'#2c6015',stable:'#ffffe1',declining:'#882e7b',unknown:'#dcded9'};
// Fixed display ranges keep colors comparable across years and alternatives.
// End colors saturate; tooltips retain the exact value. These are not thresholds.
const numericLayers = {
  change:{label:'Soil-carbon change',field:'delta_pct',metric:'carbon_change_pct',unit:'%',digits:2,min:-100,mid:0,max:100,help:'Percentage change from the original soil-carbon stock. Gray means no usable baseline. The clock shows change in total known stock.'},
  trajectory:{label:'Productivity trend',field:'slope',metric:'productivity_slope',unit:' NDVI/year',digits:4,min:-.05,mid:0,max:.05,help:'Slope of annual simulated NDVI over elapsed years. Available after 10 annual samples; magnitude is not statistical confidence.'},
  state:{label:'Productivity state',field:'state_class_change',metric:'productivity_state_class_change',unit:' ranks',digits:2,min:-9,mid:0,max:9,help:'Recent mean NDVI rank minus reference mean rank. Integer differences per cell, not a continuous measurement. Available after 13 annual samples.'},
  performance:{label:'Productivity performance',field:'performance_ratio',metric:'productivity_performance_ratio',unit:'×',digits:3,min:0,mid:1,max:1.5,help:'Mean simulated NDVI divided by the scene-local 90th percentile for the same original cover. 1× equals that benchmark; above 1× is possible. Comparison groups lack soil type.'}
};
const mapLayers=[['cover','Land cover'],['ndvi','Vegetation'],['soc','Soil carbon'],['performance','Productivity performance'],['degradation','Land degradation']];
function canonicalLayer(layer){
  if(layer==='change')return 'soc';
  if(['trajectory','state'].includes(layer))return 'performance';
  return mapLayers.some(([key])=>key===layer)?layer:'cover';
}
const isNumericMap=layer=>['ndvi','soc','performance'].includes(layer);
function numericValue(cell,kind){return kind==='change'?cell.delta_pct:cell.degradation?.productivity?.[numericLayers[kind]?.field];}
function numericColor(cell,kind){
  return numericValueColor(numericValue(cell,kind),kind);
}
function numericValueColor(value,kind){
  const scale=numericLayers[kind];
  if(!Number.isFinite(value))return colors.unknown;
  return value<scale.mid?blend('882e7b','ffffe1',(value-scale.min)/(scale.mid-scale.min)):blend('ffffe1','2c6015',(value-scale.mid)/(scale.max-scale.mid));
}
function numericLegend(kind){
  const n=numericLayers[kind],mid=100*(n.mid-n.min)/(n.max-n.min);
  return `<strong>${n.label} · ${n.unit.trim()}</strong><div class="legend-gradient" style="background:linear-gradient(90deg,#882e7b 0%,#ffffe1 ${mid}%,#2c6015 100%)"></div><div class="legend-range numeric-range"><span>≤ ${n.min}</span><span style="left:${mid}%">${n.mid}</span><span>≥ ${n.max}</span></div><div><i class="swatch" style="background:${colors.unknown}"></i>Unavailable</div>`;
}
const climates = {temperate_dry:'Temperate · dry',temperate_moist:'Temperate · moist',tropical_dry:'Tropical · dry',tropical_moist:'Tropical · moist',tropical_montane:'Tropical · montane'};
const palette = ['#416e51','#b47351','#8c83a5','#718fa1','#b0a05b','#c07080'];
const S = {user:null, scenes:[], selected:new Set(), scene:null, result:null, baseIndex:new Map(), resultIndex:new Map(), cells:new Map(), layer:'cover', selection:new Set(), busy:false, map:null, playing:false, playback:null, brush:'inspect', pending:new Map(), paintQueue:[], stroke:null, cleanup:null, timelineKey:null, timeline:null, timelineError:false};
let toastTimer, routeToken=0, paintTask=null, routeController=null;
const logo = `<a class="logo" href="#projects" aria-label="phone na hello home"><svg viewBox="0 0 32 32" aria-hidden="true"><rect width="32" height="32" rx="9" fill="#214f40"/><path d="m6 12 10-6 10 6-10 6z" fill="#dce9ad"/><path d="m6 20 10 6 10-6M6 16l10 6 10-6" fill="none" stroke="#dce9ad" stroke-width="1.6"/></svg>phone na hello<span style="color:#88a367">.</span></a>`;

async function api(path, options={}) {
  const r = await fetch(`/api${path}`, {...options, headers:{'Content-Type':'application/json',...options.headers}});
  const data = await r.json();
  if (!r.ok) {
    if(r.status === 401 && S.user && !path.startsWith('/auth')) { S.user=null; renderLogin(); }
    const error=new Error(typeof data.detail === 'string' ? data.detail : 'Check your inputs and try again.');error.status=r.status;throw error;
  }
  return data;
}
const routeApi=(path,options={})=>api(path,{...options,signal:routeController?.signal});
const post = (path, data={}) => api(path,{method:'POST',body:JSON.stringify(data)});
function toast(message) { $('toast').textContent=message; $('toast').classList.add('visible');clearTimeout(toastTimer);toastTimer=setTimeout(()=>$('toast').classList.remove('visible'),4800); }
function fail(error) { if(error.name!=='AbortError')toast(error.message || String(error)); }
function header() {
  return `<header class="topbar">${logo}<nav class="nav" aria-label="Main navigation"><a href="#projects" class="active">My projects</a><span class="subtle-divider"></span><span class="email muted">${esc(S.user?.email)}</span><span class="avatar" aria-hidden="true">${esc(S.user?.email[0].toUpperCase())}</span><button id="logout" class="ghost small">Sign out</button></nav></header>`;
}
function mount(body,{navigation=true}={}) {
  hideHover();
  pauseSimulation();
  S.cleanup?.(); S.cleanup=null;
  if(S.map) {S.map.remove();S.map=null;}
  $('app').innerHTML=(navigation?header():'')+body;
  $('app').inert=false;
  assistantUI.activate(S.user?.id);
  if($('logout'))$('logout').onclick=async()=>{if(paintTask)await paintTask;await post('/logout');S.user=null;S.selected.clear();renderLogin();};
}
function routeState(path,message,error=false){
  const design=['scene','compare'].includes(path);
  const back=design?`<a class="design-back" href="#projects" aria-label="Back to projects" title="Back to projects">${regionIcon('back')}</a>`:'';
  mount(`<main id="main" class="loading-screen${design?' design-workspace':''}" aria-busy="${!error}">${back}<div class="loading-content">${error?errorState(message,'retry-route'):loadingState(message)}</div></main>`,{navigation:!design&&!!S.user});
  if(error)$('retry-route').onclick=()=>route();
}
function dialog(title, body, extra='') {
  hideHover();
  $('dialog').innerHTML=`<div class="row between"><h2 style="margin:0">${esc(title)}</h2><button id="close-dialog" class="ghost" aria-label="Close dialog">✕</button></div>${body}${extra}`;
  $('close-dialog').onclick=()=>$('dialog').close();
  if(!$('dialog').open)$('dialog').showModal();
}
function polygons(g) {return g.type === 'Polygon' ? [g.coordinates] : g.type === 'MultiPolygon' ? g.coordinates : [];}
function miniMap(cells, width=400, height=180, mode='cover') {
  if(!cells?.length)return '';
  let minX=Infinity,minY=Infinity,maxX=-Infinity,maxY=-Infinity;
  for(const c of cells)for(const poly of polygons(c.geometry))for(const ring of poly)for(const [x,y] of ring){minX=Math.min(minX,x);minY=Math.min(minY,y);maxX=Math.max(maxX,x);maxY=Math.max(maxY,y);}
  const aspect=Math.cos((minY+maxY)/2*Math.PI/180), scale=Math.min((width-20)/((maxX-minX)*aspect),(height-20)/(maxY-minY));
  const dx=(width-(maxX-minX)*aspect*scale)/2,dy=(height-(maxY-minY)*scale)/2;
  const paths=cells.map(c=>`<path d="${polygons(c.geometry).map(p=>p.map(r=>r.map(([x,y],i)=>`${i?'L':'M'}${(dx+(x-minX)*aspect*scale).toFixed(1)},${(height-dy-(y-minY)*scale).toFixed(1)}`).join(' ')+'Z').join(' ')).join(' ')}" fill="${numericLayers[mode]?numericColor(c,mode):colors[c.cover]||colors.unknown}" stroke="#f7f8f3" stroke-width="${numericLayers[mode]?.15:.65}" fill-rule="evenodd"/>`).join('');
  return `<svg viewBox="0 0 ${width} ${height}" role="img" aria-label="${numericLayers[mode]?.label||'Land-cover'} cells for this scene">${paths}</svg>`;
}

function renderLogin() {
  routeController?.abort();S.timelineController?.abort();++routeToken;
  assistantUI.activate(null);
  pauseSimulation();S.cleanup?.();S.cleanup=null;
  if(S.map){S.map.remove();S.map=null;}
  $('app').innerHTML=`<main id="main" class="login"><section class="login-story">${logo}<h1 class="two-lines"><span>A shared future.</span><em>Your part in it.</em></h1><div id="hero-grid" class="hero-grid"></div><div class="story-footer"><span>Built for community voices</span><span>San Francisco · 2026</span></div></section><section class="login-form-wrap"><form id="auth-form" class="login-form"><h1>Make room for possibility.</h1><div class="email-entry"><input id="email" name="email" type="email" autocomplete="email" aria-label="Email address" placeholder="you@example.com" required maxlength="254" aria-describedby="auth-error"><button id="auth-submit" class="email-arrow" type="submit" aria-label="Continue"><span aria-hidden="true">↗</span></button></div><div id="auth-error" class="form-error" role="alert"></div></form></section></main>`;
  fetch('/static/ggp-preview.json').then(r=>r.json()).then(c=>{if($('hero-grid'))$('hero-grid').innerHTML=miniMap(c,600,230);}).catch(()=>{});
  $('auth-form').onsubmit=async e=>{e.preventDefault();$('auth-submit').disabled=true;$('auth-submit').setAttribute('aria-busy','true');$('auth-submit').innerHTML='<span class="loading-spinner" aria-hidden="true"></span>';$('auth-error').textContent='';try{S.user=await post('/auth/enter',{email:$('email').value});if(location.hash==='#projects')await route();else location.hash='#projects';}catch(err){if($('auth-error')){$('auth-error').textContent=err.message;$('auth-submit').disabled=false;$('auth-submit').removeAttribute('aria-busy');$('auth-submit').textContent='↗';}}};
}

async function projects(token) {
  const scenes=await routeApi('/scenes?summary=true');if(token!==routeToken)return;S.scenes=scenes;
  S.selected=new Set([...S.selected].filter(id=>scenes.some(s=>s.id===id)));
  mount(`<main id="main" class="page"><div class="page-heading"><div><span class="eyebrow">Your landscape, your possibilities</span><h1>Places to make a difference.</h1></div></div><div class="row between sectionbar"><strong>${scenes.length} saved ${scenes.length===1?'scene':'scenes'}</strong></div><section class="cards" aria-label="Saved scenes">${scenes.map(s=>`<article class="card ${S.selected.has(s.id)?'selected':''}" data-card="${s.id}"><div class="card-preview"><img src="/api/scenes/${s.id}/preview.svg?revision=${s.revision}" alt="Land-cover preview for ${esc(s.name)}" loading="lazy" decoding="async"><label class="select-card"><input type="checkbox" data-select="${s.id}" aria-label="Select ${esc(s.name)} for comparison" ${S.selected.has(s.id)?'checked':''}> Compare</label></div><div class="card-body"><span class="badge ${(s.action_count??s.actions?.length??0)?'warm':''}">${(s.action_count??s.actions?.length??0)?`${(s.action_count??s.actions?.length??0)} ${(s.action_count??s.actions?.length??0)===1?'intervention':'interventions'}`:'Unchanged baseline'}</span><h3><a class="scene-link" href="#scene/${s.id}">${esc(s.name)}</a></h3><p>${esc(s.place)} · ${s.cell_count} cells</p><div class="card-meta"><span>${s.year} → ${s.selected_year}</span></div></div></article>`).join('')}<button class="create-card" id="create-card" aria-label="Create a world"><span class="plus" aria-hidden="true">＋</span></button></section><div id="compare-tray"></div></main>`);
  $('create-card').onclick=()=>location.hash='#new';
  document.querySelectorAll('[data-select]').forEach(b=>b.onchange=()=>{if(b.checked)S.selected.add(b.dataset.select);else S.selected.delete(b.dataset.select);document.querySelector(`[data-card="${b.dataset.select}"]`).classList.toggle('selected',b.checked);comparisonTray();});
  comparisonTray();
}
function comparisonTray(){
  const count=S.selected.size,chosen=S.scenes.filter(s=>S.selected.has(s.id));
  const compatible=new Set(chosen.map(s=>JSON.stringify([s.baseline_id,s.climate,s.model_version,s.ndvi_model_version]))).size<=1;
  $('compare-tray').innerHTML=count?`<div class="comparison-tray"><p><strong>${count} selected</strong><br>${compatible?'Compare alternatives from the same starting landscape.':'Choose scenes with the same starting data, climate and model.'}</p><button id="compare-selected" ${count<2||count>12||!compatible?'disabled':''}>Compare scenarios ↗</button></div>`:'';
  if(count)$('compare-selected').onclick=()=>location.hash=`#compare/${[...S.selected].join(',')}`;
}

function baseMap(id, bounds){
  const map=L.map(id,{zoomSnap:.25,zoomControl:false,scrollWheelZoom:true,doubleClickZoom:false,boxZoom:false,touchZoom:true,keyboard:true,dragging:true,attributionControl:true});
  L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png',{maxZoom:19,attribution:'© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'}).addTo(map);
  map.fitBounds(bounds,{padding:[28,65]});
  L.control.zoom({position:'bottomright'}).addTo(map);
  L.control.scale({position:'bottomright',imperial:false,maxWidth:100}).addTo(map);
  S.map=map;
  addNeighborhoods(map);
  return map;
}
async function addNeighborhoods(map){
  if(!map.getBounds().intersects([[37.708,-122.515],[37.834,-122.356]]))return;
  try{
    const response=await fetch('/static/data/sf-neighborhoods.geojson');
    if(!response.ok)throw new Error('Neighborhood outlines could not load.');
    const data=await response.json();
    if(S.map!==map)return;
    const pane=map.createPane('neighborhoods');
    pane.style.zIndex=450;pane.style.pointerEvents='none';
    L.geoJSON(data,{pane:'neighborhoods',interactive:false,style:{className:'neighborhood-outline',color:'#344e43',weight:1.2,opacity:.65,fill:false}}).addTo(map);
    map.attributionControl.addAttribution('<a href="https://data.sf.gov/d/j2bu-swwd">DataSF neighborhoods</a>');
  }catch(error){if(S.map===map)fail(error);}
}
function latBounds(b){return [[b[1],b[0]],[b[3],b[2]]];}
function regionIcon(name){
  const paths={back:'<path d="m12 5-7 7 7 7M5 12h14"/>',search:'<circle cx="10.5" cy="10.5" r="6.5"/><path d="m16 16 4 4"/>',settings:'<path d="M4 7h8m4 0h4M4 17h3m4 0h9"/><circle cx="14" cy="7" r="2"/><circle cx="9" cy="17" r="2"/>',info:'<circle cx="12" cy="12" r="9"/><path d="M12 11v6m0-10v.01"/>',arrow:'<path d="M6 18 18 6M6 6h12v12"/>',chevron:'<path d="m7 10 5 5 5-5"/>'};
  return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths[name]}</svg>`;
}
async function newScene(token){
  let place={lat:37.7694,lon:-122.4862,name:'Golden Gate Park'};
  mount(`<main id="main" class="region-screen"><div id="map" class="map" aria-label="Pan to a place, then move or resize the selection"></div><section class="region-search"><div class="row"><a href="#projects" class="back region-icon-button" aria-label="All projects">${regionIcon('back')}</a><form id="search-form" class="row grow"><input id="place-search" aria-label="Search for a place" placeholder="Search for a place" minlength="3" required><button class="region-icon-button" aria-label="Search places">${regionIcon('search')}</button></form><button id="region-settings" class="ghost region-icon-button" aria-label="Region settings">${regionIcon('settings')}</button></div><div id="search-results" class="search-results" role="status"></div></section><button id="region-info" class="map-info-button" aria-label="Data information">${regionIcon('info')}</button><div class="region-hint"><span id="area-note" role="status"></span><span id="region-instruction">Drag the center to move · corners to resize</span><div class="row"><button id="recenter-region" class="small">Select here</button><button id="select-city" class="small">All San Francisco</button></div></div><div class="create-dock"><div class="baseline-field"><label for="baseline-year">Baseline year</label><div class="baseline-select"><select id="baseline-year"><option>2021</option><option>2020</option></select>${regionIcon('chevron')}</div></div><button id="create-world" class="primary" aria-label="Create world"><span>Create</span>${regionIcon('arrow')}</button></div><div id="creation-progress" class="busy-overlay" hidden>${loadingState('Creating design…',{id:'progress-message'})}<a href="#projects" class="loading-back">Back to projects</a></div></main>`);
  const map=baseMap('map',[[37.755,-122.523],[37.788,-122.449]]);
  let bounds=L.latLngBounds([[37.765,-122.509],[37.774,-122.457]]),climate='temperate_dry',cityBoundary=null,citySelected=false,cityRequest=0,searchRequest=0;
  const rectangle=L.rectangle(bounds,{color:'#214f40',weight:2,fillColor:'#a3bc86',fillOpacity:.18,interactive:false}).addTo(map);
  const handleIcon=kind=>L.divIcon({className:`region-handle ${kind}`,html:kind==='center'?'✥':'',iconSize:kind==='center'?[32,32]:[16,16],iconAnchor:kind==='center'?[16,16]:[8,8]});
  const corners=Array.from({length:4},()=>L.marker([0,0],{draggable:true,icon:handleIcon('corner'),autoPan:true}).addTo(map));
  const center=L.marker(bounds.getCenter(),{draggable:true,icon:handleIcon('center'),autoPan:true}).addTo(map);
  function coordinates(){return [bounds.getWest(),bounds.getSouth(),bounds.getEast(),bounds.getNorth()];}
  function refresh(){
    rectangle.setBounds(bounds);
    [bounds.getSouthWest(),bounds.getNorthWest(),bounds.getNorthEast(),bounds.getSouthEast()].forEach((p,i)=>corners[i].setLatLng(p));
    center.setLatLng(bounds.getCenter());
    const width=map.distance(bounds.getSouthWest(),bounds.getSouthEast()),height=map.distance(bounds.getSouthWest(),bounds.getNorthWest()),ha=width*height/10000;
    const valid=ha>=1&&ha<=25000&&Math.max(width,height)<=25000;
    $('area-note').textContent=valid?`${fmt(ha,0)} ha · ~${Math.ceil(width/145)*Math.ceil(height/145)} cells`:'Select 1–25,000 ha · sides up to 25 km';
    $('create-world').disabled=!valid;
  }
  corners.forEach((marker,i)=>{
    let opposite;
    marker.on('dragstart',()=>{opposite=corners[(i+2)%4].getLatLng();});
    marker.on('drag',()=>{bounds=L.latLngBounds(opposite,marker.getLatLng());rectangle.setBounds(bounds);center.setLatLng(bounds.getCenter());});
    marker.on('dragend',refresh);
    marker.getElement().setAttribute('aria-label',`Resize region corner ${i+1}`);
  });
  let dragStart,original;
  center.on('dragstart',()=>{dragStart=bounds.getCenter();original=coordinates();});
  center.on('drag',()=>{const p=center.getLatLng(),dy=p.lat-dragStart.lat,dx=p.lng-dragStart.lng;bounds=L.latLngBounds([[original[1]+dy,original[0]+dx],[original[3]+dy,original[2]+dx]]);rectangle.setBounds(bounds);});
  center.on('dragend',()=>{const c=bounds.getCenter();place={lat:c.lat,lon:c.lng,name:'Selected region'};refresh();});
  center.getElement().setAttribute('aria-label','Move selected region');
  function customRegion(){
    cityRequest++;citySelected=false;
    if(cityBoundary){map.removeLayer(cityBoundary);cityBoundary=null;}
    for(const layer of [rectangle,center,...corners])if(!map.hasLayer(layer))layer.addTo(map);
    $('select-city').classList.remove('active');$('region-instruction').textContent='Drag the center to move · corners to resize';
  }
  async function selectCity(){
    const request=++cityRequest;
    const feature=await routeApi('/regions/sf');if(token!==routeToken||request!==cityRequest)return;
    if(cityBoundary)map.removeLayer(cityBoundary);
    citySelected=true;place={lat:37.77,lon:-122.44,name:'San Francisco',place:'sf'};
    for(const layer of [rectangle,center,...corners])map.removeLayer(layer);
    cityBoundary=L.geoJSON(feature,{style:{color:'#214f40',weight:1.5,fillColor:'#a3bc86',fillOpacity:.2},interactive:false}).addTo(map);
    map.fitBounds(cityBoundary.getBounds(),{padding:[45,100]});
    $('area-note').textContent=`${fmt(feature.properties.area_km2,1)} km² · 165 m cells`;
    $('place-search').value='San Francisco';$('create-world').disabled=false;
    $('select-city').classList.add('active');$('region-instruction').textContent='All 41 mapped neighborhoods · includes Treasure Island';
  }
  function moveTo(p){
    customRegion();place=p;
    const c=bounds.getCenter(),dy=p.lat-c.lat,dx=p.lon-c.lng,b=coordinates();
    bounds=L.latLngBounds([[b[1]+dy,b[0]+dx],[b[3]+dy,b[2]+dx]]);
    map.fitBounds(bounds,{padding:[45,100]});refresh();
  }
  refresh();
  $('select-city').onclick=()=>selectCity().catch(fail);
  $('recenter-region').onclick=()=>{const c=map.getCenter();moveTo({lat:c.lat,lon:c.lng,name:'Selected region'});};
  $('region-info').onclick=()=>dialog('Starting data',`<p>WorldCover land cover and matching annual NDVI composites: 2020 or 2021, at 10 m. Decision cells use a 145 m grid for rectangles or a 165 m grid for the San Francisco neighborhood footprint.</p><p>Soil carbon uses SoilGrids estimates at 250 m, without a single observation year. Missing data stays unknown.</p><p>Play the clock to model soil-carbon and vegetation responses after your edits. Observed NDVI stays available in cell details.</p>`);
  $('region-settings').onclick=()=>{
    const b=citySelected?[cityBoundary.getBounds().getWest(),cityBoundary.getBounds().getSouth(),cityBoundary.getBounds().getEast(),cityBoundary.getBounds().getNorth()]:coordinates();
    dialog('Region settings',`<form id="region-form"><label for="climate">Climate assumption</label><select id="climate">${Object.entries(climates).map(([v,n])=>`<option value="${v}" ${v===climate?'selected':''}>${n}</option>`).join('')}</select><p>Used for soil-carbon transitions involving cropland. Check it for your location.</p><div class="bounds-fields">${['West','South','East','North'].map((n,i)=>`<label>${n}<input id="bound-${i}" type="number" step="any" value="${b[i]}" required></label>`).join('')}</div><button class="primary">Use region</button></form>`);
    $('region-form').onsubmit=e=>{e.preventDefault();const v=[0,1,2,3].map(i=>Number($(`bound-${i}`).value));if(!(v[0]<v[2]&&v[1]<v[3]&&v[0]>=-179&&v[2]<=179&&v[1]>=-60&&v[3]<=80)){toast('Check the region coordinates.');return;}climate=$('climate').value;if(citySelected&&v.every((x,i)=>x===b[i])){$('dialog').close();return;}customRegion();bounds=L.latLngBounds(latBounds(v));const c=bounds.getCenter();place={lat:c.lat,lon:c.lng,name:'Selected region'};map.panTo(c);refresh();$('dialog').close();};
  };
  $('search-form').onsubmit=async e=>{
    e.preventDefault();const request=++searchRequest;$('search-results').innerHTML=loadingState('Searching places…',{compact:true});
    try{const hits=await routeApi(`/search?q=${encodeURIComponent($('place-search').value)}`);if(token!==routeToken||request!==searchRequest)return;$('search-results').innerHTML=hits.length?hits.map((p,i)=>`<button data-hit="${i}">${esc(p.name)}</button>`).join(''):'No places found.';document.querySelectorAll('[data-hit]').forEach(b=>b.onclick=()=>{const p=hits[Number(b.dataset.hit)];if(/^San Francisco(?:,|$)/i.test(p.name)&&Math.abs(p.lat-37.77)<.2&&Math.abs(p.lon+122.44)<.2){selectCity().catch(fail);}else{moveTo(p);$('place-search').value=p.name.split(',')[0];}$('search-results').innerHTML='';});}catch(err){if(token===routeToken&&request===searchRequest&&err.name!=='AbortError'){$('search-results').innerHTML=errorState(err.message,'retry-search',{compact:true});$('retry-search').onclick=()=>$('search-form').requestSubmit();}}
  };
  $('create-world').onclick=async()=>{
    const c=citySelected?L.latLng(place.lat,place.lon):bounds.getCenter(),label=place.name.split(',')[0];
    const body={name:`${label} · first idea`.slice(0,100),lat:c.lat,lon:c.lng,bounds:citySelected?null:coordinates(),place:citySelected?'sf':null,location_name:label,year:Number($('baseline-year').value),climate};
    $('create-world').disabled=true;$('create-world').setAttribute('aria-busy','true');$('progress-message').textContent='Creating design…';$('creation-progress').hidden=false;
    try{
      const job=await post('/scenes',body);
      while(token===routeToken){
        const state=await routeApi(`/jobs/${job.job_id}`);
        if(token!==routeToken)return;
        if(state.status==='complete'){location.hash=`#scene/${state.scene_id}`;return;}
        if(state.status==='failed')throw new Error(state.message);
        $('progress-message').textContent=state.message;
        await new Promise(r=>setTimeout(r,1200));
      }
    }catch(err){if(token===routeToken){fail(err);$('create-world').removeAttribute('aria-busy');$('creation-progress').hidden=true;if(citySelected)$('create-world').disabled=false;else refresh();}}
  };
}

async function openScene(id,token,params=new URLSearchParams()){
  const scene=await routeApi(`/scenes/${id}`);
  if(token!==routeToken)return;
  const viewYear=Number(params.get('year'))||scene.selected_year;
  const result=await routeApi(`/scenes/${id}/evaluate?year=${viewYear}`);
  if(token!==routeToken)return;
  S.scene=scene;S.result=result;S.baseIndex=new Map(scene.baseline.cells.map(c=>[c.id,c]));S.resultIndex=new Map(result.cells.map(c=>[c.id,c]));S.selection.clear();S.cells.clear();S.busy=false;S.resetting=false;
  const b=scene.baseline;
  S.layer=canonicalLayer(params.get('layer')||S.layer);
  S.brush='inspect';S.pending.clear();S.paintQueue=[];
  mount(`<main id="main" class="workspace paint-workspace floating-workspace design-workspace"><section class="map-column" aria-label="Scenario map"><h1 id="scene-title" class="sr-only">${esc(scene.name)}</h1><span id="save-status" class="sr-only">Saved</span><div class="map-area"><div id="map" class="map" role="region" aria-label="Hover for cell details. Select a brush, then click or drag to paint."></div><a class="design-back" href="#projects" aria-label="Back to projects" title="Back to projects"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M19 12H5m7-7-7 7 7 7"/></svg></a><div class="brush-toolbar" role="toolbar" aria-label="Land-cover brushes">${Object.keys(names).filter(k=>k!=='unknown').map(k=>`<button data-brush="${k}" style="--brush-color:${colors[k]}" aria-label="Paint ${names[k]}" aria-pressed="false" data-tooltip="${names[k]}">${brushIcon(k)}</button>`).join('')}</div><div class="map-compass">N<br><strong>↑</strong></div><div class="map-view-control"><div class="layer-tiles" role="group" aria-label="Map layers">${mapLayers.map(([v,n])=>`<button data-layer="${v}" aria-label="${n}" data-tooltip="${n}" aria-pressed="${S.layer===v}">${layerIcon(v)}</button>`).join('')}</div></div><button id="evidence" class="map-info-button" aria-label="Sources and model assumptions" title="Sources & model assumptions">${regionIcon('info')}</button><section class="comparison-summary design-summary" aria-label="Design metrics"><div id="simulation-metrics" aria-live="off"></div><div id="legend" class="legend panel-legend"></div></section><section class="comparison-clock simulation-dock" aria-label="Simulation clock"><div class="row"><button id="play-simulation" class="clock-button" aria-label="Play simulation">▶</button><input id="simulation-year" aria-label="Simulation year" type="number" min="${b.year}" step="1" value="${viewYear}"><span id="year-label" class="sr-only">${viewYear}</span><span id="clock-state" class="sr-only">Paused</span><button id="simulation-speed" class="clock-speed" type="button">1×</button><button id="reset-baseline" class="ghost small" aria-label="Reset design" title="Restore original land cover and year">↺ Reset</button></div></section></div></section></main>`,{navigation:false});
  if(params.get('focus'))S.selection=new Set(params.get('focus').split(',').filter(id=>S.baseIndex.has(id)));
  const view=params.get('focus')?focusExtent(b,new Set(params.get('focus').split(','))).bounds:b.bounds;
  const map=baseMap('map',latBounds(view));
  L.geoJSON({type:'FeatureCollection',features:b.cells.map(c=>({type:'Feature',geometry:c.geometry,properties:{id:c.id}}))},{style:f=>cellStyle(f.properties.id),onEachFeature:(f,layer)=>{S.cells.set(f.properties.id,layer);}}).addTo(map);
  for(const [id,layer] of S.cells){
    const path=layer.getElement();if(!path)continue;
    path.dataset.cell=id;path.tabIndex=0;path.setAttribute('role','button');path.setAttribute('aria-label',`Cell ${id}. Focus for details; Enter paints with the active brush.`);
    path.addEventListener('focus',()=>{S.selection=new Set([id]);window.dispatchEvent(new Event('land-context'));ensureCellTooltip(id,layer);layer.openTooltip(layer.getBounds().getCenter());});
    layer.on('click',()=>{S.selection=new Set([id]);window.dispatchEvent(new Event('land-context'));});
    layer.on('mouseover',event=>{
      if(S.stroke||map.dragging.moving())return;
      ensureCellTooltip(id,layer);layer.openTooltip(event.latlng);
    });
    path.addEventListener('blur',()=>layer.closeTooltip());
    path.addEventListener('keydown',e=>{if(e.key==='Escape'){chooseBrush('inspect');return;}if((e.key==='Enter'||e.key===' ')&&S.brush!=='inspect'){e.preventDefault();pauseSimulation();if(canPaint())enqueueStroke([id],S.brush);}});
  }
  installPainting();
  const cleanupPainting=S.cleanup,cleanupTooltips=installCellTooltips(map);
  S.cleanup=()=>{cleanupTooltips();cleanupPainting?.();};
  document.querySelectorAll('[data-brush]').forEach(btn=>btn.onclick=()=>chooseBrush(S.brush===btn.dataset.brush?'inspect':btn.dataset.brush));
  document.querySelectorAll('[data-layer]').forEach(button=>button.onclick=()=>{S.layer=button.dataset.layer;if(S.layer!=='cover')chooseBrush('inspect');else updateView();});
  $('reset-baseline').onclick=async()=>{
    const id=S.scene.id;S.resetting=true;updateClock();
    try{
      await S.playback.pauseAndWait();
      if(location.hash.split('?')[0]!==`#scene/${id}`)return;
      chooseBrush('inspect');
      await mutate(()=>post(`/scenes/${id}/reset`,{revision:S.scene.revision}));
    }finally{if(S.scene?.id===id){S.resetting=false;updateClock();}}
  };
  S.playback=createPlayback({
    onChange:playing=>{S.playing=playing;updateClock();},
    canStep:()=>!S.busy,
    step:async()=>{
      const id=S.scene.id,year=S.result.year+1;
      await mutate(()=>api(`/scenes/${id}`,{method:'PATCH',body:JSON.stringify({revision:S.scene.revision,selected_year:year})}));
      if(S.scene?.id===id&&S.result?.year!==year)pauseSimulation();
    }
  });
  const cleanupDesign=S.cleanup,playback=S.playback;
  S.cleanup=()=>{playback.dispose();if(S.playback===playback)S.playback=null;cleanupDesign?.();};
  playback.bindSpeed($('simulation-speed'));
  $('play-simulation').onclick=()=>{chooseBrush('inspect');playback.toggle();};
  $('simulation-year').onchange=()=>jumpToYear(Number($('simulation-year').value));
  $('evidence').onclick=showEvidence;
  updateView();
}
async function jumpToYear(year){
  if(S.busy||S.stroke){$('simulation-year').value=S.result.year;return;}
  if(!Number.isInteger(year)||year<S.scene.baseline.year){
    $('simulation-year').value=S.result.year;toast('Choose a whole year at or after the baseline.');return;
  }
  pauseSimulation();
  await mutate(()=>api(`/scenes/${S.scene.id}`,{method:'PATCH',body:JSON.stringify({revision:S.scene.revision,selected_year:year})}));
  if($('simulation-year'))$('simulation-year').value=S.result.year;
}
async function mutate(operation){
  if(S.busy)return;S.busy=true;
  const id=S.scene.id;
  setBusy(true);
  try{await operation();const scene=await api(`/scenes/${id}`);const result=await api(`/scenes/${id}/evaluate?year=${scene.selected_year}`);if(location.hash.split('?')[0]!==`#scene/${id}`)return;S.scene=scene;S.result=result;const params=new URLSearchParams(location.hash.split('?')[1]||'');if(params.has('year')){params.set('year',scene.selected_year);history.replaceState(null,'',`#scene/${id}?${params}`);}updateView();$('save-status').textContent='All changes saved';}
  catch(err){fail(err);if($('save-status'))$('save-status').textContent='Change not saved · reload if the scene changed elsewhere';}
  finally{S.busy=false;if(location.hash.split('?')[0]===`#scene/${id}`)setBusy(false);}
}
function setBusy(value){
  if(value)$('save-status').textContent='Saving…';
  updateClock();
}
function chooseBrush(brush){
  if(brush!=='inspect')pauseSimulation();
  S.brush=brush;if(brush!=='inspect')S.layer='cover';
  document.querySelectorAll('[data-brush]').forEach(x=>x.setAttribute('aria-pressed',String(x.dataset.brush===brush)));
  $('map')?.classList.toggle('painting',brush!=='inspect');
  if(S.map){if(brush==='inspect')S.map.dragging.enable();else S.map.dragging.disable();}
  if($('play-simulation'))updateView();
}
function updateClock(){
  if(!$('play-simulation'))return;
  renderPlaybackButton($('play-simulation'),{playing:S.playing,busy:S.busy,label:'simulation'});
  $('simulation-year').disabled=S.busy||S.playing;
  $('reset-baseline').disabled=!!S.resetting||(S.busy&&!S.playing&&!S.playback?.pending);
  $('clock-state').textContent=S.playing?'Running':'Paused';
  if(S.result&&$('simulation-year'))$('simulation-year').value=S.result.year;
  document.querySelector('.simulation-dock')?.classList.toggle('running',S.playing);
}
function pauseSimulation(){if(S.playback)S.playback.pause();else{S.playing=false;updateClock();}}

function blend(hex1,hex2,t){t=Math.max(0,Math.min(1,t));const a=hex1.match(/\w\w/g).map(x=>parseInt(x,16)),b=hex2.match(/\w\w/g).map(x=>parseInt(x,16));return '#'+a.map((v,i)=>Math.round(v+(b[i]-v)*t).toString(16).padStart(2,'0')).join('');}
function spatialFieldInfo(){
  const spec=numericLayers[S.layer]||({ndvi:{label:'NDVI',unit:'',digits:3,min:-1,max:1},soc:{label:'Soil carbon',unit:' t C/ha',digits:1,min:0,max:120}}[S.layer]);
  return {...spec,variationMax:(spec.max-spec.min)/2,variationUnit:S.layer==='change'?' percentage points':spec.unit};
}
function spatialField(id){return S.comparison?.fieldCells?.get(id)?.[S.layer];}
function isSpatialView(){return S.comparison&&isNumericMap(S.layer)&&S.comparison.fieldMode!=='design';}
function spatialColor(id){
  const stat=spatialField(id),value=stat?.[S.comparison.fieldMode];
  if(!Number.isFinite(value))return colors.unknown;
  if(S.comparison.fieldMode==='stddev')return blend('f7f8f3','80608d',value/spatialFieldInfo().variationMax);
  if(S.layer==='ndvi')return blend('ece6c7','336d48',(value+.1)/.9);
  if(S.layer==='soc')return blend('eee4cc','6a7552',value/120);
  return numericValueColor(value,S.layer);
}
function spatialDetail(id){
  const field=spatialField(id),spec=spatialFieldInfo(),count=S.comparison.result.spatial_fields.design_count;
  return `<strong>${spec.label} · ${S.comparison.year}</strong><br>Mean ${fmt(field?.mean,spec.digits)}${spec.unit}<br>Std dev ${fmt(field?.stddev,spec.digits)}${spec.variationUnit}<br><span class="muted">${field?.n??0} / ${count} designs with values</span>`;
}
function cellStyle(id){
  const base=S.baseIndex.get(id),state=S.resultIndex.get(id);
  let fill=colors[S.pending.get(id)||state.cover]||colors.unknown;
  if(S.layer==='ndvi'){const value=state.ndvi;fill=value==null?colors.unknown:blend('ece6c7','336d48',(value+.1)/.9);}
  if(S.layer==='soc')fill=state.soc==null?colors.unknown:blend('eee4cc','6a7552',state.soc/120);
  if(S.layer==='degradation')fill=statusColors[state.degradation?.status]||statusColors.unknown;
  if(numericLayers[S.layer])fill=numericColor(state,S.layer);
  if(isSpatialView())fill=spatialColor(id);
  return {fillColor:fill,fillOpacity:.9,color:'#f8f9f2',weight:.4,opacity:.3};
}
function ensureCellTooltip(id,layer){
  if(!layer.getTooltip())layer.bindTooltip(()=>cellDetail(id),{sticky:true,className:'cell-tooltip',opacity:1});
}
function cellDetail(id){
  if(isSpatialView()&&S.baseIndex.has(id))return spatialDetail(id);
  if(!S.scene||!S.result||!S.baseIndex.has(id)||!S.resultIndex.has(id))return '';
  const base=S.baseIndex.get(id),state=S.resultIndex.get(id),year=S.result.year;
  const header=`<strong>${esc(names[S.pending.get(id)||state.cover]||'Unknown')}</strong> · ${fmt(base.area_ha,2)} ha`;
  const coverage=kind=>base.coverage[kind]<1?`<br><span class="muted">${fmt(base.coverage[kind]*100,0)}% ${kind==='soc'?'soil':'NDVI'} coverage</span>`:'';
  if(S.layer==='ndvi')return `${header}<br>NDVI ${fmt(state.ndvi,3)} · scenario ${year}<br><span class="muted">Observed ${fmt(base.ndvi,3)} · ${S.scene.baseline.year}</span>${coverage('ndvi')}`;
  if(S.layer==='soc')return `${header}<br>Soil carbon ${state.soc==null?'unknown':`${fmt(state.soc)} t C/ha`} · ${year}${state.delta_pct==null?'':`<br>${signed(state.delta_pct)}% from baseline`}${coverage('soc')}`;
  if(numericLayers[S.layer]){
    const spec=numericLayers[S.layer],value=numericValue(state,S.layer);
    return `${header}<br><strong>${spec.label}: ${fmt(value,spec.digits)}${spec.unit}</strong> · ${year}${coverage('ndvi')}`;
  }
  if(S.layer==='degradation'){
    const d=state.degradation,p=d.productivity;
    const fractions=Object.entries(d.fractions).filter(([,v])=>v>1e-9).map(([status,v])=>`${fmt(v*100,1)}% ${status}`).join(' · ');
    const drivers=[d.land_cover.declining>0?'land-cover transition':null,d.soil_carbon==='declining'?'soil carbon':null,p.status==='declining'?'productivity':null].filter(Boolean);
    const reason=drivers.length?`Decline from ${drivers.join(' + ')}`:d.status==='unknown'?'Incomplete source coverage or productivity inputs.':p.status_basis==='assumed_stable'?'Productivity assumed stable.':'';
    return `${header}<br><strong>${esc(d.status[0].toUpperCase()+d.status.slice(1))}</strong> · scenario ${year}<br>${fractions}${reason?`<br><span class="muted">${esc(reason)}</span>`:''}`;
  }
  const fractions=S.pending.has(id)?{[S.pending.get(id)]:1}:state.fractions||{[state.cover]:1};
  const mixture=Object.entries(fractions).filter(([,value])=>value>0).map(([cover,value])=>`${esc(names[cover]||cover)} ${fmt(value*100,0)}%`).join(' · ');
  return `${header}<br><span class="muted">${year}${Object.keys(fractions).length>1?` · ${mixture}`:''}</span>`;
}
function refreshCellStyle(id,layer){
  const style=cellStyle(id);
  if(layer.options.fillColor!==style.fillColor)layer.setStyle(style);
}
function updateView(){
  const b=S.scene.baseline,m=S.result.metrics,ndviView=S.layer==='ndvi';
  S.resultIndex=new Map(S.result.cells.map(c=>[c.id,c]));
  $('scene-title').textContent=S.scene.name;$('year-label').textContent=S.result.year;
  document.querySelectorAll('[data-layer]').forEach(x=>{x.classList.toggle('active',x.dataset.layer===S.layer);x.setAttribute('aria-pressed',String(x.dataset.layer===S.layer));});
  if(!S.comparison)updateSimulationMetrics();
  if(S.layer==='cover')$('legend').innerHTML=`<strong>Land cover</strong><div class="legend-items">${Object.entries(names).filter(([k])=>k!=='unknown').map(([k,n])=>`<span><i class="swatch" style="background:${colors[k]}"></i>${n}</span>`).join('')}</div>`;
  else if(S.layer==='degradation')$('legend').innerHTML=`<strong>Simulated land degradation</strong><div class="legend-items">${Object.entries(statusColors).map(([key,color])=>`<span><i class="swatch" style="background:${color}"></i>${key[0].toUpperCase()+key.slice(1)}</span>`).join('')}</div>`;
  else if(numericLayers[S.layer])$('legend').innerHTML=numericLegend(S.layer);
  else $('legend').innerHTML=`<strong>${ndviView?'NDVI':'Soil carbon · tonnes C / ha'}</strong><div class="legend-gradient" style="background:linear-gradient(90deg,${ndviView?'#ece6c7,#336d48':'#eee4cc,#6a7552'})"></div><div class="legend-range"><span>${ndviView?'≤ −0.1':'0'}</span><span>${ndviView?'≥ 0.8':'120+'}</span></div><div style="margin-top:7px"><i class="swatch" style="background:${colors.unknown}"></i>No data</div>`;
  if(isSpatialView()){
    const spec=spatialFieldInfo(),variation=S.comparison.fieldMode==='stddev';
    if(variation)$('legend').innerHTML=`<strong>${spec.label}</strong><div class="legend-gradient" style="background:linear-gradient(90deg,#f7f8f3,#80608d)"></div><div class="legend-range"><span>0</span><span>≥ ${fmt(spec.variationMax,spec.digits)}${spec.variationUnit}</span></div><div class="legend-missing"><i class="swatch" style="background:${colors.unknown}"></i>Fewer than two values</div>`;
    else $('legend').querySelector('strong').prepend('Spatial mean · ');
  }
  for(const [id,layer] of S.cells){
    refreshCellStyle(id,layer);
    if(layer.getTooltip()?.isOpen())layer.setTooltipContent(()=>cellDetail(id));
  }


  updateClock();
}
function layerIcon(kind){
  const paths={trajectory:'<path d="M3 19h18M4 16 20 5M5 10l3 2m5-6 3 2"/>',state:'<path d="M4 18h4v-5H4zm6 0h4V9h-4zm6 0h4V4h-4z"/>',performance:'<path d="M4 19a9 9 0 1 1 16 0M12 13l5-5M5 13h2m10 0h2M12 4v2"/>',degradation:'<path d="M12 3 3 7v6c0 4 9 8 9 8s9-4 9-8V7l-9-4Z"/><path d="m7 12 3 3 7-7"/>',cover:'<path d="m12 3 9 5-9 5-9-5 9-5Zm-9 9 9 5 9-5M3 16l9 5 9-5"/>',ndvi:'<path d="M3 18h18M4 14l4-4 4 3 7-9m-5 0h5v5"/>',soc:'<path d="M3 7h18M3 12h18M3 17h18M7 7v5m10 0v5"/>',change:'<path d="M3 12h4l3-7 4 14 3-7h4"/>'};
  return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths[kind]}</svg>`;
}
function updateSimulationMetrics(){
  if(!$('simulation-metrics'))return;
  const scene=S.scene,m=S.result.metrics,ndviView=S.layer==='ndvi';
  const key=JSON.stringify([scene.id,scene.climate,scene.model_version,scene.ndvi_model_version,scene.actions]);
  if(S.timelineKey!==key){
    S.timelineController?.abort();
    S.timelineKey=key;S.timeline=[];S.timelineError=false;S.timelineLoading=false;S.timelineRanges=[];S.timelineSampled=false;S.timelineEnd=Math.max(scene.selected_year,S.result.year,...scene.actions.map(a=>a.year));
  }
  // Reuse the year already evaluated for the map instead of projecting 40 future years.
  const known=new Map(S.timeline.map(point=>[point.year,point]));
  known.set(S.result.year,{year:S.result.year,metrics:m});
  S.timeline=[...known.values()].sort((a,b)=>a.year-b.year);
  S.timelineEnd=Math.max(S.timelineEnd,S.result.year);
  const missing=[];
  for(let year=scene.baseline.year;year<=S.timelineEnd;year++)if(!known.has(year)&&!S.timelineRanges.some(([start,end])=>start<=year&&year<=end))missing.push(year);
  if(missing.length&&!S.timelineLoading&&!S.timelineError){
    const controller=new AbortController();S.timelineController=controller;S.timelineLoading=true;
    api(`/scenes/${scene.id}/timeline?start_year=${missing[0]}&end_year=${missing.at(-1)}&max_points=32`,{signal:controller.signal}).then(data=>{
      if(S.timelineKey!==key||S.scene?.id!==scene.id||controller.signal.aborted)return;
      const merged=new Map(data.points.map(point=>[point.year,point]));
      for(const point of S.timeline)merged.set(point.year,point);
      S.timeline=[...merged.values()].sort((a,b)=>a.year-b.year);
      S.timelineRanges.push([data.start_year,data.end_year]);S.timelineSampled||=data.sampled;
      S.timelineLoading=false;updateSimulationMetrics();
    }).catch(error=>{
      if(error.name==='AbortError')return;
      if(S.timelineKey===key){S.timelineLoading=false;S.timelineError=true;if(S.scene?.id===scene.id)updateSimulationMetrics();}
    });
  }
  const numeric=numericLayers[S.layer];
  const field=numeric?.metric||(ndviView?'simulated_ndvi':S.layer==='soc'?'carbon_tonnes':S.layer==='degradation'?'degrading_ha':'carbon_change_tonnes');
  const label=numeric?`${S.layer==='change'?'':'Mean '}${numeric.label.toLowerCase()}`:ndviView?'Scenario NDVI':S.layer==='soc'?'Modeled soil carbon':S.layer==='degradation'?'Simulated declining area':'Modeled carbon change';
  const digits=numeric?.digits??(ndviView?3:1),unit=numeric?.unit??(ndviView?'':S.layer==='degradation'?' ha':' t C');
  const points=S.timeline;
  const panel=$('simulation-metrics');
  if(missing.length&&points.length===1){
    panel.innerHTML=`<div class="metric-graph-placeholder" aria-busy="${!S.timelineError}">${S.timelineError?errorState('History could not load.','retry-history',{compact:true}):loadingState('Loading history…',{compact:true})}</div>`;
  }else{
    renderComparisonChart(panel,{
      points:points.map(point=>({year:point.year,scenes:[{id:scene.id,name:scene.name,metrics:point.metrics}]})),
      singleDesign:true,key:field,label,unit,digits,selectedId:scene.id,year:S.result.year,format:fmt,escape:esc,
      onYear:async(year,focus)=>{const token=routeToken;await jumpToYear(year);if(focus&&token===routeToken)$('simulation-metrics')?.querySelector('.comparison-timeline')?.focus();}
    });
    if(S.layer==='degradation')panel.insertAdjacentHTML('beforeend',`<div class="tiny muted">${fmt(m.degradation_ha.unknown)} ha unassessed</div>`);
    if(S.timelineError)panel.insertAdjacentHTML('beforeend',errorState('History could not update.','retry-history',{compact:true}));
  }
  if($('retry-history'))$('retry-history').onclick=()=>{S.timelineError=false;updateSimulationMetrics();};
}

function brushIcon(kind){
  const paths={inspect:'<circle cx="10" cy="10" r="5"/><path d="m14 14 6 6"/>',trees:'<path d="m12 3-7 10h4l-5 5h16l-5-5h4zM12 18v4"/>',grass:'<path d="M12 21V7m0 10-7-7m7 6 7-8M7 21 3 14m14 7 4-7"/>',crops:'<path d="M12 22V3m0 8C5 11 5 7 5 7s7 0 7 4Zm0 6c-7 0-7-4-7-4s7 0 7 4Zm0-9c7 0 7-4 7-4s-7 0-7 4Zm0 6c7 0 7-4 7-4s-7 0-7 4Z"/>',wetland:'<path d="M3 20q3-3 6 0t6 0 6 0M9 17V5m6 12V3M7 5h4v5H7zm6-2h4v5h-4z"/>',built:'<path d="M4 21V8l7-5v18m0-11h9v11M2 21h20M7 9v2m0 3v2m8-2h2m-2 3h2"/>',bare:'<path d="m3 17 5-6 4 4 4-8 5 10M3 21h18"/>',water:'<path d="M12 3s-6 7-6 11a6 6 0 0 0 12 0c0-4-6-11-6-11Z"/>'};
  return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths[kind]}</svg>`;
}
function canPaint(){
  if(S.brush==='inspect'||(S.busy&&!paintTask))return false;
  return true;
}
function editable(id){const c=S.baseIndex.get(id);return !!c&&Object.keys(c.fractions).length>0;}
function refreshPaint(){
  for(const [id,layer] of S.cells)refreshCellStyle(id,layer);

}
function enqueueStroke(ids,cover){
  ids=ids.filter(editable);
  if(!ids.length){toast('No land-cover observations in this cell.');return;}
  const stroke={cell_ids:[...new Set(ids)],cover,year:S.result.year,note:''};
  S.paintQueue.push(stroke);
  for(const id of stroke.cell_ids)S.pending.set(id,cover);
  refreshPaint();
  if(!paintTask)paintTask=saveStrokes().finally(()=>{paintTask=null;});
}
async function saveStrokes(){
  S.busy=true;setBusy(true);
  let id=S.scene.id;
  try{
    while(S.paintQueue.length){
      const stroke=S.paintQueue[0];
      const past=S.scene.actions.some(action=>action.year>stroke.year);
      const saved=await post(`/scenes/${id}/${past?'branch':'actions'}`,{...stroke,revision:S.scene.revision});
      if(saved.branched_from){
        const oldId=id;id=saved.id;
        if(location.hash.split('?')[0]===`#scene/${oldId}`){
          history.replaceState(null,'',`#scene/${id}?year=${stroke.year}&layer=${S.layer}`);
          toast(`Created a branch at ${stroke.year}. The original future is saved.`);
        }
      }
      S.scene=await api(`/scenes/${id}`);
      S.result=await api(`/scenes/${id}/evaluate?year=${S.scene.selected_year}`);
      S.paintQueue.shift();
      // Pending strokes retain their immediate colors while earlier saves finish.
      S.pending.clear();
      for(const next of S.paintQueue)for(const cell of next.cell_ids)S.pending.set(cell,next.cover);
      if(S.stroke)for(const cell of S.stroke.ids)S.pending.set(cell,S.stroke.cover);
      updateView();setBusy(true);
    }
    $('save-status').textContent='All changes saved';
  }catch(err){
    S.paintQueue=[];S.stroke=null;S.pending.clear();
    try{S.scene=await api(`/scenes/${id}`);S.result=await api(`/scenes/${id}/evaluate?year=${S.scene.selected_year}`);updateView();$('save-status').textContent='Showing saved state';}catch{refreshPaint();$('save-status').textContent='Could not confirm save · reload before editing';}
    toast(`Stroke could not be confirmed. Unsaved paint was cleared. ${err.message}`);
  }finally{S.busy=false;setBusy(false);}
}
function installCellTooltips(map){
  let active=null,moving=false;
  const container=map.getContainer();
  function dismiss(){const previous=active;active=null;previous?.close();}
  function opened(event){
    // Leaflet may replay several queued hover events at the end of a drag.
    if(moving||S.stroke){event.tooltip.close();return;}
    if(active===event.tooltip)return;
    const previous=active;active=event.tooltip;previous?.close();
  }
  function closed(event){if(active===event.tooltip)active=null;}
  function startMove(){moving=true;dismiss();}
  function endMove(){queueMicrotask(()=>{moving=false;});}
  map.on('tooltipopen',opened).on('tooltipclose',closed);
  map.on('movestart zoomstart',startMove).on('moveend zoomend',endMove);
  container.addEventListener('pointerleave',dismiss);
  container.addEventListener('pointerdown',dismiss);
  return ()=>{
    dismiss();
    map.off('tooltipopen',opened).off('tooltipclose',closed);
    map.off('movestart zoomstart',startMove).off('moveend zoomend',endMove);
    container.removeEventListener('pointerleave',dismiss);
    container.removeEventListener('pointerdown',dismiss);
  };
}

function installPainting(){
  const map=$('map');S.stroke=null;
  function hit(e){return document.elementFromPoint(e.clientX,e.clientY)?.closest('[data-cell]')?.dataset.cell;}
  function add(id){if(!id||!editable(id)||S.stroke.ids.has(id))return;S.stroke.ids.add(id);S.pending.set(id,S.stroke.cover);S.cells.get(id).setStyle(cellStyle(id));}
  function down(e){
    if(e.button!==0)return;
    const id=hit(e);if(!id)return;
    if(S.brush==='inspect')return;
    pauseSimulation();
    if(!canPaint())return;
    e.preventDefault();map.setPointerCapture(e.pointerId);
    S.stroke={ids:new Set(),cover:S.brush,pointer:e.pointerId,x:e.clientX,y:e.clientY};add(id);
  }
  function move(e){
    if(!S.stroke||e.pointerId!==S.stroke.pointer)return;
    const dx=e.clientX-S.stroke.x,dy=e.clientY-S.stroke.y,steps=Math.min(1000,Math.max(1,Math.ceil(Math.hypot(dx,dy)/4)));
    for(let i=1;i<=steps;i++)add(hit({clientX:S.stroke.x+dx*i/steps,clientY:S.stroke.y+dy*i/steps}));
    S.stroke.x=e.clientX;S.stroke.y=e.clientY;
  }
  function up(e){
    if(!S.stroke||e.pointerId!==S.stroke.pointer)return;
    const current=S.stroke;S.stroke=null;
    if(map.hasPointerCapture(e.pointerId))map.releasePointerCapture(e.pointerId);
    if(current.ids.size)enqueueStroke([...current.ids],current.cover);
  }
  map.addEventListener('pointerdown',down);map.addEventListener('pointermove',move);map.addEventListener('pointerup',up);map.addEventListener('pointercancel',up);map.addEventListener('lostpointercapture',up);
  function undoKey(e){
    if(!(e.metaKey||e.ctrlKey)||e.shiftKey||e.key.toLowerCase()!=='z'||e.target.closest('input,textarea,select,[contenteditable]'))return;
    if(S.busy||S.stroke||(!S.scene.actions.length&&!S.scene.reset_backup))return;
    e.preventDefault();pauseSimulation();mutate(()=>post(`/scenes/${S.scene.id}/undo`,{revision:S.scene.revision}));
  }
  document.addEventListener('keydown',undoKey);
  S.cleanup=()=>{document.removeEventListener('keydown',undoKey);map.removeEventListener('pointerdown',down);map.removeEventListener('pointermove',move);map.removeEventListener('pointerup',up);map.removeEventListener('pointercancel',up);map.removeEventListener('lostpointercapture',up);};
}

function showEvidence(){
  const b=S.scene.baseline,r=S.result;
  const equation=(label,formula,note='')=>`<div class="model-equation"><strong>${label}</strong><div class="formula">${katex.renderToString(formula,{displayMode:true,output:'htmlAndMathml',trust:false,strict:'error'})}</div>${note?`<small>${note}</small>`:''}</div>`;
  dialog('Sources & model assumptions',`
    <p class="tiny muted">Observed starting conditions + modeled scenarios. Missing inputs remain unknown.</p>
    <details class="model-section"><summary>Data sources</summary>${b.sources.map(s=>`<div class="source-record"><strong>${esc(s.name)}</strong><p>${esc(s.kind)} · ${s.year||'mixed observation years'} · ${s.resolution_m} m</p><a href="${esc(s.url)}" target="_blank" rel="noreferrer">Source ↗</a> · ${esc(s.license)}</div>`).join('')}</details>
    <h3>Soil carbon</h3>
    ${equation('20-year target',String.raw`C^{\ast}=C_e\sum_k f_k\,F\!\left(k\to\text{new cover},\,\text{climate}\right)`,'Cₑ: stock attained at the edit; fₖ: previous cover fractions; F: conversion coefficient.')}
    ${equation('Annual stock',String.raw`C(t)=C_e+\left(C^{\ast}-C_e\right)\operatorname{clamp}\!\left(\frac{t-t_e}{20},\,0,\,1\right)`,'Top 30 cm, t C/ha. A new transition starts from attained stock. Equal carbon density across mixed cover fractions is assumed.')}
    ${equation('Carbon status',String.raw`\begin{aligned}\Delta C&=100\left(\frac{C(t)}{C_0}-1\right)\\[6pt]\text{Status}&=\begin{cases}\text{declining}&\Delta C\le -10\%\\\text{improving}&\Delta C\ge +10\%\\\text{stable}&\text{otherwise}\end{cases}\end{aligned}`,'Missing or nonpositive C₀: unknown.')}
    <p class="tiny muted">${esc(r.model_version)} · ${esc(climates[r.climate])}</p><a href="${esc(r.method_reference)}" target="_blank" rel="noreferrer">Coefficient method ↗</a>
    <h3>Vegetation · NDVI</h3>
    ${equation('Target',String.raw`N^{\ast}=\operatorname{clamp}\!\left(N_0+\sum_k\beta_k\left(f_{k,\mathrm{new}}-f_{k,\mathrm{baseline}}\right),\,-1,\,1\right)`)}
    ${equation('Annual response',String.raw`N(t)=N_e+\left(N^{\ast}-N_e\right)\operatorname{clamp}\!\left(\frac{t-t_e}{\tau},\,0,\,1\right)`,'N₀: observed baseline; Nₑ: attained NDVI; τ: years to target. τ = 0 means immediate.')}
    <div class="model-table-wrap"><table class="model-table"><caption class="sr-only">NDVI response parameters by land cover</caption><thead><tr><th scope="col">Cover</th><th scope="col">β</th><th scope="col">Years to target</th></tr></thead><tbody>${Object.entries(r.ndvi_model.category_parameters).map(([k,v])=>`<tr><th scope="row">${esc(names[k])}</th><td>${fmt(v.beta,2)}</td><td>${v.response_years||'Immediate'}</td></tr>`).join('')}</tbody></table></div>
    <p class="tiny muted">Response times are prototype assumptions. Forest, grassland and artificial-area β values use an SF fit; others are placeholders. Not validated across regions; no weather, seasonality or irrigation.</p>
    <h3>Productivity</h3>
    ${equation('Trend · ≥10 annual samples',String.raw`\begin{aligned}b&=\frac{\sum_t(t-\bar t)(N_t-\bar N)}{\sum_t(t-\bar t)^2}\\[6pt]S&=\sum_{i<j}\operatorname{sgn}(N_j-N_i)\\[6pt]T&=\begin{cases}\operatorname{sgn}(b)&|S|\ge K_{95}(n)\\\text{stable}&\text{otherwise}\end{cases}\end{aligned}`,'K₉₅: pinned Mann–Kendall table through 60 samples; above 60, 1 + 1.96√[n(n−1)(2n+5)/18]. Significance concerns the synthetic series, not forecast confidence.')}
    ${equation('State · ≥13 annual samples',String.raw`\begin{aligned}\Delta R&=R(\bar N_{\text{latest 3}})-R(\bar N_{\text{first 10}})\\[6pt]|\Delta N|&\le 0.01\;\Longrightarrow\;\Delta R=0\\[6pt]\text{State}&=\begin{cases}\text{declining}&\Delta R\le -2\\\text{improving}&\Delta R\ge 2\\\text{stable}&\text{otherwise}\end{cases}\end{aligned}`,'R counts exceeded decile cutoffs from the first 10 values, extended by min−5% of range and max+5% of range. Otherwise stable; recent and reference windows do not overlap.')}
    ${equation('Performance',String.raw`\begin{aligned}Q&=\frac{\bar N}{P_{90}\!\left(\bar N\text{ in group}\right)}\\[6pt]\text{Performance}&=\begin{cases}\text{declining}&Q\le 0.5\\\text{stable}&\text{otherwise}\end{cases}\end{aligned}`,'Groups use original dominant cover within the scene, without soil type. Missing NDVI, water history or a nonpositive benchmark remain unknown.')}
    ${equation('Combined productivity P',String.raw`P=\begin{cases}\text{assumed stable}&n<13\text{ with valid inputs}\\\text{unknown}&\text{otherwise, any component unknown}\\\text{declining}&T{\downarrow}\;\lor\;[\text{State}{\downarrow}\land(T\text{ stable}\lor Q{\downarrow})]\\\text{improving}&\text{otherwise, }T{\uparrow}\\\text{stable}&\text{otherwise}\end{cases}`,'Initial stability is a scenario assumption, not historical evidence. From 13 samples, use the calculated result. T: trend; Q↓: declining performance. Early simulated edits affect the reference period.')}
    <a href="${esc(r.degradation_model.productivity.reference)}" target="_blank" rel="noreferrer">Productivity method ↗</a>
    <h3>Land degradation</h3>
    ${equation('Land-cover transition',String.raw`L=\operatorname{matrix}\!\left(\text{baseline cover}\to\text{current cover}\right)`,'Mixed baseline cover retains its area fractions.')}
    <details id="land-cover-matrix" class="model-section"><summary>Land-cover matrix</summary><div id="matrix-content"></div></details>
    ${equation('One out, all out · D(L, P, C)',String.raw`D(L,P,C)=\begin{cases}\text{declining}&\text{any declining}\\\text{unknown}&\text{otherwise, any unknown}\\\text{improving}&\text{otherwise, any improving}\\\text{stable}&\text{otherwise}\end{cases}`,'C: carbon category; P: productivity category. Scenario adaptation, not an official UNCCD assessment.')}
    <details class="model-section"><summary>Area aggregation & map colors</summary>
    ${equation('Conservative declining fraction',String.raw`d=\max\!\left(l_{\downarrow}q_L,\;\mathbf{1}[P{\downarrow}]q_P,\;\mathbf{1}[C{\downarrow}]q_C\right)`,'l↓: declining land-cover fraction; qL, qP, qC: valid source coverage, from 0 to 1.')}
    ${equation('Known stable / improving overlap',String.raw`a_k=\max\!\left(0,\;l_kq_L+q_P+q_C-2\right)`,'Only when P and C are known and non-declining; assign each overlap to D(k,P,C). Remaining area is unknown.')}
    ${equation('Area totals',String.raw`A(s)=\sum_{\text{cells }i}A_i\,f_i(s)`,'Aᵢ: cell area; fᵢ(s): fraction assigned to status s. Any declining portion colors the cell purple; otherwise any unknown portion makes it gray, then improving green, else stable cream.')}
    </details>
    <details class="model-section"><summary>Spatial aggregation & chart scales</summary>
    ${equation('Raster aggregation',String.raw`\bar x=\frac{\sum_i w_i x_i}{\sum_i w_i}`,'Land cover: native-pixel center fractions. NDVI: mean of valid annual medians. Soil: overlap-area weights for 250 m estimates. Cells clip to the region boundary.')}
    ${equation('Soil-carbon total',String.raw`C_{\mathrm{total}}=\sum_{\text{cells }i}C_i\,A_i\,q_{C,i}`,'Cᵢ: carbon density; Aᵢ: cell area; qC,i: soil coverage. Only soil-covered area contributes; missing values are not zero.')}
    <p class="tiny muted">Map scales are fixed; chart axes fit the history. Comparison mean and population standard deviation describe designs, not forecast uncertainty. Reference excluded. Hover for values; click a year to navigate.</p>
    <p class="tiny muted">${esc(b.boundary_source)} · retrieved ${esc(b.retrieved_at.slice(0,10))}</p></details>
  `);
  let matrixLoaded=false;
  const loadMatrix=async()=>{
    $('matrix-content').innerHTML=loadingState('Loading matrix…',{compact:true});
    try{
      const data=await api('/model/land-cover-matrix');if(!$('matrix-content'))return;
      const covers=data.legend.key,transitions=data.definitions.transitions;
      const meaning={degradation:'declining',stable:'stable',improvement:'improving'};
      $('matrix-content').innerHTML=`<p class="tiny muted">Rows: baseline cover. Columns: current cover.</p><div class="model-table-wrap"><table class="model-table transition-table"><thead><tr><th scope="col">From ↓ / To →</th>${covers.map(c=>`<th scope="col">${esc(c.name_long)}</th>`).join('')}</tr></thead><tbody>${covers.map(before=>`<tr><th scope="row">${esc(before.name_long)}</th>${covers.map(after=>{const status=meaning[transitions.find(t=>t.initial.code===before.code&&t.final.code===after.code)?.meaning]||'unknown';return `<td style="background:${statusColors[status]};color:${['declining','improving'].includes(status)?'white':'#243d34'}">${status}</td>`;}).join('')}</tr>`).join('')}</tbody></table></div><a href="${esc(r.degradation_model.land_cover_reference)}" target="_blank" rel="noreferrer">Pinned Trends.Earth source ↗</a>`;
      matrixLoaded=true;
    }catch(error){if($('matrix-content')){$('matrix-content').innerHTML=errorState('Matrix could not load.','retry-matrix',{compact:true});$('retry-matrix').onclick=loadMatrix;}}
  };
  $('land-cover-matrix').ontoggle=()=>{if($('land-cover-matrix')?.open&&!matrixLoaded)loadMatrix();};
}

function focusExtent(b,edited){
  edited=new Set(b.cells.filter(c=>edited.has(c.id)).map(c=>c.id));
  if(!edited.size)return {cells:b.cells,bounds:b.bounds,focused:false,ids:[]};
  const centers=b.cells.filter(c=>edited.has(c.id)).map(c=>c.center);
  const dy=(b.cell_m||165)*2/111320,dx=dy/Math.cos(centers[0][1]*Math.PI/180);
  const bounds=[Math.min(...centers.map(c=>c[0]))-dx,Math.min(...centers.map(c=>c[1]))-dy,Math.max(...centers.map(c=>c[0]))+dx,Math.max(...centers.map(c=>c[1]))+dy];
  return {cells:b.cells.filter(c=>c.center[0]>=bounds[0]&&c.center[0]<=bounds[2]&&c.center[1]>=bounds[1]&&c.center[1]<=bounds[3]),bounds,focused:true,ids:[...edited]};
}
async function comparison(ids,token,params=new URLSearchParams()){
  const first=await routeApi(`/scenes/${ids[0]}`);if(token!==routeToken)return;
  let year=Number(params.get('year'))||first.selected_year,index=0,result,generation=0,playing=false,loading=false,playback;
  let history=[],historyKey='',historyEnd=0,historyLoading=false,historyError=false,historySequence=0;
  let layer=canonicalLayer(params.get('layer')||S.layer),fieldMode=params.get('field')||'design';
  if(!['design','mean','stddev'].includes(fieldMode))fieldMode='design';
  if(!isNumericMap(layer))fieldMode='design';
  if(!mapLayers.some(([key])=>key===layer))layer='cover';
  function updateComparisonClock(){
    const button=$('compare-play');if(!button)return;
    document.querySelector('.comparison-clock').classList.toggle('running',playing);
    renderPlaybackButton(button,{playing,busy:loading,label:'comparison'});
    $('compare-year').disabled=loading||playing;
  }
  function comparisonBusy(busy,content=''){
    loading=busy;
    if(!$('comparison-status'))return;
    $('comparison-status').innerHTML=content;
    document.querySelector('.comparison-clock').setAttribute('aria-busy',String(busy));
    for(const id of ['compare-year','previous-design','next-design'])$(id).disabled=busy;
    updateComparisonClock();
  }
  async function load(requested=year,initial=false){
    const sequence=++generation;
    if(!initial)comparisonBusy(true);
    try{
      const next=await routeApi('/compare',{method:'POST',body:JSON.stringify({scene_ids:ids,year:requested})});
      if(token!==routeToken||sequence!==generation)return;
      result=next;year=requested;
      if(!initial){$('compare-year').value=year;comparisonBusy(false);draw();}
    }catch(error){
      if(token!==routeToken||sequence!==generation||error.name==='AbortError')return;
      if(initial)throw error;
      playback?.pause();
      $('compare-year').value=year;
      comparisonBusy(false,errorState('Comparison could not update.','retry-comparison',{compact:true}));
      $('retry-comparison').onclick=()=>load(requested);
    }
  }
  await load(year,true);
  if(token!==routeToken)return;
  const yearControl=`<input id="compare-year" aria-label="Comparison year" type="number" min="${first.baseline.year}" step="1" value="${year}">`;
  mount(`<main id="main" class="workspace paint-workspace floating-workspace design-workspace comparison-workspace"><h1 class="sr-only">One place. Different futures.</h1><section class="map-column" aria-label="Comparison map"><div class="map-area"><div id="map" class="map" aria-label="Shared map of alternative designs"></div><a class="design-back" href="#projects" aria-label="Back to projects" title="Back to projects">${regionIcon('back')}</a><div class="design-navigator"><button id="previous-design" aria-label="Previous design">←</button><div><strong id="scene-title"></strong><span id="design-position"></span></div><button id="next-design" aria-label="Next design">→</button></div><section class="comparison-summary" aria-label="Variation between designs"><div class="comparison-field-switch" role="group" aria-label="Spatial comparison view"><button data-comparison-field="design" aria-pressed="true">Design</button><button data-comparison-field="mean" aria-pressed="false">Mean</button><button data-comparison-field="stddev" aria-pressed="false">Variation</button></div><div id="design-distribution"></div><div id="legend" class="legend panel-legend"></div><details id="comparison-details"><summary>Area, coverage & differences</summary><div id="design-statistics"></div></details></section><div class="map-view-control"><div class="layer-tiles" role="group" aria-label="Map layers">${mapLayers.map(([v,n])=>`<button data-layer="${v}" aria-label="${n}" data-tooltip="${n}" aria-pressed="${layer===v}">${layerIcon(v)}</button>`).join('')}</div></div><button id="evidence" class="map-info-button" aria-label="Sources and model assumptions" title="Sources & model assumptions">${regionIcon('info')}</button><section class="comparison-clock"><div class="row"><button id="compare-play" class="clock-button" aria-label="Play comparison">▶</button><div><label class="sr-only" for="compare-year">Compare at year</label>${yearControl}</div><button id="simulation-speed" class="clock-speed" type="button">1×</button></div><span id="year-label" class="sr-only"></span><div id="comparison-status"></div></section></div></section></main>`,{navigation:false});
  const baseline=first.baseline;
  S.cells.clear();S.pending.clear();S.selection.clear();S.brush='inspect';S.layer=layer;
  S.baseIndex=new Map(baseline.cells.map(c=>[c.id,c]));
  const map=baseMap('map',latBounds(baseline.bounds));
  // Create geometry once. Design/year/layer changes only update colors and data.
  L.geoJSON({type:'FeatureCollection',features:baseline.cells.map(c=>({type:'Feature',geometry:c.geometry,properties:{id:c.id}}))},{style:{fillOpacity:.9,weight:.4},onEachFeature:(f,l)=>{
    const id=f.properties.id;S.cells.set(id,l);l.on('add',()=>{l.getElement().dataset.cell=id;});l.on('mouseover',event=>{ensureCellTooltip(id,l);l.openTooltip(event.latlng);});
    l.on('click',()=>{S.selection=new Set([id]);window.dispatchEvent(new Event('land-context'));});
  }}).addTo(map);
  const cleanup=installCellTooltips(map);
  S.cleanup=()=>{playback?.dispose();cleanup();};
  function draw(){
    if(!result||token!==routeToken)return;
    const designs=[...result.scenes,{id:null,name:'Unchanged reference',revision:null,...result.reference}],current=designs[index%designs.length];
    if(!isNumericMap(S.layer))fieldMode='design';
    S.comparison={ids,year,result,fieldMode,fieldCells:new Map((result.spatial_fields?.cells||[]).map(c=>[c.id,c.fields]))};
    S.scene={...current,baseline:result.baseline,selected_year:year,actions:[]};S.result=current;
    updateView();
    $('design-position').textContent=`${index+1} / ${designs.length} · ${current.id?'design':'reference'}`;
    document.querySelectorAll('[data-comparison-field]').forEach(button=>{button.setAttribute('aria-pressed',String(button.dataset.comparisonField===fieldMode));button.disabled=button.dataset.comparisonField!=='design'&&(!isNumericMap(S.layer)||!result.spatial_fields);});
    $('comparison-details').hidden=fieldMode!=='design';
    if(fieldMode!=='design'){$('scene-title').textContent=fieldMode==='mean'?'Spatial mean':'Spatial variation';$('design-position').textContent=`${result.scenes.length} designs · ${year}`;}

    const numeric=numericLayers[S.layer];
    const key=numeric?.metric||{ndvi:'simulated_ndvi',soc:'carbon_mean_t_ha',cover:'degrading_ha',degradation:'degrading_ha'}[S.layer];
    const label=numeric?`Mean ${numeric.label.toLowerCase()}`:{ndvi:'Mean NDVI',soc:'Mean soil carbon',cover:'Declining area',degradation:'Declining area'}[S.layer];
    const unit=numeric?.unit??{ndvi:'',soc:' t C/ha',cover:' ha',degradation:' ha'}[S.layer],digits=numeric?.digits??(S.layer==='ndvi'?6:2);
    drawHistory(current,key,label,unit,digits);
    const m=current.metrics,d=current.difference_from_unchanged;
    $('design-statistics').innerHTML=`<p class="tiny muted">${esc(current.name)} · ${year}</p><dl>${[['Declining',`${fmt(m.degrading_ha)} ha${m.degradation_assessed_ha>0?` · ${fmt(100*m.degrading_ha/m.degradation_assessed_ha)}% of assessed`:' · no assessed area'}`],['Stable',`${fmt(m.degradation_ha.stable)} ha`],['Improving',`${fmt(m.degradation_ha.improving)} ha`],['Unassessed',`${fmt(m.degradation_ha.unknown)} / ${fmt(m.area_ha)} ha`],['Soil coverage',`${fmt(m.known_carbon_ha)} / ${fmt(m.area_ha)} ha`],['NDVI coverage',`${fmt(m.simulated_ndvi_coverage_ha)} / ${fmt(m.area_ha)} ha`],['Declining vs reference',`${d?signed(d.degrading_ha):'0'} ha`],['Carbon vs reference',`${d?signed(d.carbon_tonnes):'0'} t C`],['NDVI vs reference',d?fmt(d.simulated_ndvi,4):'0']].map(([k,v])=>`<div><dt>${k}</dt><dd>${v}</dd></div>`).join('')}</dl><p class="tiny muted">Scenario model. Unknown area is not stable land. Percentages use assessed area.</p>`;
    window.dispatchEvent(new Event('land-context'));
  }
  function drawHistory(current,key,label,unit,digits){
    const revisions=Object.fromEntries(result.scenes.map(s=>[s.id,s.revision])),signature=JSON.stringify(revisions);
    if(historyKey!==signature){historyKey=signature;history=[];historyEnd=0;historyLoading=false;historyError=false;++historySequence;}
    // Playback already returned this year's metrics; extend the cached history directly.
    if(history.length&&year===historyEnd+1)historyEnd=year;
    if(!historyLoading&&!historyError&&year>historyEnd){
      historyLoading=true;const sequence=++historySequence;
      routeApi('/compare/timeline',{method:'POST',body:JSON.stringify({scene_ids:ids,revisions,end_year:year})}).then(data=>{
        if(token!==routeToken||sequence!==historySequence)return;
        // Keep exact years received during the request alongside sampled history.
        const points=new Map(data.points.map(point=>[point.year,point]));
        for(const point of history)points.set(point.year,point);
        history=[...points.values()].sort((a,b)=>a.year-b.year);historyEnd=data.end_year;
        while(points.has(historyEnd+1))historyEnd++;
        historyLoading=false;draw();
      }).catch(error=>{if(token!==routeToken||sequence!==historySequence||error.name==='AbortError')return;historyLoading=false;historyError=true;draw();});
    }
    // Keep the exact currently displayed year alongside sampled history.
    if(history.length){const points=new Map(history.map(p=>[p.year,p]));points.set(year,{year,scenes:result.scenes.map(({id,name,metrics})=>({id,name,metrics})),reference:{metrics:result.reference.metrics},distribution:result.distribution});history=[...points.values()].sort((a,b)=>a.year-b.year);}
    if(!history.length){
      $('design-distribution').innerHTML=historyError?errorState('Timeline could not load.','retry-comparison-history',{compact:true}):loadingState('Loading timeline…',{compact:true});
      if(historyError)$('retry-comparison-history').onclick=()=>{historyError=false;draw();};
      return;
    }
    renderComparisonChart($('design-distribution'),{points:history,key,label,unit,digits,selectedId:fieldMode==='design'?current.id:undefined,year,format:fmt,escape:esc,onYear:async(requested,focus)=>{
      playback?.pause();await load(requested);if(focus&&token===routeToken)document.querySelector('.comparison-timeline')?.focus();
    }});
    if(historyError){
      $('design-distribution').insertAdjacentHTML('beforeend',errorState('History could not update.','retry-comparison-history',{compact:true}));
      $('retry-comparison-history').onclick=()=>{historyError=false;draw();};
    }
  }
  function rotate(step){if(!result)return;fieldMode='design';index=(index+step+result.scenes.length+1)%(result.scenes.length+1);draw();}
  $('evidence').onclick=showEvidence;
  $('previous-design').onclick=()=>rotate(-1);$('next-design').onclick=()=>rotate(1);
  document.querySelectorAll('[data-comparison-field]').forEach(button=>button.onclick=()=>{fieldMode=button.dataset.comparisonField;draw();});
  document.querySelectorAll('[data-layer]').forEach(button=>button.onclick=()=>{S.layer=button.dataset.layer;draw();});
  $('compare-year').onchange=()=>{const requested=Number($('compare-year').value);if(!Number.isInteger(requested)||requested<baseline.year){$('compare-year').value=year;fail(new Error('Choose a whole year at or after the baseline.'));return;}playback.pause();load(requested);};
  playback=createPlayback({step:()=>load(year+1),canStep:()=>!loading,onChange:value=>{playing=value;updateComparisonClock();}});
  playback.bindSpeed($('simulation-speed'));
  $('compare-play').onclick=()=>playback.toggle();
  draw();
}
async function route(){
  pauseSimulation();
  clearTimeout(toastTimer);$('toast').classList.remove('visible');
  const token=++routeToken;
  routeController?.abort();routeController=new AbortController();
  S.timelineController?.abort();S.timelineKey=null;
  if(paintTask)await paintTask;
  if(token!==routeToken)return;
  S.comparison=null;S.selection.clear();S.scene=null;S.result=null;
  if(!S.user){renderLogin();return;}
  const [hashPath,query='']=(location.hash.slice(1)||'projects').split('?');
  const [path,part]=hashPath.split('/');
  const labels={scene:'Loading design…',compare:'Loading comparison…',new:'Loading map…'};
  routeState(path,labels[path]||'Loading projects…');
  try{
    if(path==='new')await newScene(token);
    else if(path==='scene'&&part)await openScene(part,token,new URLSearchParams(query));
    else if(path==='compare'&&part)await comparison(part.split(','),token,new URLSearchParams(query));
    else await projects(token);
  }catch(err){
    if(token!==routeToken||err.name==='AbortError')return;
    if(S.user)routeState(path,err.message,true);
  }
}

const assistantUI=createAssistantUI({api,post,escapeHtml:esc,
  context:()=>({scene_id:isSpatialView()?null:S.scene?.id??null,comparison_field:S.comparison?.fieldMode??'design',comparison_ids:S.comparison?.ids??(S.scene?[]:[...S.selected]),selected_cells:[...S.selection],year:S.result?.year??null,layer:S.layer,bounds:S.scene?.baseline?.bounds??null}),
  onView:url=>{if(/^#(scene|compare)\//.test(url))location.hash=url;},
  onMutation:async change=>{
    const id=change?.id;
    if(paintTask)await paintTask;
    if(change?.branched_from&&S.scene?.id===change.branched_from&&!S.comparison){location.hash=`#scene/${id}?layer=${S.layer}`;return;}
    if(change?.deleted&&S.scene?.id===id){location.hash='#projects';return;}
    if(S.comparison){return;} // Comparison results refresh through their year controls.
    if(id&&S.scene?.id===id)pauseSimulation();
    if(S.busy||S.stroke)return false;
    if(id&&S.scene?.id===id){
      const token=routeToken;
      S.busy=true;setBusy(true);
      try{
        const scene=await api(`/scenes/${id}`);
        if(token!==routeToken||S.scene?.id!==id)return;
        const result=await api(`/scenes/${id}/evaluate?year=${scene.selected_year}`);
        if(token!==routeToken||S.scene?.id!==id)return;
        S.scene=scene;S.result=result;
        const params=new URLSearchParams(location.hash.split('?')[1]||'');
        if(params.has('year')){params.set('year',scene.selected_year);history.replaceState(null,'',`#scene/${id}?${params}`);}
        updateView();$('save-status').textContent='All changes saved';
      }catch(error){fail(error);return false;}
      finally{if(token===routeToken&&S.scene?.id===id){S.busy=false;setBusy(false);}}
    }else if(!location.hash||location.hash==='#projects'){await projects(routeToken);}
  }
});
window.addEventListener('hashchange',route);
document.addEventListener('visibilitychange',()=>{if(document.hidden)pauseSimulation();});
async function start(){
  try{S.user=await api('/me');await route();}
  catch(error){
    if(error.status===401){renderLogin();return;}
    $('app').innerHTML=`<main id="main" class="loading-screen startup"><div class="loading-content">${errorState('Could not connect.','retry-start')}</div></main>`;
    $('retry-start').onclick=()=>{$('app').innerHTML=`<main id="main" class="loading-screen startup">${loadingState('Loading workspace…')}</main>`;start();};
  }
}
await start();
