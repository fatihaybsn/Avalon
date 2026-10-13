// OpenCode V2 public plugin. Loaded only in the private memory-turn directory.
// Host policy executes before effects; model text is never authorization.
import fs from 'node:fs';
import path from 'node:path';
export default {
  id: 'jarvis.memory-worker-guard',
  async setup(ctx) {
    await ctx.tool.hook('execute.before', () => {
      throw new Error('JARVIS_MEMORY_SCOPE: native worker actions are not authorized for this inference');
    });
    await ctx.permission.hook('evaluate', event => {
      event.effect = 'deny';
      event.message = 'JARVIS_MEMORY_SCOPE: no native effects; results are committed by OpenClaw';
    });
    fs.writeFileSync(path.join(ctx.location.directory, 'guard-ready'), 'jarvis.memory-worker-guard/v1', { flag: 'wx' });
  }
};
