import { type INestApplication, VersioningType } from '@nestjs/common';
import { DocumentBuilder, SwaggerModule, type OpenAPIObject } from '@nestjs/swagger';

/** Shared by main.ts and openapi.ts so the generated spec matches the running app. */
export function configureApp(app: INestApplication): void {
  app.enableVersioning({ type: VersioningType.URI, defaultVersion: '1' });
  app.enableCors({
    origin: [
      process.env.WEB_PUBLIC_URL ?? 'http://localhost:3000',
      'http://localhost:3001', // admin
      'http://localhost:3002', // widget host page
    ],
  });
}

export function buildOpenApi(app: INestApplication): OpenAPIObject {
  const config = new DocumentBuilder()
    .setTitle('Airwheels API')
    .setDescription('Airport transfers sold inside airline booking flows. PRD v2.2.')
    .setVersion('1.0')
    .build();
  return SwaggerModule.createDocument(app, config);
}
