import { spawn } from 'node:child_process';
export function ccSandboxProfile(port) {
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('Invalid local proxy port');
  return `(version 1)
(allow default)
(deny network*)
(deny mach-lookup (global-name-regex #"^com\\.apple\\.mDNSResponder"))
(allow network-outbound (remote tcp "localhost:${port}"))`;
}
export function createRestrictedCCSpawner({port,canStart=()=>true,platform=process.platform}) {
  if (platform !== 'darwin') throw new Error('CC network isolation is unavailable on this platform');
  const profile = ccSandboxProfile(port);
  return ({command,args,cwd,env,signal}) => {
    if (!canStart()) throw new Error('CC environment or proxy is unavailable');
    // No fallback: descendants inherit Seatbelt. Only TCP to the local gateway
    // is permitted; DNS, UDP and all other network destinations are denied.
    const child = spawn('/usr/bin/sandbox-exec',['-p',profile,command,...args],{cwd,env,signal,stdio:['pipe','pipe','pipe']});
    child.stderr.on('data',()=>{});
    return child;
  };
}
