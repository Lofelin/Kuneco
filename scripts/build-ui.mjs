import {build} from 'esbuild';
import {readFile} from 'node:fs/promises';
await build({entryPoints:['src/ui-components.mjs'],outfile:'src/vendor/ui.js',bundle:true,format:'esm',target:'chrome140',minify:true,legalComments:'eof'});
await build({entryPoints:['src/ui-theme.css'],outfile:'src/vendor/ui.css',bundle:true,minify:true,loader:{'.woff2':'file'},assetNames:'fonts/[name]-[hash]'});

const styleBuild=await build({entryPoints:['src/ui-style.css'],outfile:'src/vendor/ui-overrides.css',loader:{'.svg':'dataurl'},bundle:true,minify:true,logLevel:'warning'});
if(styleBuild.warnings.length)throw new Error('UI CSS parse warnings must be fixed');

// Authorize xterm's dynamic styles without enabling arbitrary inline styles in the shell.
await build({entryPoints:['src/console-ui.mjs'],outfile:'src/vendor/console.js',bundle:true,format:'esm',target:'chrome140',minify:true,plugins:[{
 name:'terminal-style-nonce',setup(build){
  build.onLoad({filter:/xterm[.]m?js$/},async({path})=>({
   contents:(await readFile(path,'utf8')).replace(/(?:[\w$]+\.)+createElement\((["'])style\1\)/g,match=>'Object.assign('+match+',{nonce:"dingtu-terminal-style"})'),loader:'js'
  }));
 }
}]});

await build({entryPoints:['src/chat-markdown.mjs'],outfile:'src/vendor/chat-markdown.js',bundle:true,format:'esm',target:'chrome140',minify:true});
