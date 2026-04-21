// Load .env BEFORE any other import that might read process.env
// (auth.config, crypto.util, ...). dotenv is a transitive dependency of
// @nestjs/config which is already installed.
// eslint-disable-next-line @typescript-eslint/no-require-imports
require('dotenv').config();

import { NestFactory } from '@nestjs/core';
import { NestExpressApplication } from '@nestjs/platform-express';
import { ValidationPipe } from '@nestjs/common';
import { json, urlencoded } from 'express';
import helmet from 'helmet';
import cookieParser from 'cookie-parser';
import { AppModule } from './app.module';
import { getCorsOrigins, IS_PROD } from './auth/auth.config';

async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule);

  // Trust the reverse proxy (single hop) so req.ip reflects X-Forwarded-For
  // without opening us up to arbitrary forged header spoofing.
  app.set('trust proxy', 1);

  // Size limits. 25 MB is the historical inline-attachment ceiling — anything
  // larger should go through a streaming upload endpoint.
  app.use(json({ limit: '25mb' }));
  app.use(urlencoded({ extended: true, limit: '25mb' }));

  // Parse cookies (used for the httpOnly refresh cookie).
  app.use(cookieParser());

  // Security headers. We keep CSP disabled here because this service is an
  // API; the frontend emits its own CSP. Enable contentSecurityPolicy in a
  // reverse proxy / Angular index.html if serving static assets from Nest.
  app.use(
    helmet({
      contentSecurityPolicy: false,
      crossOriginResourcePolicy: { policy: 'same-site' },
      referrerPolicy: { policy: 'no-referrer' },
    }),
  );

  app.enableCors({
    origin: getCorsOrigins(),
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  });

  // Strict validation on every @Body()/@Query() DTO. Unknown fields are
  // stripped (whitelist) and unexpected extras trigger a 400 error
  // (forbidNonWhitelisted).
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
      transformOptions: { enableImplicitConversion: true },
      // In production we don't want to expose validator internals in errors.
      disableErrorMessages: IS_PROD,
    }),
  );

  const port = process.env.PORT ?? 3300;
  await app.listen(port);
}

bootstrap();
