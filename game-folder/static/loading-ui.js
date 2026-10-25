// Shared presentation for route loads, local work and retryable failures.
const escapeText=value=>String(value).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
export function loadingState(label,{id='',compact=false}={}){
  return `<div class="loading-state${compact?' compact':''}" role="status" aria-live="polite"><span class="loading-spinner" aria-hidden="true"></span><span${id?` id="${escapeText(id)}"`:''}>${escapeText(label)}</span></div>`;
}
export function errorState(message,retryId,{compact=false}={}){
  return `<div class="loading-error${compact?' compact':''}"><p role="alert">${escapeText(message)}</p><button id="${escapeText(retryId)}" class="small">Try again</button></div>`;
}
