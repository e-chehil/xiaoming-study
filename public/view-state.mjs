// Preserve transient UI state when the same page is redrawn (for example, a theme change).
function focusPath(element,root){
  if(!element||element===root||!root.contains(element))return null;
  if(element.id)return '#'+CSS.escape(element.id);
  const path=[];
  while(element&&element!==root){
    path.unshift(`:nth-child(${[...element.parentElement.children].indexOf(element)+1})`);
    element=element.parentElement;
  }
  return ':scope > '+path.join(' > ');
}
export function captureViewState(root){
  const active=document.activeElement;
  return {
    focus:focusPath(active,root),
    selection:active instanceof HTMLInputElement&&active.selectionStart!==null?[active.selectionStart,active.selectionEnd]:null,
    fields:[...root.querySelectorAll('form input:not([type="file"]),form select,form textarea')].map(node=>({path:focusPath(node,root),value:node.value,checked:node.checked})),
    disclosures:[...root.querySelectorAll('details')].map(node=>node.open),
    scroll:[scrollX,scrollY],
  };
}
export function restoreViewState(root,state){
  if(!state)return;
  root.querySelectorAll('details').forEach((node,i)=>{if(i<state.disclosures.length)node.open=state.disclosures[i];});
  for(const field of state.fields){
    const node=root.querySelector(field.path);
    if(node){node.value=field.value;if(typeof field.checked==='boolean')node.checked=field.checked;}
  }
  const focus=state.focus&&root.querySelector(state.focus);
  if(focus){
    focus.focus({preventScroll:true});
    if(state.selection&&focus instanceof HTMLInputElement)focus.setSelectionRange(...state.selection);
  }
  window.scrollTo(...state.scroll);
}
export function trapDialogTab(event,dialog){
  if(event.key!=='Tab'||!dialog)return;
  const nodes=[...dialog.querySelectorAll('a[href],button,input,select,textarea,summary,[tabindex]')]
    .filter(node=>!node.disabled&&node.tabIndex>=0&&node.getClientRects().length&&!node.closest('[inert]'));
  const position=nodes.indexOf(document.activeElement);
  if(!nodes.length){event.preventDefault();dialog.focus();}
  else if(event.shiftKey&&position<=0){event.preventDefault();nodes.at(-1).focus();}
  else if(!event.shiftKey&&(position<0||position===nodes.length-1)){event.preventDefault();nodes[0].focus();}
}
