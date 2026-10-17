FROM dingtu-runtime:1
RUN npm uninstall -g --ignore-scripts --no-audit --no-fund @anthropic-ai/claude-code @openai/codex && chown -R node:node /home/node
COPY docker/runtime/worker.sh /opt/dingtu/worker.sh
RUN chmod 755 /opt/dingtu/worker.sh
