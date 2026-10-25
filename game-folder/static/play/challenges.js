// Challenge goals compare the existing model's outputs, never predict outcomes.
export const CHALLENGES = [
  {id:'geoffrey',name:'Geoffrey',species:'Giraffe',title:'Grow a forest',
    description:'Expand tree cover and increase modeled soil carbon.',
    cover:10,goals:['Expand tree cover','Increase soil carbon']},
  {id:'paul',name:'Paul',species:'Polar bear',title:'Build with care',
    description:'Add buildings without increasing declining land.',
    cover:50,goals:['Add built-up area','No additional declining land']},
  {id:'lionel',name:'Lionel',species:'Lion',title:'Replan the city',
    description:'Change land cover while keeping green space and avoiding degradation.',
    cover:null,goals:['Change at least two cells','Keep green area','No additional declining land']},
];
const GREEN = ['trees','grass','crops','wetland'];
const close = (a,b) => Math.abs(a-b) < 1e-8;
export function assessChallenge(id, current, reference, map) {
  const original = new Map(reference.cells.map(c=>[c.id,c]));
  const refs = new Map(reference.cells.map(c=>[c.id,c]));
  const areas = new Map(map.ids.map((id,i)=>[id,map.areaHa[i]]));
  const soil = new Map(map.ids.map((id,i)=>[id,map.soilCoverage[i]]));
  const changed = current.cells.filter(c=>Object.keys({...c.fractions,...original.get(c.id)?.fractions})
    .some(k=>!close(c.fractions[k]||0,original.get(c.id)?.fractions[k]||0)));
  let carbon=0,decline=0,carbonKnown=true,landKnown=true;
  for(const c of changed){
    const r=refs.get(c.id),area=areas.get(c.id)||0,coverage=soil.get(c.id)||0;
    if(c.soc==null||r?.soc==null||coverage<=0)carbonKnown=false;
    else carbon+=(c.soc-r.soc)*area*coverage;
    if(!c.degradation||!r?.degradation||c.degradation.fractions.unknown>1e-8||r.degradation.fractions.unknown>1e-8)landKnown=false;
    if(c.degradation&&r?.degradation)decline+=(c.degradation.fractions.declining-r.degradation.fractions.declining)*area;
  }
  const areaDelta = k=>(current.metrics.cover_ha[k]||0)-(reference.metrics.cover_ha[k]||0);
  const green=GREEN.reduce((sum,k)=>sum+areaDelta(k),0);
  const expanded=areaDelta('trees'),built=areaDelta('built');
  const goals=id==='geoffrey' ? [expanded>1e-8,carbonKnown?carbon>1e-8:null]
    :id==='paul' ? [built>1e-8,landKnown?decline<=1e-8:null]
    :[changed.length>=2,green>=-1e-8,landKnown?decline<=1e-8:null];
  return {goals,changed:changed.length,carbon:carbonKnown?carbon:null,decline:landKnown?decline:null,
    green,expanded,built,won:goals.every(v=>v===true)};
}
