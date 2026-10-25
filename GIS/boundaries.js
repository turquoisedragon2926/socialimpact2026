'use strict';
const BOUNDARY_KEYS=['blocks','parcels','zoning','watersheds'];
const boundaryStyles={
 blocks:{color:'#8763b1',weight:.8,fillColor:'#b5a0d1',fillOpacity:.10},
 parcels:{color:'#b06132',weight:1,fillColor:'#d6a677',fillOpacity:.10},
 zoning:{color:'#aa486b',weight:1,fillOpacity:.26},
 watersheds:{color:'#247d9b',weight:2.5,fillColor:'#79becb',fillOpacity:.13,dashArray:'7 4'}
};
const zoningColors={'Residential':'#c4aa58','Mixed Use':'#a8679a','Commercial':'#d56e56','Industrial':'#8998b6','Public':'#4e9b82','Mixed':'#a88f9f'};
const boundaryDescriptions={
 blocks:'A 2020 Census block: a small statistical area, clipped to the SF shoreline. Population and housing counts refer to 2020.',
 parcels:'An active mapped parcel footprint. Shared condominium footprints are represented by their map lot; this is not a complete list of ownership units.',
 zoning:'A zoning district from SF Planning. Colors distinguish the source’s general zoning categories; they do not show actual land cover.',
 watersheds:'An urban watershed boundary from SFPUC’s Major_Drainage layer, used in its public watershed map. These describe urban drainage areas, including the influence of city infrastructure.'
};
let boundaryManifest,parcelIndex;
const boundaryLoads={},boundaryLoaded=new Set(),tileCache=new Map();
let parcelRequest=0;
function boundaryName(feature,kind){
 const p=feature.properties;
 return kind==='blocks'?`Census block ${p.geoid20}`:kind==='parcels'?`Parcel ${p.mapblklot}`:kind==='zoning'?`${p.zoning} · ${p.districtna}`:(p.DRAINAGE_N || p.BASIN_NAME || p.Name || p.NAME || p.name || p.Basin || p.basin || 'Urban watershed');
}
function boundaryPairs(feature,kind){
 const p=feature.properties;
 if(kind==='blocks')return [['GEOID',p.geoid20],['Census tract',p.tractce20],['2020 population',p.pop20],['2020 housing units',p.housing20]];
 if(kind==='parcels')return [['Map lot',p.mapblklot],['Address',[p.from_address_num,p.street_name,p.street_type].filter(Boolean).join(' ')],['Zoning code',p.zoning_code],['Zoning district',p.zoning_district],['Neighborhood',p.analysis_neighborhood]];
 if(kind==='zoning')return [['Zoning code',p.zoning],['District',p.districtna],['General category',p.gen],['Planning code section',p.codesectio]];
 return Object.entries(p).filter(([key])=>!/^shape|^objectid|^fid/i.test(key)).map(([key,value])=>[key.replaceAll('_',' '),value]);
}
async function localJSON(path){
 const controller=new AbortController();
 const timeout=setTimeout(()=>controller.abort(),20000);
 try {
  const response=await fetch('data/'+path,{cache:'no-store',signal:controller.signal});
  if(!response.ok)throw new Error(`${path}: HTTP ${response.status}`);
  return await response.json();
 } catch(error) {
  if(error.name==='AbortError')throw new Error(`${path}: loading timed out; reload to retry`);
  throw error;
 } finally {clearTimeout(timeout);}
}
function showBoundaryFailure(message){
 $('boundary-message').textContent=message;
 for(const key of BOUNDARY_KEYS)boundaryStatus(key,'Unavailable — reload to retry');
 document.querySelectorAll('.boundary-row input,.boundary-row button,#parcel-zoom,#boundary-outlines').forEach(el=>el.disabled=true);
}
function boundaryStatus(key,message){$(key+'-status').textContent=message;}
function getBoundaryStyle(feature,key){
 let style={...boundaryStyles[key]};
 if(key==='zoning'){
  const category=feature.properties.gen || 'Other';
  style.fillColor=zoningColors[category] || '#9d9394';
 }
 if($('boundary-outlines').checked)style.fillOpacity=0;
 return style;
}
async function initBoundaries(){
 try {
  [boundaryManifest,parcelIndex]=await Promise.all([localJSON('boundaries-manifest.json'),localJSON('parcel-index.json')]);
  // Share one Canvas so empty layers cannot intercept clicks intended for other layers.
  for(const [i,key] of BOUNDARY_KEYS.entries()){
   map.createPane(key+'Pane');map.getPane(key+'Pane').style.zIndex=430+i*10;
   const renderer=vectorRenderer;
   layers[key]=L.geoJSON(null,{pane:key+'Pane',renderer,style:f=>getBoundaryStyle(f,key),onEachFeature:(feature,layer)=>bindFeature(key,feature,layer,getBoundaryStyle(feature,key))});
   boundaryStatus(key,boundaryManifest.sources[key].features.toLocaleString()+' '+(key==='parcels'?'map lots · zoom in':'areas'));
  }
  $('boundary-outlines').addEventListener('change',()=>{
   for(const key of BOUNDARY_KEYS)layers[key].setStyle(f=>getBoundaryStyle(f,key));
  });
  map.on('moveend',()=>{if($('parcels').checked)loadParcels();});
  $('parcel-zoom').addEventListener('click',()=>{
   $('parcels').checked=true;
   map.setView([37.7596,-122.4269],16,{animate:false});syncLayers();
  });
  document.querySelectorAll('[data-solo]').forEach(button=>button.addEventListener('click',()=>{
   setSampling(false);
   for(const key of Object.keys(layers))$(key).checked=key===button.dataset.solo;
   syncLayers();clearPresets();
   $('lesson-title').textContent='One boundary at a time.';
   $('lesson-text').textContent=boundaryDescriptions[button.dataset.solo];
   if(button.dataset.solo==='parcels' && map.getZoom()<15)map.setView([37.7596,-122.4269],16,{animate:false});
  }));
 }catch(error){
  showBoundaryFailure('Boundary data could not load. Reload to retry. '+error.message);
 }
}
function clearPresets(){document.querySelectorAll('[data-view]').forEach(b=>b.classList.remove('active'));}
function refreshBoundaries(){
 if(!boundaryManifest || !parcelIndex)return;
 for(const key of BOUNDARY_KEYS){
  if(!$(key).checked)continue;
  if(key==='parcels'){loadParcels();continue;}
  if(boundaryLoaded.has(key)||boundaryLoads[key])continue;
  boundaryStatus(key,'Loading local boundaries…');
  boundaryLoads[key]=localJSON(boundaryManifest.sources[key].file).then(collection=>{
   layers[key].addData(collection);boundaryLoaded.add(key);raisePoints();
   boundaryStatus(key,collection.features.length.toLocaleString()+' areas');
  }).catch(error=>boundaryStatus(key,'Load failed; toggle to retry. '+error.message)).finally(()=>{delete boundaryLoads[key];});
 }
 $('parcel-zoom').hidden=!$('parcels').checked || map.getZoom()>=15;
 $('zoning-key').hidden=!$('zoning').checked;
}
function intersects(a,b){return a[0]<=b[2]&&a[2]>=b[0]&&a[1]<=b[3]&&a[3]>=b[1];}
async function loadParcels(){
 const request=++parcelRequest;
 if(!parcelIndex||!$('parcels').checked)return;
 $('parcel-zoom').hidden=map.getZoom()>=15;
 if(map.getZoom()<15){
  layers.parcels.clearLayers();boundaryStatus('parcels','Zoom in to level 15+ to see lots');return;
 }
 const b=map.getBounds().pad(.1),box=[b.getWest(),b.getSouth(),b.getEast(),b.getNorth()];
 const tiles=parcelIndex.tiles.filter(t=>intersects(t.bbox,box));
 boundaryStatus('parcels','Loading lots in this view…');
 try{
  const collections=await Promise.all(tiles.map(tile=>{
   if(!tileCache.has(tile.file))tileCache.set(tile.file,localJSON(tile.file).catch(error=>{tileCache.delete(tile.file);throw error;}));
   return tileCache.get(tile.file);
  }));
  if(request!==parcelRequest||!$('parcels').checked)return;
  const features=collections.flatMap(c=>c.features).filter(f=>intersects(f.bbox,box));
  layers.parcels.clearLayers();layers.parcels.addData({type:'FeatureCollection',features});raisePoints();
  boundaryStatus('parcels',features.length.toLocaleString()+' lots near this view');
 }catch(error){if(request===parcelRequest)boundaryStatus('parcels','Load failed; pan or toggle to retry. '+error.message);}
}

function raisePoints(){
 if(layers.libraries && map.hasLayer(layers.libraries))layers.libraries.bringToFront();
 if(probe)probe.bringToFront();
}
