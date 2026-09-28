import { ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module.js';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  // Global ValidationPipe: class-validator decorators on DTOs are only
  // enforced when this pipe is registered. `whitelist:true` strips
  // unknown fields; `forbidNonWhitelisted:true` rejects unknown fields
  // outright. `transform:true` enables @Body() DTO instantiation.
  // PR #4 will refine the error shape (envelope with `details[]`); the
  // pipe itself is identical.
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
      transformOptions: { enableImplicitConversion: true },
    }),
  );
  await app.listen(process.env.PORT ?? 3000);
}
await bootstrap();
