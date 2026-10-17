import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createLoginLinkDetector,codexBrowserLogin,matchesCodexCallback} from '../../../src/features/terminal/terminal-login-links.mjs';
const url='https://auth.openai.com/oauth/authorize?state=test-state&redirect_uri=http%3A%2F%2Flocalhost%3A1455%2Fauth%2Fcallback&response_type=code';
test('ordinary OAuth login opens once across colored, split terminal output',()=>{
 const links=[],detect=createLoginLinkDetector('codex',(href,login)=>links.push({href,login}));
 detect('\x1b[34m'+url.slice(0,60));detect(url.slice(60)+'\x1b[0m\r\n');detect(url+'\n');
 assert.equal(links.length,1);assert.equal(links[0].href,url);assert.equal(links[0].login.state,'test-state');
});
test('ordinary terminals, device auth, and lookalike URLs do not auto-navigate',()=>{
 const links=[];createLoginLinkDetector(undefined,url=>links.push(url))(url+'\n');
 const detect=createLoginLinkDetector('codex',url=>links.push(url));
 detect('https://auth.openai.com/codex/device\n'+url.replace('auth.openai.com','evil.test')+'\n');assert.deepEqual(links,[]);
});
test('callback must match state, loopback origin, port and path',()=>{
 const login=codexBrowserLogin(url);
 assert.ok(matchesCodexCallback('http://localhost:1455/auth/callback?state=test-state&code=fake',login));
 for(const candidate of ['http://localhost:1455/auth/callback?state=wrong&code=fake','http://evil.test:1455/auth/callback?state=test-state&code=fake','http://localhost:1456/auth/callback?state=test-state&code=fake','http://localhost:1455/other?state=test-state&code=fake'])assert.equal(matchesCodexCallback(candidate,login),false);
 assert.equal(codexBrowserLogin(url.replace('localhost','evil.test')),null);
});
