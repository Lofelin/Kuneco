// Shared installation, detection and display metadata. Console CLIs are not chat adapters.
export const RUNTIME_CATALOG=Object.freeze({
 cc:{models:[{model:'sonnet',name:'Sonnet'},{model:'opus',name:'Opus'},{model:'haiku',name:'Haiku'}],name:'Claude Code',command:'claude',icon:'claude-code',chat:true,install:'npm install -g @anthropic-ai/claude-code'},
 codex:{models:[{'model': 'gpt-6.1-sol', 'name': 'GPT-6.1-Sol', 'isDefault': true}, {'model': 'gpt-6-astra', 'name': 'GPT-6-Astra', 'isDefault': false}, {'model': 'gpt-6-sol', 'name': 'GPT-6-Sol', 'isDefault': false}, {'model': 'gpt-6-luna', 'name': 'GPT-6-Luna', 'isDefault': false}, {'model': 'gpt-5.6-sol', 'name': 'GPT-5.6-Sol', 'isDefault': false}, {'model': 'gpt-5.6-terra', 'name': 'GPT-5.6-Terra', 'isDefault': false}, {'model': 'gpt-5.6-luna', 'name': 'GPT-5.6-Luna', 'isDefault': false}, {'model': 'gpt-5.5', 'name': 'GPT-5.5', 'isDefault': false}],name:'Codex',command:'codex',icon:'codex',chat:true,install:'npm install -g @openai/codex'},
 deepseek:{name:'DeepSeek',icon:'deepseek',chat:true,models:[{model:'deepseek-flash',name:'DeepSeek-V4.1-Flash'},{model:'deepseek-v4-pro',name:'DeepSeek-V4-Pro'}]},
 kimi:{name:'Kimi',command:'kimi',icon:'kimi',install:'npm install -g @moonshot-ai/kimi-code',usage:'kimi login，然后运行 kimi'},
 qwen:{name:'Qwen',command:'qwen',icon:'qwen',install:'npm install -g @qwen-code/qwen-code@latest',usage:'qwen，在交互界面中使用 /auth 登录'},
 kiro:{name:'Kiro',command:'kiro-cli',icon:'kiro',install:'command -v kiro-cli >/dev/null 2>&1 || curl -fsSL https://cli.kiro.dev/install | bash',usage:'kiro-cli login，然后运行 kiro-cli chat'},
 doubao:{name:'Doubao',command:'ve',icon:'doubao',install:'npx -y @volcengine/skills-setup@latest',usage:'ve --help；使用 ve arkcli 访问火山方舟工具链'}
});
export const CLI_RUNTIMES=Object.entries(RUNTIME_CATALOG).filter(([,item])=>item.command).map(([id])=>id);
export const RUNTIME_INSTALL_COMMANDS=Object.freeze(Object.fromEntries(Object.entries(RUNTIME_CATALOG).filter(([,item])=>item.install).map(([id,item])=>[id,item.install])));
export const runtimeIcon=id=>RUNTIME_CATALOG[id]?.icon || 'monitor';
export const supportsChat=id=>Boolean(RUNTIME_CATALOG[id]?.chat);
