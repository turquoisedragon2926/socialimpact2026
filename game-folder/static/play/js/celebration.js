// One short, non-interactive celebration per challenge attempt.
export function createCelebration(){
  let celebrated=false,layer=null;
  function clear(){
    if(!layer)return;
    layer.getAnimations({subtree:true}).forEach(animation=>animation.cancel());
    layer.remove();layer=null;
  }
  return {
    celebrate(){
      if(celebrated)return;
      celebrated=true;
      const reduced=matchMedia('(prefers-reduced-motion: reduce)').matches;
      const container=document.createElement('div');
      container.className='challenge-confetti';container.setAttribute('aria-hidden','true');
      Object.assign(container.style,{position:'fixed',inset:'0',zIndex:'100',pointerEvents:'none',overflow:'hidden'});
      layer=container;document.body.append(container);
      const colors=['#4f9a6a','#e9bc62','#7fb7c9','#e0876a','#fffdf6','#b29bc6'];
      const animations=[];
      for(let i=0;i<(reduced?35:100);i++){
        const piece=document.createElement('i');
        Object.assign(piece.style,{position:'absolute',left:`${Math.random()*100}%`,top:reduced?`${15+Math.random()*70}%`:'-20px',width:`${5+Math.random()*5}px`,height:`${8+Math.random()*7}px`,background:colors[i%colors.length],borderRadius:i%3?'2px':'50%'});
        container.append(piece);
        const frames=reduced?[{opacity:0},{opacity:1,offset:.2},{opacity:0}]:[
          {transform:'translate3d(0,0,0) rotate(0deg)',opacity:0},
          {opacity:1,offset:.1},{opacity:1,offset:.8},
          {transform:`translate3d(${Math.random()*240-120}px,${innerHeight+60}px,0) rotate(${Math.random()*900-450}deg)`,opacity:0}
        ];
        animations.push(piece.animate(frames,{duration:reduced?1200:2600+Math.random()*1200,delay:reduced?0:Math.random()*350,easing:'linear',fill:'both'}));
      }
      Promise.allSettled(animations.map(a=>a.finished)).then(()=>{container.remove();if(layer===container)layer=null;});
    },
    reset(){clear();celebrated=false;},
    dispose:clear,
  };
}
