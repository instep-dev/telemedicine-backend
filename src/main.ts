import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import cookieParser from 'cookie-parser';
import { ValidationPipe } from '@nestjs/common';
import * as express from 'express';

process.on('unhandledRejection', (reason) => {
  console.error('[unhandledRejection]', reason);
});

process.on('uncaughtException', (err) => {
  console.error('[uncaughtException]', err);
});

async function bootstrap() {
  const app = await NestFactory.create(AppModule);

  app.use(cookieParser());

  app.use(express.urlencoded({ extended: true }));
  app.use(express.json());

  const baseDomain = process.env.NEXT_PUBLIC_BASE_DOMAIN ?? 'telemedicine.instep.id';
  app.enableCors({
    origin: (origin, callback) => {
      if (!origin) return callback(null, true);
      const allowed =
        /^https?:\/\/([a-z0-9-]+\.)?localhost(:\d+)?$/.test(origin) ||
        origin === process.env.APP_PUBLIC_BASE_URL ||
        new RegExp(`^https://[a-z0-9-]+\\.${baseDomain.replace('.', '\\.')}$`).test(origin);
      callback(allowed ? null : new Error('CORS: origin not allowed'), allowed);
    },
    credentials: true,
  });

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      transform: true,
      forbidNonWhitelisted: true,
    }),
  );

  await app.listen(process.env.PORT ?? 4000);
}
bootstrap();