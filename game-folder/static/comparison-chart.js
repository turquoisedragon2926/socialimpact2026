import {showHover,hideHover} from './hover-ui.js';
// Timeline presentation only; metrics and between-design statistics come from the server.
export function renderComparisonChart(element,{points,key,label,unit,digits,selectedId,year,format,escape,onYear,singleDesign=false}){
  hideHover(element);
  points=[...points].sort((a,b)=>a.year-b.year);
  const designs=points[0].scenes,first=points[0].year,last=points.at(-1).year;
  const finite=Number.isFinite;
  // Use the entire timeline and every design, so selecting a year or design
  // cannot change the scale. Missing statistics must not become numeric zero.
  const all=points.flatMap(p=>{
    if(singleDesign)return p.scenes.map(d=>d.metrics[key]);
    const s=p.distribution[key];
    return [...p.scenes.map(d=>d.metrics[key]),p.reference.metrics[key],s.mean,
      ...(s.n>=2&&finite(s.mean)&&finite(s.stddev)?[s.mean-s.stddev,s.mean+s.stddev]:[])];
  }).filter(finite);
  const isNDVI=key==='simulated_ndvi',signed=['carbon_change_tonnes','carbon_change_pct','productivity_slope','productivity_state_class_change'].includes(key);
  const floor=isNDVI?-1:signed?-Infinity:0,ceiling=isNDVI?1:Infinity;
  const minimum=all.length?Math.max(floor,Math.min(...all)):isNDVI?-1:0;
  const maximum=all.length?Math.min(ceiling,Math.max(...all)):1;
  const minimumPadding=key==='productivity_slope'?.00005:isNDVI||key==='productivity_performance_ratio'?.005:.5;
  const padding=Math.max((maximum-minimum)*.1,minimumPadding);
  const low=Math.max(floor,minimum-padding),high=Math.min(ceiling,maximum+padding);
  const axisDigits=Math.max(digits,Math.min(6,Math.ceil(-Math.log10((high-low)/2))+1));
  const x=v=>44+(v-first)/Math.max(1,last-first)*230,y=v=>120-(v-low)/(high-low)*100;
  const sceneValue=(p,id)=>id===null?p.reference.metrics[key]:p.scenes.find(s=>s.id===id)?.metrics[key];
  const path=read=>{let pen=false;return points.map(p=>{const v=read(p);if(!finite(v)){pen=false;return '';}const command=pen?'L':'M';pen=true;return `${command}${x(p.year)},${y(v)}`;}).join(' ');};
  // Separate polygons prevent a band from bridging missing or single-design samples.
  const runs=[];let run=[];
  for(const p of singleDesign?[]:points){const s=p.distribution[key];if(s.n>=2&&finite(s.mean)&&finite(s.stddev)){run.push(p);}else if(run.length){runs.push(run);run=[];}}
  if(run.length)runs.push(run);
  const band=runs.map(run=>{const edge=sign=>run.map(p=>{const s=p.distribution[key];return `${x(p.year)},${y(Math.max(low,Math.min(high,s.mean+sign*s.stddev)))}`;});return `<polygon points="${[...edge(1),...edge(-1).reverse()].join(' ')}"/>`;}).join('');
  const current=points.find(p=>p.year===year),value=current&&(selectedId===undefined?current.distribution[key].mean:sceneValue(current,selectedId));
  const palette=['#90a586','#a99b85','#8e9ea8','#ab93a0','#98a579'];
  const lines=designs.map((s,i)=>({id:s.id,name:s.name,color:palette[i%palette.length]}));
  lines.sort((a,b)=>Number(a.id===selectedId)-Number(b.id===selectedId));
  const description=singleDesign?'Modeled values by year. Hover for values; select a year to update the map. The axis fits the timeline and may not start at zero.':'Y-axis fits all designs and the reference across the timeline and may not start at zero. Lines: designs. Dashed: mean. Band: ±1 standard deviation between designs, not forecast uncertainty. Dotted: unchanged reference. Select a year to update the map.';
  const areas=[];let areaRun=[];
  if(singleDesign){
    const finish=()=>{if(areaRun.length){areas.push(`${areaRun.map((p,i)=>`${i?'L':'M'}${x(p.year)},${y(sceneValue(p,selectedId))}`).join(' ')} L${x(areaRun.at(-1).year)},120 L${x(areaRun[0].year)},120 Z`);areaRun=[];}};
    for(const point of points){if(finite(sceneValue(point,selectedId)))areaRun.push(point);else finish();}finish();
  }
  element.innerHTML=`<div class="metric-heading"><span>${escape(label)}${unit?` · ${escape(unit.trim())}`:''}</span><span>${format(value,digits)}</span></div>
    <svg class="comparison-timeline" viewBox="0 0 300 158" role="slider" tabindex="0" aria-label="${escape(label)} by simulation year" aria-valuemin="${first}" aria-valuemax="${last}" aria-valuenow="${year}" aria-valuetext="${year}; ${format(value,digits)}${escape(unit)}" aria-description="${escape(description)}">
    ${[low,(low+high)/2,high].map(v=>`<line class="distribution-grid" x1="44" x2="274" y1="${y(v)}" y2="${y(v)}"/><text x="37" y="${y(v)+3}" text-anchor="end">${format(v,axisDigits)}</text>`).join('')}
    ${singleDesign?`<path class="timeline-area" d="${areas.join(' ')}"/>`:`<g class="timeline-band">${band}</g>`}
    ${singleDesign?'':`<path class="timeline-reference${selectedId===null?' active':''}" d="${path(p=>sceneValue(p,null))}"/>`}
    ${lines.map(s=>`<path data-design-line="${escape(s.id)}" class="timeline-design${s.id===selectedId?' active':''}" style="--series-color:${s.color}" d="${path(p=>sceneValue(p,s.id))}"/>`).join('')}
    ${singleDesign?'':`<path class="timeline-mean" d="${path(p=>p.distribution[key].mean)}"/>`}
    <line class="timeline-cursor" x1="${x(year)}" x2="${x(year)}" y1="15" y2="125"/>
    ${points.length===1?designs.map(s=>{const v=sceneValue(points[0],s.id);return finite(v)?`<circle cx="${x(first)}" cy="${y(v)}" r="3" fill="#738779"/>`:'';}).join(''):''}
    ${[...new Set([first,last])].map(v=>`<text x="${x(v)}" y="144" text-anchor="middle">${v}</text>`).join('')}
    <line class="timeline-hover" x1="44" x2="44" y1="15" y2="125" visibility="hidden"/>
    </svg>`;
  const svg=element.querySelector('svg'),hover=element.querySelector('.timeline-hover');
  const nearest=event=>{const bounds=svg.getBoundingClientRect(),v=first+((event.clientX-bounds.left)/bounds.width*300-44)/230*(last-first);return points.reduce((a,b)=>Math.abs(b.year-v)<Math.abs(a.year-v)?b:a);};
  svg.onpointermove=event=>{const p=nearest(event),s=singleDesign?null:p.distribution[key];hover.setAttribute('x1',x(p.year));hover.setAttribute('x2',x(p.year));hover.setAttribute('visibility','visible');
    const content=`<strong>${p.year}</strong>${p.scenes.map(d=>`<div${d.id===selectedId?' class="active"':''}><span>${escape(d.name)}</span><b>${format(d.metrics[key],digits)}${escape(unit)}</b></div>`).join('')}${singleDesign?'':`<div><span>Mean ± std</span><b>${format(s.mean,digits)} ± ${s.n>=2?format(s.stddev,digits):'—'}</b></div><div><span>Reference</span><b>${format(p.reference.metrics[key],digits)}${escape(unit)}</b></div>${s.missing?`<small>${s.missing} designs without values</small>`:''}`}`;showHover(element,content,event,'timeline-tooltip');};
  svg.onpointerleave=()=>{hideHover(element);hover.setAttribute('visibility','hidden');};
  svg.onclick=event=>onYear(nearest(event).year);
  svg.onkeydown=event=>{if(!['ArrowLeft','ArrowRight','Home','End'].includes(event.key))return;event.preventDefault();
    const target=event.key==='Home'?first:event.key==='End'?last:event.key==='ArrowLeft'?[...points].reverse().find(p=>p.year<year)?.year:points.find(p=>p.year>year)?.year;
    if(target!==undefined)onYear(target,true);
  };
}
