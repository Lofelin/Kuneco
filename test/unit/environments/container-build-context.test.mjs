import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile, stat} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const root=fileURLToPath(new URL('../../../',import.meta.url));

// The repository intentionally uses a small positive build-context allowlist.
// Check each ancestor as well as the file: an included file inside an excluded
// directory is still unavailable to Docker. Unsupported syntax must be reviewed.
function includedInContext(file,rules){
 const parts=file.split('/');
 return parts.every((_,index)=>{
  const candidate=parts.slice(0,index+1).join('/');
  let included=true;
  for(const rule of rules){
   const include=rule.startsWith('!');
   const pattern=(include?rule.slice(1):rule).replace(/\/$/,'');
   assert.ok(!/[?\[\]\\]|\*\*/.test(pattern),`Review build-context matcher for ${rule}`);
   const subject=pattern.includes('/')?candidate:path.posix.basename(candidate);
   const expression=new RegExp('^'+pattern.split('*').map(piece=>piece.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')).join('[^/]*')+'$');
   if(expression.test(subject))included=include;
  }
  return included;
 });
}

test('every local runtime Dockerfile COPY source is available in the build context',async()=>{
 const dockerfile=await readFile(path.join(root,'docker/runtime/Dockerfile'),'utf8');
 const rules=(await readFile(path.join(root,'.dockerignore'),'utf8')).split('\n').map(line=>line.trim()).filter(line=>line&&!line.startsWith('#'));
 const sources=[];
 for(const line of dockerfile.replace(/\\\n\s*/g,' ').split('\n')){
  if(!/^COPY\s/i.test(line))continue;
  const args=line.trim().split(/\s+/).slice(1);
  assert.ok(!args.some(arg=>arg.startsWith('--')||/[\[\]"$*?]/.test(arg)),`Review COPY source parsing: ${line}`);
  sources.push(...args.slice(0,-1));
 }
 assert.ok(sources.length>0,'runtime image must copy its entrypoints');
 for(const source of sources){
  assert.ok((await stat(path.join(root,source))).isFile(),`${source} must exist`);
  assert.ok(includedInContext(source,rules),`${source} is excluded by .dockerignore`);
 }
 assert.equal(includedInContext('backend/.env',rules),false,'unrelated private files stay excluded');
});
