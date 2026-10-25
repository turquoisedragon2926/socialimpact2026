// The same revision-checked scene APIs used by the 2D application.
export const COVERS={10:'trees',30:'grass',40:'crops',90:'wetland',50:'built',60:'bare',80:'water'};
export const CODES=Object.fromEntries(Object.entries(COVERS).map(([k,v])=>[v,Number(k)]));
export async function api(path,{method='GET',body}={}){
  const response=await fetch(`/api${path}`,{method,credentials:'same-origin',headers:body?{'Content-Type':'application/json'}:{},body:body?JSON.stringify(body):undefined});
  const data=await response.json();
  if(!response.ok)throw new Error(typeof data.detail==='string'?data.detail:'The design could not be loaded or saved.');
  return data;
}
export async function connect(sceneId,year){
  const path=`/scenes/${encodeURIComponent(sceneId)}`;
  const boot=await api(`${path}/play-map${year?`?year=${year}`:''}`);
  let revision=boot.scene.revision,currentYear=boot.year,result=boot.result,latest=boot.latest_edit_year;
  const targetYear=Math.max(boot.year,boot.latest_edit_year)+30;
  // Capture the unedited plan at the same future year before enabling paint.
  const reference=await api(`${path}/evaluate?year=${targetYear}`);
  const scene=await api(path);
  if(scene.revision!==revision)throw new Error('This design changed while loading. Reload Play mode.');
  let savedCodes=boot.map.codes.slice();
  const entryActions=scene.actions.map(a=>a.id);
  async function mutate(suffix,body,method='POST'){
    const saved=await api(path+suffix,{method,body:{revision,...body}});
    revision=saved.revision;
    return saved;
  }
  async function evaluate(){
    result=await api(`${path}/evaluate?year=${currentYear}`);
    const cells=new Map(result.cells.map(c=>[c.id,c]));
    savedCodes=boot.map.ids.map(id=>CODES[cells.get(id)?.cover]||0);
    return result;
  }
  return {
    ...boot,reference,targetYear,
    get year(){return currentYear;},get revision(){return revision;},get result(){return result;},
    get canEdit(){return currentYear>=latest;},get latestYear(){return latest;},
    async save(codes){
      if(currentYear<latest)throw new Error(`This design has edits through ${latest}. Continue to that year to edit the same design.`);
      const groups=new Map();
      codes.forEach((code,i)=>{
        if(!boot.map.ids[i]||code===savedCodes[i])return;
        if(!COVERS[code])throw new Error('Unsupported land cover.');
        if(!groups.has(code))groups.set(code,[]);
        groups.get(code).push(i);
      });
      for(const [code,indices] of groups){
        await mutate('/actions',{cell_ids:indices.map(i=>boot.map.ids[i]),cover:COVERS[code],year:currentYear,note:'Play mode'});
        indices.forEach(i=>{savedCodes[i]=code;});
        latest=Math.max(latest,currentYear);
      }
      return evaluate();
    },
    async reset(){
      await mutate('/play-reset',{action_ids:entryActions,year:boot.year});
      currentYear=boot.year;latest=boot.latest_edit_year;
      return evaluate();
    },
    async advance(year){
      if(!Number.isInteger(year)||year<boot.baseline_year)throw new Error('Choose a valid simulation year.');
      await mutate('',{selected_year:year},'PATCH');currentYear=year;
      const next=await evaluate();
      const cells=new Map(next.cells.map(c=>[c.id,c]));
      savedCodes=boot.map.ids.map(id=>CODES[cells.get(id)?.cover]||0);
      return next;
    },
    async persistYear(){
      const latestScene=await api(path);
      if(latestScene.revision!==revision)throw new Error('This design changed elsewhere. Reload before continuing.');
      if(latestScene.selected_year!==currentYear)await mutate('',{selected_year:currentYear},'PATCH');
    },
  };
}
export function tileValues(result,map){
  const index=new Map(result.cells.map(c=>[c.id,c]));
  return Float32Array.from(map.ids,id=>{
    const ratio=index.get(id)?.degradation?.productivity?.performance_ratio;
    if(!Number.isFinite(ratio))return 2;
    // Display only: match the map's 0 → 1× → 1.5+ performance scale.
    // The renderer uses positive values for purple and negative for green.
    return ratio<1?Math.min(1,1-ratio):-Math.min(1,(ratio-1)/.5);
  });
}
