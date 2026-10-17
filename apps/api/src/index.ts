import { app } from './app.js';
import { env } from './lib/env.js';
import { startInternalScheduler } from './jobs/tick.js';

app.listen(env.PORT, () => {
  console.log(`✅ Moksha API listening on ${env.API_PUBLIC_URL}`);
  if (env.INTERNAL_SCHEDULER_SECONDS > 0) startInternalScheduler(env.INTERNAL_SCHEDULER_SECONDS);
});
