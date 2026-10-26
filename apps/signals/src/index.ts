import { app } from './app.ts';

export default {
  fetch: app.fetch,
  async scheduled() {
    // Cron pulls run the registry in adapters/pull once snapshot storage exists.
  },
} satisfies ExportedHandler<Env>;
