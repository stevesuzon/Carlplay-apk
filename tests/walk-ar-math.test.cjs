const assert=require('node:assert/strict');
const math=require('../public/gps/walk-ar-math.js');
const route=[[48,2],[48.0002,2],[48.0002,2.0003]];
const section=math.forward(route,[48,2],60);assert(section.path.length===3);assert(section.path[1].z<0);assert(section.path[2].x>0);
const east=math.world({x:1,z:0},Math.PI/2,{x:0,y:0,z:0});assert(Math.abs(east.x)<1e-9&&Math.abs(east.z+1)<1e-9);
assert.equal(math.forward([[48,2],[48,2]],[48,2]),null);
assert(Math.abs(math.forward([[48,2],[49,2]],[48,2],60).path[1].z+60)<1e-6);
console.log('Walk AR geometry tests passed');
