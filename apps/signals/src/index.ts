import { pullAdapters } from './adapters/pull/index.ts';
import { app } from './app.ts';
import { runScheduled } from './cron/run.ts';

export default {
  fetch: app.fetch,
  async scheduled(controller, env) {
    await runScheduled(env, pullAdapters, controller.scheduledTime);
  },
} satisfies ExportedHandler<Env>;
