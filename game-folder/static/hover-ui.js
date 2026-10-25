// One viewport-level tooltip avoids clipping and never participates in panel layout.
let tooltip, owner;
export function hideHover(target){
  if(target&&target!==owner)return;
  if(tooltip)tooltip.hidden=true;
  owner=null;
}
export function showHover(target,html,point,variant=''){
  if(!tooltip){tooltip=document.createElement('div');tooltip.id='floating-tooltip';tooltip.setAttribute('role','tooltip');document.body.append(tooltip);}
  owner=target;tooltip.className=`floating-tooltip ${variant}`;tooltip.innerHTML=html;tooltip.hidden=false;
  const gap=12,pad=10,width=tooltip.offsetWidth,height=tooltip.offsetHeight;
  let left=point.clientX+gap,top=point.clientY+gap;
  if(left+width>innerWidth-pad)left=point.clientX-width-gap;
  if(top+height>innerHeight-pad)top=point.clientY-height-gap;
  tooltip.style.left=`${Math.max(pad,Math.min(left,innerWidth-width-pad))}px`;
  tooltip.style.top=`${Math.max(pad,Math.min(top,innerHeight-height-pad))}px`;
}
const showControl=control=>{
  const bounds=control.getBoundingClientRect(),text=document.createElement('span');text.textContent=control.dataset.tooltip;
  showHover(control,text.outerHTML,{clientX:bounds.left,clientY:bounds.bottom},'control-tooltip');
};
document.addEventListener('pointerover',event=>{const control=event.target.closest('[data-tooltip]');if(control&&!control.contains(event.relatedTarget))showControl(control);});
document.addEventListener('pointerout',event=>{const control=event.target.closest('[data-tooltip]');if(control&&!control.contains(event.relatedTarget))hideHover(control);});
document.addEventListener('focusin',event=>{const control=event.target.closest('[data-tooltip]');if(control)showControl(control);});
document.addEventListener('focusout',event=>{const control=event.target.closest('[data-tooltip]');if(control)hideHover(control);});
document.addEventListener('pointerdown',()=>hideHover());
document.addEventListener('keydown',event=>{if(event.key==='Escape')hideHover();});
window.addEventListener('scroll',()=>hideHover(),true);
window.addEventListener('resize',()=>hideHover());
