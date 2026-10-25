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
const climates = {temperate_dry:'Temperate · dry',temperate_moist:'Temperate · moist',tropical_dry:'Tropical · dry',tropical_moist:'Tropical · moist',tropical_montane:'Tropical · montane'};
const palette = ['#416e51','#b47351','#8c83a5','#718fa1','#b0a05b','#c07080'];
const S = {user:null, scenes:[], selected:new Set(), scene:null, result:null, baseIndex:new Map(), resultIndex:new Map(), cells:new Map(), layer:'cover', selection:new Set(), busy:false, map:null, playing:false, playTimer:null, brush:'inspect', pending:new Map(), paintQueue:[], stroke:null, cleanup:null, timelineKey:null, timeline:null, timelineError:false};
let toastTimer, routeToken=0, paintTask=null;
const logo = `<a class="logo" href="#projects" aria-label="phone na hello home"><svg viewBox="0 0 32 32" aria-hidden="true"><rect width="32" height="32" rx="9" fill="#214f40"/><path d="m6 12 10-6 10 6-10 6z" fill="#dce9ad"/><path d="m6 20 10 6 10-6M6 16l10 6 10-6" fill="none" stroke="#dce9ad" stroke-width="1.6"/></svg>phone na hello<span style="color:#88a367">.</span></a>`;

async function api(path, options={}) {
  const r = await fetch(`/api${path}`, {...options, headers:{'Content-Type':'application/json',...options.headers}});
  const data = await r.json();
  if (!r.ok) {
    if(r.status === 401 && S.user && !path.startsWith('/auth')) { S.user=null; renderLogin(); }
    throw new Error(typeof data.detail === 'string' ? data.detail : 'Check your inputs and try again.');
  }
  return data;
}
const post = (path, data={}) => api(path,{method:'POST',body:JSON.stringify(data)});
function toast(message) { $('toast').textContent=message; $('toast').classList.add('visible');clearTimeout(toastTimer);toastTimer=setTimeout(()=>$('toast').classList.remove('visible'),4800); }
function fail(error) { toast(error.message || String(error)); }
function header() {
  return `<header class="topbar">${logo}<nav class="nav" aria-label="Main navigation"><a href="#projects" class="active">My projects</a><span class="subtle-divider"></span><span class="email muted">${esc(S.user?.email)}</span><span class="avatar" aria-hidden="true">${esc(S.user?.email[0].toUpperCase())}</span><button id="logout" class="ghost small">Sign out</button></nav></header>`;
}
function mount(body) {
  pauseSimulation();
  S.cleanup?.(); S.cleanup=null;
  if(S.map) {S.map.remove();S.map=null;}
  $('app').innerHTML=header()+body;
  $('logout').onclick=async()=>{if(paintTask)await paintTask;await post('/logout');S.user=null;S.selected.clear();renderLogin();};
}
function dialog(title, body, extra='') {
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
  const paths=cells.map(c=>`<path d="${polygons(c.geometry).map(p=>p.map(r=>r.map(([x,y],i)=>`${i?'L':'M'}${(dx+(x-minX)*aspect*scale).toFixed(1)},${(height-dy-(y-minY)*scale).toFixed(1)}`).join(' ')+'Z').join(' ')).join(' ')}" fill="${mode==='degradation'?statusColors[c.degradation.status]:colors[c.cover]||colors.unknown}" stroke="#f7f8f3" stroke-width="${mode==='degradation'?.15:.65}" fill-rule="evenodd"/>`).join('');
  return `<svg viewBox="0 0 ${width} ${height}" role="img" aria-label="Land-cover cells for this scene">${paths}</svg>`;
}

function renderLogin() {
  pauseSimulation();S.cleanup?.();S.cleanup=null;
  if(S.map){S.map.remove();S.map=null;}
  $('app').innerHTML=`<main id="main" class="login"><section class="login-story">${logo}<h1 class="two-lines"><span>A shared future.</span><em>Your part in it.</em></h1><div id="hero-grid" class="hero-grid"></div><div class="story-footer"><span>Built for community voices</span><span>San Francisco · 2026</span></div></section><section class="login-form-wrap"><form id="auth-form" class="login-form"><h1>Make room for possibility.</h1><div class="email-entry"><input id="email" name="email" type="email" autocomplete="email" aria-label="Email address" placeholder="you@example.com" required maxlength="254" aria-describedby="auth-error"><button id="auth-submit" class="email-arrow" type="submit" aria-label="Continue"><span aria-hidden="true">↗</span></button></div><div id="auth-error" class="form-error" role="alert"></div></form></section></main>`;
  fetch('/static/ggp-preview.json').then(r=>r.json()).then(c=>{if($('hero-grid'))$('hero-grid').innerHTML=miniMap(c,600,230);}).catch(()=>{});
  $('auth-form').onsubmit=async e=>{e.preventDefault();$('auth-submit').disabled=true;$('auth-error').textContent='';try{S.user=await post('/auth/enter',{email:$('email').value});location.hash='#projects';await route();}catch(err){$('auth-error').textContent=err.message;$('auth-submit').disabled=false;}};
}

async function projects(token) {
  const scenes=await api('/scenes');if(token!==routeToken)return;S.scenes=scenes;
  S.selected=new Set([...S.selected].filter(id=>scenes.some(s=>s.id===id)));
  mount(`<main id="main" class="page"><div class="page-heading"><div><span class="eyebrow">Your landscape, your possibilities</span><h1>Places to make a difference.</h1></div></div><div class="row between sectionbar"><strong>${scenes.length} saved ${scenes.length===1?'scene':'scenes'}</strong></div><section class="cards" aria-label="Saved scenes">${scenes.map(s=>`<article class="card ${S.selected.has(s.id)?'selected':''}" data-card="${s.id}"><div class="card-preview">${miniMap(s.preview)}<label class="select-card"><input type="checkbox" data-select="${s.id}" aria-label="Select ${esc(s.name)} for comparison" ${S.selected.has(s.id)?'checked':''}> Compare</label></div><div class="card-body"><span class="badge ${s.actions.length?'warm':''}">${s.actions.length?`${s.actions.length} ${s.actions.length===1?'intervention':'interventions'}`:'Unchanged baseline'}</span><h3><a class="scene-link" href="#scene/${s.id}">${esc(s.name)}</a></h3><p>${esc(s.place)} · ${s.cell_count} cells</p><div class="card-meta"><span>${s.year} → ${s.selected_year}</span><button class="small ghost" data-alternative="${s.id}" aria-label="Create alternative from ${esc(s.name)}">＋ Alternative</button></div></div></article>`).join('')}<button class="create-card" id="create-card" aria-label="Create a world"><span class="plus" aria-hidden="true">＋</span></button></section><div id="compare-tray"></div></main>`);
  $('create-card').onclick=()=>location.hash='#new';
  document.querySelectorAll('[data-select]').forEach(b=>b.onchange=()=>{if(b.checked)S.selected.add(b.dataset.select);else S.selected.delete(b.dataset.select);document.querySelector(`[data-card="${b.dataset.select}"]`).classList.toggle('selected',b.checked);comparisonTray();});
  document.querySelectorAll('[data-alternative]').forEach(button=>button.onclick=()=>createAlternative(scenes.find(s=>s.id===button.dataset.alternative)));
  comparisonTray();
}
function createAlternative(scene){
  dialog('Create an alternative',`<form id="alternative-form"><label for="alternative-name">Name</label><input id="alternative-name" value="${esc(scene.name.slice(0,80)+' · alternative')}" maxlength="100" required><label class="row" style="margin:16px 0"><input type="checkbox" id="alternative-reset" style="width:auto">Start from original land cover</label><p class="tiny muted">Uses the same starting data and climate so you can compare outcomes.</p><button class="primary" id="save-alternative">Create ↗</button><p id="alternative-error" role="alert"></p></form>`);
  $('alternative-form').onsubmit=async event=>{event.preventDefault();$('save-alternative').disabled=true;try{const copy=await post(`/scenes/${scene.id}/clone?reset=${$('alternative-reset').checked}`,{name:$('alternative-name').value.trim()});$('dialog').close();location.hash=`#scene/${copy.id}`;}catch(error){$('alternative-error').textContent=error.message;$('save-alternative').disabled=false;}};
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
  mount(`<main id="main" class="region-screen"><div id="map" class="map" aria-label="Pan to a place, then move or resize the selection"></div><section class="region-search"><div class="row"><a href="#projects" class="back region-icon-button" aria-label="All projects">${regionIcon('back')}</a><form id="search-form" class="row grow"><input id="place-search" aria-label="Search for a place" placeholder="Search for a place" minlength="3" required><button class="region-icon-button" aria-label="Search places">${regionIcon('search')}</button></form><button id="region-settings" class="ghost region-icon-button" aria-label="Region settings">${regionIcon('settings')}</button><button id="region-info" class="ghost region-icon-button" aria-label="Data information">${regionIcon('info')}</button></div><div id="search-results" class="search-results" role="status"></div></section><div class="region-hint"><span id="area-note" role="status"></span><span id="region-instruction">Drag the center to move · corners to resize</span><div class="row"><button id="recenter-region" class="small">Select here</button><button id="select-city" class="small">All San Francisco</button></div></div><div class="create-dock"><div class="baseline-field"><label for="baseline-year">Baseline year</label><div class="baseline-select"><select id="baseline-year"><option>2021</option><option>2020</option></select>${regionIcon('chevron')}</div></div><button id="create-world" class="primary" aria-label="Create world"><span>Create</span>${regionIcon('arrow')}</button></div><div id="creation-progress" class="busy-overlay" hidden><div class="spinner"></div><p id="progress-message" role="status">Reading this region…</p></div></main>`);
  const map=baseMap('map',[[37.755,-122.523],[37.788,-122.449]]);
  let bounds=L.latLngBounds([[37.765,-122.509],[37.774,-122.457]]),climate='temperate_dry',cityBoundary=null,citySelected=false,cityRequest=0;
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
    const feature=await api('/regions/sf');if(token!==routeToken||request!==cityRequest)return;
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
    e.preventDefault();$('search-results').textContent='Searching…';
    try{const hits=await api(`/search?q=${encodeURIComponent($('place-search').value)}`);if(token!==routeToken)return;$('search-results').innerHTML=hits.length?hits.map((p,i)=>`<button data-hit="${i}">${esc(p.name)}</button>`).join(''):'No places found.';document.querySelectorAll('[data-hit]').forEach(b=>b.onclick=()=>{const p=hits[Number(b.dataset.hit)];if(/^San Francisco(?:,|$)/i.test(p.name)&&Math.abs(p.lat-37.77)<.2&&Math.abs(p.lon+122.44)<.2){selectCity().catch(fail);}else{moveTo(p);$('place-search').value=p.name.split(',')[0];}$('search-results').innerHTML='';});}catch(err){if(token===routeToken)$('search-results').textContent=err.message;}
  };
  $('create-world').onclick=async()=>{
    const c=citySelected?L.latLng(place.lat,place.lon):bounds.getCenter(),label=place.name.split(',')[0];
    const body={name:`${label} · first idea`.slice(0,100),lat:c.lat,lon:c.lng,bounds:citySelected?null:coordinates(),place:citySelected?'sf':null,location_name:label,year:Number($('baseline-year').value),climate};
    $('create-world').disabled=true;$('creation-progress').hidden=false;
    try{
      const job=await post('/scenes',body);
      while(token===routeToken){
        const state=await api(`/jobs/${job.job_id}`);
        if(token!==routeToken)return;
        if(state.status==='complete'){location.hash=`#scene/${state.scene_id}`;return;}
        if(state.status==='failed')throw new Error(state.message);
        $('progress-message').textContent=state.message;
        await new Promise(r=>setTimeout(r,1200));
      }
    }catch(err){if(token===routeToken){fail(err);$('creation-progress').hidden=true;if(citySelected)$('create-world').disabled=false;else refresh();}}
  };
}

async function openScene(id,token,params=new URLSearchParams()){
  const scene=await api(`/scenes/${id}`);
  const result=await api(`/scenes/${id}/evaluate?year=${scene.selected_year}`);
  if(token!==routeToken)return;
  S.scene=scene;S.result=result;S.baseIndex=new Map(scene.baseline.cells.map(c=>[c.id,c]));S.resultIndex=new Map(result.cells.map(c=>[c.id,c]));S.selection.clear();S.cells.clear();S.busy=false;
  const b=scene.baseline;
  if(['cover','ndvi','soc','change','degradation'].includes(params.get('layer')))S.layer=params.get('layer');
  S.brush='inspect';S.pending.clear();S.paintQueue=[];
  mount(`<main id="main" class="workspace paint-workspace floating-workspace"><section class="map-column" aria-label="Scenario map"><h1 id="scene-title" class="sr-only">${esc(scene.name)}</h1><span id="save-status" class="sr-only">Saved</span><div class="map-area"><div id="map" class="map" role="region" aria-label="Hover for cell details. Select a brush, then click or drag to paint."></div><div class="brush-toolbar" role="toolbar" aria-label="Land-cover brushes">${Object.keys(names).filter(k=>k!=='unknown').map(k=>`<button data-brush="${k}" style="--brush-color:${colors[k]}" aria-label="Paint ${names[k]}" aria-pressed="false" title="${names[k]}">${brushIcon(k)}</button>`).join('')}</div><div class="map-compass">N<br><strong>↑</strong></div><div class="map-view-control"><div class="layer-tiles" role="group" aria-label="Map layers">${[['cover','Land cover'],['ndvi','NDVI'],['soc','Soil carbon'],['change','Soil-carbon change'],['degradation','Simulated land degradation']].map(([v,n])=>`<button data-layer="${v}" aria-label="${n}" title="${n}" aria-pressed="${S.layer===v}">${layerIcon(v)}</button>`).join('')}</div><details class="map-key"><summary aria-label="Map legend and explanation">ⓘ</summary><div id="legend" class="legend"></div><p id="layer-context"></p><button id="evidence" class="source-button">Sources & model assumptions ↗</button></details></div><section class="simulation-dock" aria-label="Simulation clock"><div class="simulation-top"><button id="play-simulation" class="clock-button" aria-label="Play simulation">▶</button><div class="clock-year"><strong id="year-label">${scene.selected_year}</strong><span id="clock-state" class="sr-only">Paused</span></div><button id="reset-baseline" class="ghost small" title="Restore original land cover and year">↺ Reset</button></div><div id="simulation-metrics" aria-live="off"></div></section></div></section></main>`);
  const view=params.get('focus')?focusExtent(b,new Set(params.get('focus').split(','))).bounds:b.bounds;
  const map=baseMap('map',latBounds(view));
  L.geoJSON({type:'FeatureCollection',features:b.cells.map(c=>({type:'Feature',geometry:c.geometry,properties:{id:c.id}}))},{style:f=>cellStyle(f.properties.id),onEachFeature:(f,layer)=>{S.cells.set(f.properties.id,layer);}}).addTo(map);
  for(const [id,layer] of S.cells){
    const path=layer.getElement();if(!path)continue;
    path.dataset.cell=id;path.tabIndex=0;path.setAttribute('role','button');path.setAttribute('aria-label',`Cell ${id}. Focus for details; Enter paints with the active brush.`);
    path.addEventListener('focus',()=>{ensureCellTooltip(id,layer);layer.openTooltip(layer.getBounds().getCenter());});
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
  $('reset-baseline').onclick=()=>{pauseSimulation();chooseBrush('inspect');mutate(()=>post(`/scenes/${id}/reset`,{revision:S.scene.revision}));};
  $('play-simulation').onclick=()=>{if(S.playing)pauseSimulation();else{S.playing=true;chooseBrush('inspect');updateClock();scheduleTick();}};
  $('evidence').onclick=showEvidence;
  updateView();
}
async function mutate(operation){
  if(S.busy)return;S.busy=true;
  const id=S.scene.id;
  setBusy(true);
  try{await operation();const scene=await api(`/scenes/${id}`);const result=await api(`/scenes/${id}/evaluate?year=${scene.selected_year}`);if(location.hash.split('?')[0]!==`#scene/${id}`)return;S.scene=scene;S.result=result;updateView();$('save-status').textContent='All changes saved';}
  catch(err){fail(err);if($('save-status'))$('save-status').textContent='Change not saved · reload if the scene changed elsewhere';}
  finally{S.busy=false;if(location.hash.split('?')[0]===`#scene/${id}`)setBusy(false);}
}
function setBusy(value){
  for(const id of ['reset-baseline'])if($(id))$(id).disabled=value;
  if(value)$('save-status').textContent='Saving…';
  if($('play-simulation'))$('play-simulation').disabled=(value&&!S.playing);
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
  $('play-simulation').textContent=S.playing?'Ⅱ':'▶';
  $('play-simulation').setAttribute('aria-label',S.playing?'Pause simulation':'Play simulation');
  $('play-simulation').disabled=(S.busy&&!S.playing);
  $('clock-state').textContent=S.playing?'Running':'Paused';
  document.querySelector('.simulation-dock')?.classList.toggle('running',S.playing);
}
function pauseSimulation(){S.playing=false;clearTimeout(S.playTimer);S.playTimer=null;updateClock();}
function scheduleTick(){
  clearTimeout(S.playTimer);
  S.playTimer=setTimeout(async()=>{
    if(!S.playing||document.hidden){pauseSimulation();return;}
    if(S.busy){scheduleTick();return;}
    const id=S.scene.id,year=S.result.year+1;
    await mutate(()=>api(`/scenes/${id}`,{method:'PATCH',body:JSON.stringify({revision:S.scene.revision,selected_year:year})}));
    if(S.result.year!==year)pauseSimulation();
    if(S.playing)scheduleTick();
  },1000);
}

function blend(hex1,hex2,t){t=Math.max(0,Math.min(1,t));const a=hex1.match(/\w\w/g).map(x=>parseInt(x,16)),b=hex2.match(/\w\w/g).map(x=>parseInt(x,16));return '#'+a.map((v,i)=>Math.round(v+(b[i]-v)*t).toString(16).padStart(2,'0')).join('');}
function cellStyle(id){
  const base=S.baseIndex.get(id),state=S.resultIndex.get(id);
  let fill=colors[S.pending.get(id)||state.cover]||colors.unknown;
  if(S.layer==='ndvi'){const value=state.ndvi;fill=value==null?colors.unknown:blend('ece6c7','336d48',(value+.1)/.9);}
  if(S.layer==='soc')fill=state.soc==null?colors.unknown:blend('eee4cc','6a7552',state.soc/120);
  if(S.layer==='change')fill=statusColors[state.status];
  if(S.layer==='degradation')fill=statusColors[state.degradation.status];
  return {fillColor:fill,fillOpacity:.9,color:'#f8f9f2',weight:.4,opacity:.3};
}
function ensureCellTooltip(id,layer){
  if(!layer.getTooltip())layer.bindTooltip(()=>cellDetail(id),{sticky:true});
}
function cellDetail(id){
  const b=S.scene.baseline,state=S.resultIndex.get(id),base=S.baseIndex.get(id);
  return `<strong>${names[S.pending.get(id)||state.cover]||'Unknown'}</strong> · ${fmt(base.area_ha,2)} ha<br><span class="muted">Cell ${esc(id)}</span><br>NDVI ${fmt(base.ndvi,3)} · observed ${b.year}<br>NDVI ${fmt(state.ndvi,3)} · scenario ${S.result.year}<br>${fmt(base.coverage.ndvi*100,0)}% NDVI coverage<br>Soil carbon ${state.soc==null?'unknown':`${fmt(state.soc)} t C/ha · ${S.result.year}`}<br>${fmt(base.coverage.soc*100,0)}% soil coverage${state.delta_pct==null?'':` · ${signed(state.delta_pct)}% carbon change`}${S.layer==='degradation'?`<br><strong>Simulated degradation: ${state.degradation.status}</strong><br>Productivity: ${state.degradation.productivity.status}${state.degradation.productivity.samples<13?` · ${state.degradation.productivity.samples}/13 annual samples`:''}${state.degradation.productivity.unavailable_reason?`<br>${esc(state.degradation.productivity.unavailable_reason)}`:''}<br>Land cover: ${Object.entries(state.degradation.land_cover).filter(([,v])=>v>0).map(([k,v])=>`${fmt(v*100,0)}% ${k}`).join(', ')}<br>Carbon: ${state.degradation.soil_carbon}<br>${fmt(state.degradation.assessed_fraction*100,0)}% of cell assessed`:''}`;
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
  const contexts={cover:`${b.year} satellite land cover, updated by your interventions. Each cell can contain several cover types; its color shows the largest share.`,ndvi:`Scenario NDVI at ${S.result.year}, anchored to observed ${b.year} values. Cover-dependent response times are prototype assumptions, not measured growth rates.`,soc:`Estimated soil carbon in the top 30 cm. Future values follow a 20-year transition assumption. Source resolution: 250 m.`,change:'Carbon only: ≥10% loss is declining, ≥10% gain is improving.',degradation:`Simulated productivity + land cover + carbon. Any known decline wins; gray means insufficient information. Productivity uses the evolving NDVI series and becomes available from ${b.year+12}. This is a scenario, not observed degradation.`};
  $('layer-context').textContent=contexts[S.layer];
  updateSimulationMetrics();
  if(S.layer==='cover')$('legend').innerHTML=`<strong>Land cover</strong><div class="legend-items">${Object.entries(names).filter(([k])=>k!=='unknown').map(([k,n])=>`<span><i class="swatch" style="background:${colors[k]}"></i>${n}</span>`).join('')}</div>`;
  else if(S.layer==='change'||S.layer==='degradation')$('legend').innerHTML=`<strong>${S.layer==='degradation'?'Simulated land degradation':'Soil-carbon change from baseline'}</strong><div class="legend-items">${Object.entries(statusColors).map(([k,v])=>`<span><i class="swatch" style="background:${v}"></i>${k[0].toUpperCase()+k.slice(1)}</span>`).join('')}</div><p class="tiny muted" style="margin:8px 0 0">${S.layer==='degradation'?'Purple marks a known declining portion. Unassessed area remains unknown in totals.':'Partial cells show their known portion’s status.'}</p>`;
  else $('legend').innerHTML=`<strong>${ndviView?'NDVI':'Soil carbon · tonnes C / ha'}</strong><div class="legend-gradient" style="background:linear-gradient(90deg,${ndviView?'#ece6c7,#336d48':'#eee4cc,#6a7552'})"></div><div class="legend-range"><span>${ndviView?'≤ −0.1':'0'}</span><span>${ndviView?'≥ 0.8':'120+'}</span></div><div style="margin-top:7px"><i class="swatch" style="background:${colors.unknown}"></i>No data</div>`;
  for(const [id,layer] of S.cells){
    refreshCellStyle(id,layer);
    if(layer.getTooltip()?.isOpen())layer.setTooltipContent(()=>cellDetail(id));
  }


  updateClock();
}
function layerIcon(kind){
  const paths={degradation:'<path d="M12 3 3 7v6c0 4 9 8 9 8s9-4 9-8V7l-9-4Z"/><path d="m7 12 3 3 7-7"/>',cover:'<path d="m12 3 9 5-9 5-9-5 9-5Zm-9 9 9 5 9-5M3 16l9 5 9-5"/>',ndvi:'<path d="M3 18h18M4 14l4-4 4 3 7-9m-5 0h5v5"/>',soc:'<path d="M3 7h18M3 12h18M3 17h18M7 7v5m10 0v5"/>',change:'<path d="M3 12h4l3-7 4 14 3-7h4"/>'};
  return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths[kind]}</svg>`;
}
function updateSimulationMetrics(){
  if(!$('simulation-metrics'))return;
  const scene=S.scene,m=S.result.metrics,ndviView=S.layer==='ndvi';
  const key=JSON.stringify([scene.id,scene.climate,scene.model_version,scene.ndvi_model_version,scene.actions]);
  if(S.timelineKey!==key){
    S.timelineController?.abort();
    S.timelineKey=key;S.timeline=[];S.timelineError=false;S.timelineLoading=false;
  }
  // Reuse the year already evaluated for the map instead of projecting 40 future years.
  const known=new Map(S.timeline.map(point=>[point.year,point]));
  known.set(S.result.year,{year:S.result.year,metrics:m});
  S.timeline=[...known.values()].sort((a,b)=>a.year-b.year);
  const missing=[];
  for(let year=scene.baseline.year;year<S.result.year;year++)if(!known.has(year))missing.push(year);
  if(missing.length&&!S.timelineLoading&&!S.timelineError){
    const controller=new AbortController();S.timelineController=controller;S.timelineLoading=true;
    api(`/scenes/${scene.id}/timeline?start_year=${missing[0]}&end_year=${missing.at(-1)}`,{signal:controller.signal}).then(data=>{
      if(S.timelineKey!==key||S.scene?.id!==scene.id||controller.signal.aborted)return;
      const merged=new Map(data.points.map(point=>[point.year,point]));
      for(const point of S.timeline)merged.set(point.year,point);
      S.timeline=[...merged.values()].sort((a,b)=>a.year-b.year);
      S.timelineLoading=false;updateSimulationMetrics();
    }).catch(error=>{
      if(error.name==='AbortError')return;
      if(S.timelineKey===key){S.timelineLoading=false;S.timelineError=true;if(S.scene?.id===scene.id)updateSimulationMetrics();}
    });
  }
  const degradationView=S.layer==='degradation';
  const field=degradationView?'degrading_ha':S.layer==='ndvi'?'simulated_ndvi':S.layer==='soc'?'carbon_tonnes':'carbon_change_tonnes';
  const label=degradationView?'Simulated declining area':ndviView?'Scenario NDVI':S.layer==='soc'?'Modeled soil carbon':'Modeled carbon change';
  const value=ndviView?fmt(m[field],3):field==='carbon_change_tonnes'?signed(m[field]):fmt(m[field]);
  const unit=degradationView?' ha':ndviView?'':' t C';
  const points=S.timeline?.filter(p=>p.year<=S.result.year)||[];
  const graph=!missing.length?metricGraph(points,field,label,ndviView):`<div class="metric-graph-placeholder">${S.timelineError?'Chart unavailable':'Loading history…'}</div>`;
  $('simulation-metrics').innerHTML=`<div class="metric-heading"><span>${label}</span></div><strong class="live-metric">${value}<span>${unit}</span></strong>${graph}${degradationView?`<div class="tiny muted">${fmt(m.degradation_ha.unknown)} ha unassessed · ${fmt(m.degradation_ha.improving)} ha improving</div>`:''}<div class="graph-years"><span>${scene.baseline.year}</span><span>${S.result.year>scene.baseline.year?S.result.year:''}</span></div>`;
}
function metricGraph(points,field,label,ndviView){
  const valid=points.filter(p=>Number.isFinite(p.metrics[field]));
  if(!valid.length)return '<div class="metric-graph-placeholder">No data for this area</div>';
  const values=valid.map(p=>p.metrics[field]);
  let low=Math.min(...values),high=Math.max(...values);
  if(field==='carbon_change_tonnes'){low=Math.min(0,low);high=Math.max(0,high);}
  const pad=Math.max((high-low)*.18,ndviView ? .01 : Math.max(Math.abs(high),Math.abs(low))*.03,.01);
  low-=pad;high+=pad;
  const x=year=>8+(year-S.scene.baseline.year)/Math.max(1,S.result.year-S.scene.baseline.year)*306,y=value=>68-(value-low)/(high-low)*52;
  let d='',area='',segment='',firstX,lastX;
  const closeArea=()=>{if(segment)area+=`${segment}L${lastX},74 L${firstX},74 Z `;segment='';};
  for(const p of points){
    const v=p.metrics[field];if(!Number.isFinite(v)){closeArea();continue;}
    const px=x(p.year).toFixed(2),py=y(v).toFixed(2);
    const command=`${segment?'L':'M'}${px},${py} `;
    if(!segment)firstX=px;
    lastX=px;segment+=command;d+=command;
  }
  closeArea();
  const last=points.at(-1),lastValue=last?.metrics[field],cx=x(last?.year??S.result.year),cy=Number.isFinite(lastValue)?y(lastValue):0;
  const zero=low<=0&&high>=0?`<path class="graph-zero" d="M8 ${y(0)}H314"/>`:'';
  return `<svg class="metric-graph" viewBox="0 0 322 80" role="img" aria-label="${label}, ${S.scene.baseline.year} to ${S.result.year}. Current value ${fmt(lastValue,ndviView?3:1)}${field==='degrading_ha'?' hectares':ndviView?'':' tonnes carbon'}."><defs><linearGradient id="chart-fill" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stop-color="currentColor" stop-opacity=".28"/><stop offset="100%" stop-color="currentColor" stop-opacity=".03"/></linearGradient></defs><path class="graph-area" fill="url(#chart-fill)" d="${area.trim()}"/><path class="graph-grid" d="M8 16H314M8 42H314M8 68H314"/>${zero}<path class="graph-trace" d="${d.trim()}"/>${Number.isFinite(lastValue)?`<circle class="graph-halo" cx="${cx}" cy="${cy}" r="7"/><circle class="graph-tip" cx="${cx}" cy="${cy}" r="3"/>`:''}<text x="314" y="10" text-anchor="end">${fmt(high,ndviView?3:1)}</text></svg>`;
}

function brushIcon(kind){
  const paths={inspect:'<circle cx="10" cy="10" r="5"/><path d="m14 14 6 6"/>',trees:'<path d="m12 3-7 10h4l-5 5h16l-5-5h4zM12 18v4"/>',grass:'<path d="M12 21V7m0 10-7-7m7 6 7-8M7 21 3 14m14 7 4-7"/>',crops:'<path d="M12 22V3m0 8C5 11 5 7 5 7s7 0 7 4Zm0 6c-7 0-7-4-7-4s7 0 7 4Zm0-9c7 0 7-4 7-4s-7 0-7 4Zm0 6c7 0 7-4 7-4s-7 0-7 4Z"/>',wetland:'<path d="M3 20q3-3 6 0t6 0 6 0M9 17V5m6 12V3M7 5h4v5H7zm6-2h4v5h-4z"/>',built:'<path d="M4 21V8l7-5v18m0-11h9v11M2 21h20M7 9v2m0 3v2m8-2h2m-2 3h2"/>',bare:'<path d="m3 17 5-6 4 4 4-8 5 10M3 21h18"/>',water:'<path d="M12 3s-6 7-6 11a6 6 0 0 0 12 0c0-4-6-11-6-11Z"/>'};
  return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths[kind]}</svg>`;
}
function canPaint(){
  if(S.brush==='inspect'||(S.busy&&!paintTask))return false;
  const latest=Math.max(S.scene.baseline.year,...S.scene.actions.map(a=>a.year));
  if(S.result.year<latest){toast(`Move to ${latest} or later to paint, or undo the later edits.`);return false;}
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
  const id=S.scene.id;
  try{
    while(S.paintQueue.length){
      const stroke=S.paintQueue[0];
      await post(`/scenes/${id}/actions`,{...stroke,revision:S.scene.revision});
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
  const b=S.scene.baseline;
  dialog('What is this grounded in?',`<p>Observed starting conditions and modeled possibilities have different meanings. These are the inputs and assumptions saved with this scene.</p>${b.sources.map(s=>`<div class="source-record"><strong>${esc(s.name)}</strong><p>${esc(s.kind)} · ${s.year||'mixed observation years'} · ${s.resolution_m} m · ${esc(s.license)}</p><a class="tiny" href="${esc(s.url)}" target="_blank" rel="noreferrer">Source documentation ↗</a></div>`).join('')}<h3>Soil-carbon scenario model</h3><p>Model: ${esc(S.scene.model_version)}. Climate assumption: ${climates[S.scene.climate]}. A land-cover transition sets a 20-year target from the carbon stock already reached and the conversion factor for the previous and new cover. The fixed annual change continues for up to 20 years, following the Trends.Earth SOC update rule.</p><p>For mixed cells, conversion factors are weighted by mapped cover fractions, assuming equal starting carbon density across those fractions. A later transition recalculates its target from the current stock. Multiple edits in one simulated year resolve to the final cover; repainting the same annual cover does not restart the trajectory. Mixed-cell weighting is our aggregation assumption. We use the same conversion coefficients and annual stock-change rule as the pinned Trends.Earth implementation, with our own baseline data and scene-level climate assumption.</p><p>SoilGrids is a statistical estimate for the top 30 cm, not a ${b.year} soil survey. Carbon totals use only its valid area. Observed NDVI remains the reference. Simulated NDVI feeds the productivity component of our simulated degradation assessment.</p><a class="tiny" href="https://docs.trends.earth/en/latest/for_users/features/unccdreporting.html#soil-organic-carbon" target="_blank" rel="noreferrer">Coefficient method and limitations ↗</a><h3>NDVI scenario · assumed response</h3><p>Model: ${esc(S.result.ndvi_model_version)}. Targets add a cover-fraction adjustment to each cell’s original observed NDVI, bounded to −1…1. Later edits start from attained NDVI; targets stay anchored to the original baseline. Within each year, the final cover wins. Missing observations stay unknown.</p><table><thead><tr><th>Cover</th><th>Coefficient</th><th>Years to target</th></tr></thead><tbody>${Object.entries(S.result.ndvi_model.category_parameters).map(([k,v])=>`<tr><td>${esc(names[k])}</td><td>${fmt(v.beta,2)}</td><td>${v.response_years||'Immediate'}</td></tr>`).join('')}</tbody></table><p>All response times are invented prototype assumptions. Forest, grassland and artificial coefficients come from an SF observational fit; other coefficients are uncalibrated placeholders. These defaults are used at every location and are not validated for other regions. Seasonality, weather, irrigation and clearing followed by planting are not modeled. Productivity applies Trends.Earth assessment rules to these synthetic annual values, with the adaptations below.</p><h3>Simulated land degradation</h3><p>Model: ${esc(S.result.degradation_model.version)}. We combine productivity, the pinned UNCCD land-cover transition matrix, and soil-carbon change using one out, all out. A known decline wins; improvement or stability needs all three inputs. Mixed-cover transitions retain their area fractions.</p><p>${esc(S.result.degradation_model.productivity.state)}</p><p>${esc(S.result.degradation_model.productivity.trajectory)}</p><p>${esc(S.result.degradation_model.productivity.performance)}</p><p>The first 10 annual samples form a fixed simulated reference period, including any early interventions. Productivity is unknown until 13 samples exist; land-cover or carbon decline can still identify degradation earlier. These calculations describe our model’s behavior, not statistical confidence in real-world forecasts. Performance groups lack soil taxonomy, so results are not identical to Trends.Earth.</p><p>${esc(S.result.degradation_model.area_policy)}</p><a class="tiny" href="${esc(S.result.degradation_model.land_cover_reference)}" target="_blank" rel="noreferrer">Land-cover matrix ↗</a><h3>Spatial aggregation</h3><p>${esc(b.aggregation)}</p><p>Boundary: ${esc(b.boundary_source)}. Snapshot retrieved ${esc(b.retrieved_at.slice(0,10))}. The scene API retains input URLs, crop hashes, baseline values, actions, and model settings.</p><div class="note">This supports discussion of an explicit scenario. It is not a validated forecast, a full soil-health assessment, or an official UNCCD report.</div>`);
}

function focusExtent(b,edited){
  edited=new Set(b.cells.filter(c=>edited.has(c.id)).map(c=>c.id));
  if(!edited.size)return {cells:b.cells,bounds:b.bounds,focused:false,ids:[]};
  const centers=b.cells.filter(c=>edited.has(c.id)).map(c=>c.center);
  const dy=(b.cell_m||165)*2/111320,dx=dy/Math.cos(centers[0][1]*Math.PI/180);
  const bounds=[Math.min(...centers.map(c=>c[0]))-dx,Math.min(...centers.map(c=>c[1]))-dy,Math.max(...centers.map(c=>c[0]))+dx,Math.max(...centers.map(c=>c[1]))+dy];
  return {cells:b.cells.filter(c=>c.center[0]>=bounds[0]&&c.center[0]<=bounds[2]&&c.center[1]>=bounds[1]&&c.center[1]<=bounds[3]),bounds,focused:true,ids:[...edited]};
}
async function comparison(ids,token){
  const first=await api(`/scenes/${ids[0]}`);if(token!==routeToken)return;
  let year=first.selected_year,generation=0;
  async function render(){
    const sequence=++generation;
    let result;
    try{result=await post('/compare',{scene_ids:ids,year});}catch(e){if(token!==routeToken||sequence!==generation)return;mount(`<main id="main" class="page"><a class="back" href="#projects">← All projects</a><h1>These scenes need a shared starting point.</h1><p>${esc(e.message)}</p><a href="#projects">Return to projects and create an alternative ↗</a></main>`);return;}
    if(token!==routeToken||sequence!==generation)return;
    const scenes=result.scenes,b=result.baseline,m=result.reference.metrics,extent=focusExtent(b,new Set(scenes.flatMap(s=>s.cells.filter(c=>c.changed).map(c=>c.id))));
    const previews=scenes.map(s=>{const cells=new Map(s.cells.map(c=>[c.id,c]));return `<section class="panel comparison-map" data-comparison-scene="${s.id}"><h3>${esc(s.name)}</h3>${miniMap(extent.cells.map(c=>({...cells.get(c.id),geometry:c.geometry})),400,220,'degradation')}<div class="row between"><span>${fmt(s.metrics.degrading_ha)} ha declining</span><a href="#scene/${s.id}?layer=degradation&focus=${encodeURIComponent(extent.ids.join(','))}" data-open-comparison="${s.id}">Open at ${year} ↗</a></div><p class="tiny muted">${fmt(s.metrics.degradation_ha.improving)} ha improving · ${fmt(s.metrics.degradation_ha.unknown)} ha unassessed</p></section>`;}).join('');
    const bars=scenes.map(s=>`<div class="scenario-bar"><div class="row between"><strong>${esc(s.name)}</strong><span>${fmt(s.metrics.degrading_ha)} ha declining</span></div><div class="status-bar" aria-label="${esc(s.name)} simulated land degradation">${Object.entries(statusColors).map(([k,v])=>`<span style="width:${s.metrics.degradation_ha[k]/m.area_ha*100}%;background:${v}" title="${k}: ${fmt(s.metrics.degradation_ha[k])} ha"></span>`).join('')}</div></div>`).join('');
    mount(`<main id="main" class="page"><div class="page-heading"><div><a href="#projects" class="back">← All projects</a><span class="eyebrow" style="display:block">Compare possibilities</span><h1>One place. Different futures.</h1><p>${esc(b.name)} · shared ${b.year} baseline · ${scenes.length} alternatives</p></div><div class="compare-controls"><label for="compare-year">Compare at year</label><input id="compare-year" type="number" min="${b.year}" step="1" value="${year}"><button class="small" id="export-comparison">Export results ↓</button></div></div>
    <div class="note">Differences compare each scenario with no intervention at the same year, using the same starting data and climate. These are model responses, not observed effects. Unknown area is not stable land.</div>
    <div class="metrics-row"><div class="metric-card"><span class="eyebrow">Shared landscape</span><div class="value">${fmt(m.area_ha)} <small>ha</small></div><p>${b.cells.length} decision cells</p></div><div class="metric-card"><span class="eyebrow">Unchanged reference</span><div class="value">${fmt(m.degrading_ha)} <small>ha declining</small></div><p>${fmt(m.degradation_ha.unknown)} ha unassessed at ${year}</p></div><div class="metric-card"><span class="eyebrow">Soil-data coverage</span><div class="value">${fmt(m.known_carbon_ha/m.area_ha*100,0)}<small>%</small></div><p>Productivity starts at ${b.year+12}; missing inputs stay unknown.</p></div></div>
    <h2>Simulated land degradation</h2><p class="tiny muted">${extent.focused?'Maps share a view centered on edited cells.':'Maps show the shared landscape.'} All hectare totals describe the whole scene.</p><div class="panels comparison-maps">${previews}</div>
    <div class="panels"><section class="panel"><h3>How much land changes status?</h3>${bars}<div class="legend-items tiny">${Object.entries(statusColors).map(([k,v])=>`<span><i class="swatch" style="background:${v}"></i>${k}</span>`).join('')}</div></section><section class="panel"><h3>Carbon response</h3><p>Edited area versus modeled carbon change at ${year}.</p>${scatter(scenes)}</section></div>
    <section class="panel comparison-table"><h3>Differences from no intervention</h3><table><thead><tr><th>Scenario</th><th>Net cover changed</th><th>Declining area Δ</th><th>Improving area Δ</th><th>NDVI Δ</th><th>Carbon Δ</th><th>Unassessed</th><th>Map cells changed</th></tr></thead><tbody>${scenes.map(s=>{const d=s.difference_from_unchanged;return `<tr data-difference-scene="${s.id}"><td>${esc(s.name)}</td><td>${fmt(d.net_changed_ha)} ha</td><td data-metric="degrading_ha">${signed(d.degrading_ha)} ha</td><td data-metric="improving_ha">${signed(d.degradation_ha.improving)} ha</td><td data-metric="ndvi">${d.simulated_ndvi==null?'—':(d.simulated_ndvi>0?'+':'')+fmt(d.simulated_ndvi,4)}</td><td data-metric="carbon">${signed(d.carbon_tonnes)} t C</td><td>${fmt(s.metrics.degradation_ha.unknown)} ha</td><td>${d.degradation_color_changed_cells}</td></tr>`;}).join('')}</tbody></table><p class="tiny muted" style="margin:14px 0 0">Δ = scenario minus unchanged reference at ${year}. NDVI is the mean over valid observed area; carbon uses valid soil area. Declining hectares are a conservative lower bound, and partial cells are not counted as wholly assessed. Map-cell counts describe colors, not assessed hectares.</p></section></main>`);
    $('compare-year').onchange=()=>{year=Number($('compare-year').value);render().catch(fail);};
    document.querySelectorAll('[data-open-comparison]').forEach(link=>link.onclick=async e=>{e.preventDefault();try{const scene=await api(`/scenes/${link.dataset.openComparison}`);await api(`/scenes/${scene.id}`,{method:'PATCH',body:JSON.stringify({revision:scene.revision,selected_year:year})});location.hash=link.getAttribute('href');}catch(error){fail(error);}});
    $('export-comparison').onclick=()=>{const blob=new Blob([JSON.stringify(result,null,2)],{type:'application/json'}),url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download=`comparison-${year}.json`;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);};
  }
  await render();
}
function scatter(scenes){
  const points=scenes.filter(s=>s.metrics.carbon_change_tonnes!=null).map(s=>({name:s.name,x:s.metrics.changed_ha,y:s.metrics.carbon_change_tonnes}));
  if(!points.length)return '<p>No soil-carbon data is available to plot.</p>';
  const xmax=Math.max(1,...points.map(p=>p.x))*1.2,ymin=Math.min(0,...points.map(p=>p.y)),ymax=Math.max(0,...points.map(p=>p.y)),pad=Math.max(1,(ymax-ymin)*.2);
  const lo=ymin-pad,hi=ymax+pad,x=v=>65+v/xmax*330,y=v=>240-(v-lo)/(hi-lo)*195;
  return `<svg viewBox="0 0 450 295" class="scatter" role="img" aria-label="Scatterplot of changed hectares versus modeled carbon change. Exact values are in the table below."><text x="12" y="17">Carbon change (tonnes C)</text>${[0,1,2,3,4].map(i=>{const v=lo+(hi-lo)*i/4;return `<line x1="65" x2="395" y1="${y(v)}" y2="${y(v)}" stroke="#e5e9df"/><text x="57" y="${y(v)+3}" text-anchor="end">${fmt(v,0)}</text><text x="${65+i/4*330}" y="260" text-anchor="middle">${fmt(xmax*i/4,1)}</text>`;}).join('')}<line x1="65" x2="395" y1="${y(0)}" y2="${y(0)}" stroke="#a2b59a" stroke-dasharray="4 4"/>${points.map((p,i)=>`<circle cx="${x(p.x)}" cy="${y(p.y)}" r="7" fill="${palette[i%palette.length]}" stroke="white" stroke-width="2"><title>${esc(p.name)}: ${fmt(p.x)} ha changed; ${signed(p.y)} tonnes carbon</title></circle><text x="${x(p.x)+10}" y="${y(p.y)-10-i%2*8}" class="point-label">${i+1}</text>`).join('')}<text x="230" y="286" text-anchor="middle">Area edited (hectares)</text></svg>`;
}

async function route(){
  pauseSimulation();
  if(paintTask)await paintTask;
  const token=++routeToken;
  if(!S.user){renderLogin();return;}
  const [hashPath,query='']=(location.hash.slice(1)||'projects').split('?');
  const [path,part]=hashPath.split('/');
  try{if(path==='new')await newScene(token);else if(path==='scene'&&part)await openScene(part,token,new URLSearchParams(query));else if(path==='compare'&&part)await comparison(part.split(','),token);else await projects(token);}catch(err){if(token!==routeToken)return;fail(err);if(S.user)mount(`<main class="page" id="main"><h1>This view couldn’t load.</h1><p>${esc(err.message)}</p><a href="#projects">Return to projects</a></main>`);}
}
window.addEventListener('hashchange',route);
document.addEventListener('visibilitychange',()=>{if(document.hidden)pauseSimulation();});
try{S.user=await api('/me');await route();}catch{renderLogin();}
