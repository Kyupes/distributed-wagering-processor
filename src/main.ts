import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module.js';
import { configureHttpApplication } from './http/configure-http-application.js';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  configureHttpApplication(app);
  app.enableShutdownHooks();
  await app.listen(process.env.PORT ?? 3000);
}
await bootstrap();
