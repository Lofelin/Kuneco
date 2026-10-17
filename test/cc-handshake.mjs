import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { query } from '@anthropic-ai/claude-agent-sdk';
import { createRestrictedCCSpawner } from '../src/cc-network-guard.mjs';
import { proxyEnvironment } from '../src/proxy.mjs';

let claude;
try { claude = execFileSync('/usr/bin/which', ['claude'], { encoding: 'utf8' }).trim(); }
catch { console.log('未安装本机 CC，跳过 SDK 初始化测试。'); process.exit(0); }
const directory = await mkdtemp(path.join(tmpdir(), 'fixed-egress-cc-'));
let release; const controller = new AbortController();
const env = proxyEnvironment(process.env, 'http://127.0.0.1:1');
env.CLAUDE_CONFIG_DIR = directory;
env.ANTHROPIC_API_KEY = 'sk-ant-test-not-a-real-key';
const run = query({ prompt: (async function* () { await new Promise(resolve => release = resolve); })(), options: {
  cwd: directory, pathToClaudeCodeExecutable: claude, env, settingSources: [],
  spawnClaudeCodeProcess: createRestrictedCCSpawner({port:1}),
  permissionMode: 'default', abortController: controller,
  tools: ['Read', 'Glob', 'Grep', 'Edit', 'Write', 'WebSearch', 'WebFetch'], mcpServers: {}, strictMcpConfig: true, plugins: [],
  canUseTool: async () => ({ behavior: 'deny', message: '初始化测试不执行工具' }),
} });
let timer;
try {
  const result = await Promise.race([run.initializationResult(), new Promise((_resolve, reject) => { timer = setTimeout(() => reject(new Error('CC SDK 初始化超时')), 15000); })]);
  assert.ok(result && typeof result === 'object');
  console.log('受网络隔离的本机 CC 与 SDK 初始化握手通过。使用临时配置及虚拟凭据，没有发送用户提示或调用模型。');
} finally {
  clearTimeout(timer); run.close(); controller.abort(); release?.();
  await new Promise(resolve => setTimeout(resolve, 250));
  await rm(directory, { recursive: true, force: true });
}
