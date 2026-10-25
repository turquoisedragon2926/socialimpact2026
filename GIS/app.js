'use strict';
const $ = id => document.getElementById(id);
const escapeHTML = value => String(value ?? 'Not provided').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const vectorRenderer=L.canvas({padding:.2});
const map = L.map('map', {zoomControl: false, minZoom:10, maxZoom:18, zoomSnap:.25, zoomDelta:.5}).setView([37.762, -122.443], 12);
L.control.zoom({position:'bottomright'}).addTo(map);
L.control.scale({position:'bottomright',imperial:false}).addTo(map);
map.attributionControl.addAttribution('DataSF · USGS 3DEP | Local snapshots');
map.createPane('terrainPane');map.getPane('terrainPane').style.zIndex=220;
map.createPane('neighborhoodPane');map.getPane('neighborhoodPane').style.zIndex=400;
map.createPane('parkPane');map.getPane('parkPane').style.zIndex=410;
map.createPane('facilityPane');map.getPane('facilityPane').style.zIndex=490;
let data, layers={}, sampling=false, selected=null, probe=null;
const home = [[37.705,-122.525],[37.815,-122.352]];
const fields = pairs => '<dl>'+pairs.map(([label,value])=>`<dt>${escapeHTML(label)}</dt><dd>${escapeHTML(value)}</dd>`).join('')+'</dl>';
function showRecord(feature, kind, layer) {
  if (sampling) return;
  if(selected) selected.setStyle({color:selected._normalStyle.color,weight:selected._normalStyle.weight});
  selected=layer; layer.setStyle({color:'#bd7137',weight:3});
  const p=feature.properties;
  const name=BOUNDARY_KEYS.includes(kind)?boundaryName(feature,kind):(p.nhood || p.property_name || p.common_name || 'Unnamed feature');
  $('inspect-title').textContent=name;
  $('inspect-description').textContent=boundaryDescriptions[kind] || {neighborhoods:'A polygon groups a place into an area for reporting. Its boundary is a sequence of coordinates.',parks:'This polygon describes the footprint of an RPD property. Its attributes tell us what that land is used for.',libraries:'A point locates a library facility. Its coordinates tell us where; its attributes tell us what. This dataset also includes leased and support facilities.'}[kind];
  let pairs = kind==='neighborhoods' ? [['Neighborhood',p.nhood],['Meaning','Analysis / reporting area']] : kind==='parks' ? [['Property type',p.propertytype],['Address',p.address],['Reported area',p.acres ? Number(p.acres).toFixed(2)+' acres' : null],['Owner',p.ownership]] : [['Facility',p.common_name],['Address',p.address],['Tenure',p.owned_leased],['City tenants',p.city_tenants]];
  if(BOUNDARY_KEYS.includes(kind))pairs=boundaryPairs(feature,kind);
  const geometry=feature.geometry;
  const coordinateCount = g => typeof g[0] === 'number' ? 1 : g.reduce((sum,v)=>sum+coordinateCount(v),0);
  pairs.push(['Geometry',geometry.type],['Coordinate pairs',coordinateCount(geometry.coordinates).toLocaleString()]);
  if(kind==='libraries') pairs.push(['Longitude, latitude',geometry.coordinates.map(v=>v.toFixed(6)).join(', ')],['Transformation','Point constructed from source longitude / latitude fields']);
  const example={type:'Feature',geometry:geometry.type==='Point'?geometry:{type:geometry.type,coordinates:'Open the source file for the full boundary.'},properties:p};
  const source=boundaryManifest?.sources[kind];
  $('inspect-body').innerHTML=`<span class="badge">VECTOR / ${kind==='libraries'?'POINT':'POLYGON'}</span>${fields(pairs)}<details class="raw"><summary>See the underlying record</summary><pre>${escapeHTML(JSON.stringify(example,null,2))}</pre></details><a class="file-link" href="data/${source?.file || kind+'.geojson'}" download>Download ${kind} GeoJSON${kind==='parcels'?' (.gz)':''} ↗</a>`;
}
function bindFeature(kind,feature,layer,style){
 layer._normalStyle=style;
 layer.bindTooltip(escapeHTML(BOUNDARY_KEYS.includes(kind)?boundaryName(feature,kind):(feature.properties.nhood || feature.properties.property_name || feature.properties.common_name || 'Facility')),{sticky:true});
 layer.on('click',e=>{if(sampling){sampleAt(e.latlng);return;}showRecord(feature,kind,layer);});
}
function setSampling(value){
 sampling=value;
 $('sample').setAttribute('aria-pressed',String(sampling));
 $('sample').textContent=sampling?'⌖ Sampling on':'⌖ Sample terrain';
 $('map').classList.toggle('sample-mode',sampling);
 if(sampling && !map.hasLayer(layers.terrain)){$('terrain').checked=true;syncLayers();}
}
function sampleAt(latlng){
 const e=data.elevation;
 const pt=L.CRS.EPSG3857.project(latlng);
 const [west,south,east,north]=e.bounds3857;
 const col=Math.floor((pt.x-west)/(east-west)*e.width), row=Math.floor((north-pt.y)/(north-south)*e.height);
 const value=col>=0&&row>=0&&col<e.width&&row<e.height ? e.values[row*e.width+col] : null;
 if(probe)map.removeLayer(probe);
 probe=L.circleMarker(latlng,{renderer:vectorRenderer,radius:7,color:'#233c35',weight:2,fillColor:'#fff',fillOpacity:1,interactive:false}).addTo(map);
 $('inspect-title').textContent='One cell of terrain.';
 $('inspect-description').textContent='A raster is a matrix of numbers. Each cell here stores ground elevation in meters, rather than the color of a photograph.';
 $('inspect-body').innerHTML=`<span class="badge">RASTER / ELEVATION</span><div class="big-value">${value==null?'—':value.toFixed(1)} <small>${value==null?'no sample':'m'}</small></div>${fields([['Latitude',latlng.lat.toFixed(6)],['Longitude',latlng.lng.toFixed(6)],['Grid cell',value==null?'Outside the displayed data':`column ${col}, row ${row} (zero-based)`],['Grid size',`${e.width} × ${e.height} cells`],['Approximate ground spacing','21 m in this export'],['Value','Bilinearly resampled elevation; displayed to 0.1 m, not a statement of accuracy']])}<p style="font-size:11px">${value==null?'Choose a location within the San Francisco analysis areas.':'Elevation alone does not establish flood risk. This is a resampled terrain snapshot, not a flood model.'}</p><a class="file-link" href="data/elevation.tif" download>Download original elevation GeoTIFF ↗</a>`;
}
function syncLayers(){
 for(const [key,layer] of Object.entries(layers)){
  if($(key).checked) {if(!map.hasLayer(layer))map.addLayer(layer);}else if(map.hasLayer(layer))map.removeLayer(layer);
 }
 $('legend').hidden=!$('terrain').checked;
 layers.neighborhoods.setStyle({fillOpacity:$('terrain').checked?.025:.23});
 if(!$('terrain').checked && sampling)setSampling(false);
 refreshBoundaries();
 raisePoints();
}
const lessons={areas:['Shapes carry information.','Click a neighborhood boundary or park. These are polygons: closed outlines with data attached. Zoom in to see how detailed a boundary can be.'],terrain:['A picture made of numbers.','Click anywhere in the colored terrain. Each cell stores a height in meters. The colors are a visual encoding of those numbers; they are not satellite imagery.'],together:['Stack the layers.','Click a green park, a blue facility dot, or a neighborhood. Every shape has a record behind it. Then turn on “Sample terrain” to inspect individual elevation cells.']};
async function init(){
 try{
  data=await localJSON('explorer.json');
  $('neighborhood-count').textContent=data.neighborhoods.features.length;
  $('park-count').textContent=data.parks.features.length;
  $('library-count').textContent=data.libraries.features.length;
  layers.terrain=L.imageOverlay('data/elevation.png',data.elevation.bounds,{opacity:.85,pane:'terrainPane',interactive:false});
  const ns={color:'#667c6a',weight:1,fillColor:'#d6dfce',fillOpacity:.025};
  layers.neighborhoods=L.geoJSON(data.neighborhoods,{pane:'neighborhoodPane',renderer:vectorRenderer,style:ns,onEachFeature:(f,l)=>bindFeature('neighborhoods',f,l,ns)});
  const ps={color:'#2f7954',weight:1.2,fillColor:'#5d9e60',fillOpacity:.50};
  layers.parks=L.geoJSON(data.parks,{pane:'parkPane',renderer:vectorRenderer,style:ps,onEachFeature:(f,l)=>bindFeature('parks',f,l,ps)});
  const ls={pane:'facilityPane',renderer:vectorRenderer,radius:4.5,color:'#fff',weight:1.5,fillColor:'#426db0',fillOpacity:1};
  layers.libraries=L.geoJSON(data.libraries,{pointToLayer:(f,ll)=>L.circleMarker(ll,ls),onEachFeature:(f,l)=>bindFeature('libraries',f,l,ls)});
  await initBoundaries();
  syncLayers();map.fitBounds(home,{padding:[20,20]});
  for(const key of Object.keys(layers))$(key).addEventListener('change',()=>{syncLayers();document.querySelectorAll('[data-view]').forEach(b=>b.classList.remove('active'));});
  $('opacity').addEventListener('input',e=>{layers.terrain.setOpacity(e.target.value/100);$('opacity-value').textContent=e.target.value+'%';});
  $('sample').addEventListener('click',()=>setSampling(!sampling));
  $('reset').addEventListener('click',()=>map.fitBounds(home,{padding:[20,20]}));
  document.querySelectorAll('[data-view]').forEach(button=>button.addEventListener('click',()=>{
   const mode=button.dataset.view;
   for(const key of BOUNDARY_KEYS)$(key).checked=false;
   $('terrain').checked=mode!=='areas';$('neighborhoods').checked=mode!=='terrain';$('parks').checked=mode!=='terrain';$('libraries').checked=mode==='together';
   syncLayers();setSampling(mode==='terrain');
   document.querySelectorAll('[data-view]').forEach(b=>b.classList.toggle('active',b===button));
   $('lesson-title').textContent=lessons[mode][0];$('lesson-text').textContent=lessons[mode][1];
  }));
  map.on('mousemove',e=>{$('cursor').textContent=`${e.latlng.lat.toFixed(5)}° N, ${Math.abs(e.latlng.lng).toFixed(5)}° W`;});
  map.on('click',e=>{if(sampling)sampleAt(e.latlng);});
  $('loading').remove();
 }catch(error){showBoundaryFailure('Map initialization failed. Reload to retry. '+error.message);$('loading').textContent='Could not load the data. Start the local server using the command in GIS/README.md. '+error.message;console.error(error);}
}
init();
