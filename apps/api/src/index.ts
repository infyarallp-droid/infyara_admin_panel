import { app } from './app.js';
import { env } from './lib/env.js';

app.listen(env.PORT, () => {
  console.log(`✅ Moksha API listening on ${env.API_PUBLIC_URL}`);
});
