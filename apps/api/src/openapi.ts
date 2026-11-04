import 'reflect-metadata';
import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { buildOpenApi, configureApp } from './bootstrap';

/**
 * Writes the OpenAPI spec without a database or Redis: `preview` mode builds the module graph
 * but does not instantiate providers. Used by `pnpm openapi` to regenerate packages/api-client.
 */
async function main() {
  const out = resolve(process.argv[2] ?? 'openapi.json');
  const app = await NestFactory.create(AppModule, { preview: true, logger: false });
  configureApp(app);
  const doc = buildOpenApi(app);
  writeFileSync(out, JSON.stringify(doc, null, 2) + '\n');
  console.log(`OpenAPI written to ${out}`);
  await app.close();
}

void main();
