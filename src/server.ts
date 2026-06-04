import { buildApp } from './app.js';
import { env } from './config/env.js';
import './config/firebase.js';

async function bootstrap() {
  const app = await buildApp();

  try {
    await app.listen({
      port: env.PORT,
      host: env.HOST
    });
  } catch (error) {
    app.log.error(error);
    process.exit(1);
  }
}

bootstrap();
