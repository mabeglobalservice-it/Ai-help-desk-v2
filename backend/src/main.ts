import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import { IoAdapter } from '@nestjs/platform-socket.io';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { Logger } from 'nestjs-pino';
import cookieParser from 'cookie-parser';
import helmet from 'helmet';
import { AppModule } from './app.module';

async function bootstrap() {
  // eslint-disable-next-line no-console -- diagnostic de demarrage, avant
  // que app.useLogger() ne branche Pino : visible meme si le bootstrap
  // plante avant ce point (bufferLogs retiendrait sinon tout log Nest).
  console.log('[bootstrap] Starting Nest application...');
  const app = await NestFactory.create(AppModule, { bufferLogs: true });
  app.useLogger(app.get(Logger));
  // CSP par defaut de Helmet cassee le Swagger UI (scripts/styles inline) :
  // desactivee en dev/staging ou Swagger est monte (voir plus bas), activee
  // en production ou seule l'API JSON est servie.
  app.use(
    helmet({
      contentSecurityPolicy:
        process.env.NODE_ENV === 'production' ? undefined : false,
    }),
  );
  // docs/11 §1 : toutes les routes REST sont prefixees par /api/v1
  // (n'affecte pas Swagger, monte separement sur /api/docs ci-dessous).
  app.setGlobalPrefix('api/v1');
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
  app.use(cookieParser());
  app.enableCors({
    origin: process.env.FRONTEND_URL ?? 'http://localhost:3002',
    credentials: true,
  });
  app.useWebSocketAdapter(new IoAdapter(app));

  // docs/11-documentation-api.md, section 14: Swagger jamais expose
  // publiquement en production sans authentification.
  if (process.env.NODE_ENV !== 'production') {
    const config = new DocumentBuilder()
      .setTitle('AI Help Desk API')
      .setDescription("Documentation de l'API REST du backend AI Help Desk")
      .setVersion('1.0')
      .addBearerAuth()
      .build();
    const document = SwaggerModule.createDocument(app, config);
    SwaggerModule.setup('api/docs', app, document);
  }

  const port = process.env.PORT ?? 3000;
  // eslint-disable-next-line no-console -- voir commentaire plus haut
  console.log(`[bootstrap] Calling app.listen(${port}, '0.0.0.0')...`);
  await app.listen(port, '0.0.0.0');
  // eslint-disable-next-line no-console -- voir commentaire plus haut
  console.log(`[bootstrap] Listening on 0.0.0.0:${port}`);
}
bootstrap().catch((error: unknown) => {
  // eslint-disable-next-line no-console -- sans ce catch, une exception ici
  // etait avalee silencieusement (promesse non geree), invisible dans les
  // logs Render (cause du "silence" observe avant "No open ports detected").
  console.error('[bootstrap] Fatal error during startup:', error);
  process.exit(1);
});
