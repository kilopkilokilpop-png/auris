import { createApi, loadEnv } from './server.js';

const env = loadEnv();
const api = await createApi(env);
await api.app.listen({ port: env.API_PORT, host: env.API_HOST });
api.afterListen();

const stop = async () => {
  await api.close();
  process.exit(0);
};
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
