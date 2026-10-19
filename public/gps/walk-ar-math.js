/* Route coordinates are [latitude, longitude]. World coordinates: east=x, north=-z. */
(() => {
  'use strict';
  const rad=Math.PI/180;
  const local=(p,o)=>({x:(p[1]-o[1])*111195*Math.cos(o[0]*rad),z:-(p[0]-o[0])*111195});
  function nearest(points,origin){
    let best=null;
    for(let i=1;i<points.length;i++){
      const a=local(points[i-1],origin),b=local(points[i],origin),dx=b.x-a.x,dz=b.z-a.z,l2=dx*dx+dz*dz;
      if(l2<.01)continue;
      const t=Math.max(0,Math.min(1,-(a.x*dx+a.z*dz)/l2)),x=a.x+t*dx,z=a.z+t*dz,distance=Math.hypot(x,z);
      if(!best||distance<best.distance)best={index:i,x,z,distance,bearing:Math.atan2(dx,-dz)};
    }
    return best;
  }
  function forward(points,origin,max=60){
    const start=nearest(points,origin);if(!start)return null;
    const path=[{x:start.x,z:start.z}];let left=max;
    for(let i=start.index;i<points.length&&left>0;i++){
      const p=local(points[i],origin),a=path[path.length-1],d=Math.hypot(p.x-a.x,p.z-a.z);
      if(d<.05)continue;
      if(d>left){path.push({x:a.x+(p.x-a.x)*left/d,z:a.z+(p.z-a.z)*left/d});break;}
      path.push(p);left-=d;
    }
    return {...start,path};
  }
  function world(p,angle,anchor){const c=Math.cos(angle),s=Math.sin(angle);return {x:anchor.x+p.x*c+p.z*s,y:anchor.y,z:anchor.z-p.x*s+p.z*c};}
  const api={local,nearest,forward,world};
  if(typeof module!=='undefined')module.exports=api;else window.WalkARMath=api;
})();
