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

  // Trust reverse-proxy headers (Railway, Render, etc.) so req.ip is the real client IP.
  // Without this, all requests appear to come from the proxy's IP and rate limiting breaks.
  app.getHttpAdapter().getInstance().set("trust proxy", 1);

  app.use(cookieParser());

  app.use(express.urlencoded({ extended: true }));
  app.use(express.json({ limit: "2mb" }));

  // Security headers — applied to all responses
  app.use((_req: any, res: any, next: any) => {
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("X-Frame-Options", "DENY");
    // Disable legacy XSS filter — modern browsers use CSP instead
    res.setHeader("X-XSS-Protection", "0");
    res.setHeader("Strict-Transport-Security", "max-age=31536000; includeSubDomains");
    res.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
    next();
  });

  const isProd = process.env.NODE_ENV === "production";
  const baseDomain = process.env.NEXT_PUBLIC_BASE_DOMAIN ?? "telemedicine.instep.id";
  // Escape ALL dots in the domain (String.replace replaces only the first occurrence)
  const escapedDomain = baseDomain.replace(/\./g, "\\.");

  app.enableCors({
    origin: (origin, callback) => {
      if (!origin) return callback(null, true);
      const isLocalhost = /^https?:\/\/([a-z0-9-]+\.)?localhost(:\d+)?$/.test(origin);
      const isMainDomain = origin === process.env.APP_PUBLIC_BASE_URL;
      const isTenantSubdomain = new RegExp(
        `^https://[a-z0-9-]+\\.${escapedDomain}$`,
      ).test(origin);
      // In production: never allow localhost origins
      const allowed = (isProd ? false : isLocalhost) || isMainDomain || isTenantSubdomain;
      callback(allowed ? null : new Error("CORS: origin not allowed"), allowed);
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