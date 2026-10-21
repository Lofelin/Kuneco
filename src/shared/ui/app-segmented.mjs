/** Shared segmented single choice. Web Awesome owns value, focus and keyboard behavior. */
export function createAppSegmentedOption(doc,{value,label,icon}){
 const option=doc.createElement('wa-radio');option.value=String(value);option.appearance='button';
 const image=doc.createElement('wa-icon');image.src='assets/icons/'+icon+'.svg';image.setAttribute('aria-hidden','true');
 option.append(image,doc.createTextNode(label));return option;
}
export function createAppSegmented(doc,options){
 const control=doc.createElement('wa-radio-group');control.className='app-segmented';control.orientation='horizontal';control.size='s';
 for(const [value,label,icon] of options)control.append(createAppSegmentedOption(doc,{value,label,icon}));
 return control;
}
