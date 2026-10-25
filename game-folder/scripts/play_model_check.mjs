// These are model-output fixtures: challenge scoring may not invent assessments.
import assert from 'node:assert/strict';
import {assessChallenge} from '../static/play/challenges.js';
import {tileValues} from '../static/play/js/connection.js';
const cell=(id,cover,status,soc=10)=>({id,cover,fractions:{[cover]:1},soc,degradation:{status,fractions:{stable:status==='stable'?1:0,declining:status==='declining'?1:0,improving:status==='improving'?1:0,unknown:status==='unknown'?1:0}}});
const result=cells=>({cells,metrics:{cover_ha:cells.reduce((a,c)=>(a[c.cover]=(a[c.cover]||0)+1,a),{})}});
const map={ids:['a','b'],areaHa:[1,1],soilCoverage:[1,1]};
const start=result([cell('a','bare','stable'),cell('b','grass','stable')]);
const restored=result([cell('a','trees','improving',20),cell('b','grass','stable')]);
assert.equal(assessChallenge('geoffrey',restored,start,map).won,true);
assert.equal(assessChallenge('geoffrey',restored,start,map).carbon,10);
const missing=result([cell('a','trees','unknown',null),cell('b','grass','stable')]);
assert.equal(assessChallenge('geoffrey',missing,start,map).won,false);
assert.equal(assessChallenge('geoffrey',missing,start,map).goals[1],null);
const built=result([cell('a','built','declining'),cell('b','grass','stable')]);
assert.equal(assessChallenge('paul',built,start,map).won,false);
const safe=result([cell('a','built','stable'),cell('b','grass','stable')]);
assert.equal(assessChallenge('paul',safe,start,map).won,true);
const incomplete=result([cell('a','built','unknown'),cell('b','grass','stable')]);
assert.equal(assessChallenge('paul',incomplete,start,map).goals[1],null);
const balanced=result([cell('a','grass','stable'),cell('b','trees','improving')]);
assert.equal(assessChallenge('lionel',balanced,start,map).won,true);
assert.equal(assessChallenge('lionel',start,start,map).won,false);
assert.equal(tileValues(missing,map)[0],2);
// Land health displays performance, independently of combined degradation.
const performance=[0,.5,1,1.25,1.5,2,null,NaN].map((ratio,i)=>({
  id:String(i),degradation:{status:'unknown',productivity:{performance_ratio:ratio}}
}));
const displayed=Array.from(tileValues({cells:performance},{ids:performance.map(c=>c.id)}));
assert.deepEqual(displayed.map(v=>v===0?0:v),[1,.5,0,-.5,-1,-1,2,2]);
console.log('Challenge scoring and productivity performance display checks passed.');
