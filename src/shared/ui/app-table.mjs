/** Global data table. Callers provide columns/cell content, never row geometry or events. */
export function renderAppTable(host,{columns,rows=[],label='数据表格',minWidth=0,onActivate,rowLabel,actions,empty='暂无数据'}={}){
 const doc=host.ownerDocument;host.classList.add('app-table');host.setAttribute('aria-label',label);
 const table=doc.createElement('table');table.setAttribute('aria-label',label);table.style.minWidth=minWidth+'px';
 const colgroup=doc.createElement('colgroup'),head=doc.createElement('thead'),heading=doc.createElement('tr'),body=doc.createElement('tbody');
 for(const column of columns){const col=doc.createElement('col');if(column.width)col.style.width=column.width;colgroup.append(col);const th=doc.createElement('th');th.scope='col';th.textContent=column.label;heading.append(th);}
 if(actions){const col=doc.createElement('col');col.style.width='48px';colgroup.append(col);const th=doc.createElement('th');th.scope='col';th.setAttribute('aria-label','操作');heading.append(th);}
 head.append(heading);
 for(const [index,item] of rows.entries()){
  const row=doc.createElement('tr');
  for(const column of columns){const cell=doc.createElement('td');cell.dataset.column=column.key;const value=column.render?column.render(item,index):item[column.key];if(value?.nodeType)cell.append(value);else cell.textContent=value==null?'—':String(value);row.append(cell);}
  if(actions){const cell=doc.createElement('td');cell.className='app-table-actions';const action=actions(item,index);if(action)cell.append(action);cell.addEventListener('click',event=>event.stopPropagation());cell.addEventListener('keydown',event=>event.stopPropagation());row.append(cell);}
  if(onActivate){row.tabIndex=0;row.classList.add('app-table-clickable');row.setAttribute('aria-label',rowLabel?.(item) || '查看详情');const activate=()=>onActivate(item,index);row.addEventListener('click',event=>{if(event.composedPath().some(node=>node!==row && node.matches?.('a,app-button,wa-dropdown,wa-input,wa-select')))return;activate();});row.addEventListener('keydown',event=>{if(event.target===row && ['Enter',' '].includes(event.key)){event.preventDefault();activate();}});}
  body.append(row);
 }
 if(!rows.length){const row=doc.createElement('tr'),cell=doc.createElement('td');cell.colSpan=columns.length+Number(Boolean(actions));cell.className='app-table-empty';cell.textContent=empty;row.append(cell);body.append(row);}
 table.append(colgroup,head,body);host.replaceChildren(table);return host;
}
/** Sanitized Markdown keeps native table semantics and uses the same global shell. */
export function adoptAppTables(root){
 for(const table of root.querySelectorAll('table')){if(table.parentElement?.localName==='app-table')continue;const host=root.ownerDocument.createElement('app-table');host.className='app-table';host.setAttribute('aria-label',table.getAttribute('aria-label') || '内容表格');table.before(host);host.append(table);for(const th of table.querySelectorAll('thead th'))th.scope='col';for(const cell of table.querySelectorAll('[align]')){const align=cell.getAttribute('align');if(['left','center','right'].includes(align))cell.style.textAlign=align;}}
}

if(globalThis.customElements && globalThis.HTMLElement && !customElements.get('app-table')){
 customElements.define('app-table',class AppTable extends HTMLElement{});
}
