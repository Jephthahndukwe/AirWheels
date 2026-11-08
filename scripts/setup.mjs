// Creates .env from .env.example and fills local-only generated secrets.
import { existsSync, readFileSync, writeFileSync, copyFileSync } from 'node:fs';
import { randomBytes } from 'node:crypto';

if (!existsSync('.env')) copyFileSync('.env.example', '.env');
let env = readFileSync('.env', 'utf8');
// Fill a key if it is empty, or add it if an older .env does not have it yet.
const fill = (key, value) => {
  if (new RegExp(`^${key}=`, 'm').test(env))
    env = env.replace(new RegExp(`^${key}=$`, 'm'), `${key}=${value}`);
  else env = `${env.trimEnd()}\n${key}=${value}\n`;
};
fill('APP_ENCRYPTION_KEY', randomBytes(32).toString('hex'));
fill('PICKUP_CODE_KEY', randomBytes(32).toString('hex'));
fill('JWT_SECRET', randomBytes(32).toString('hex'));
fill('SYSTEM_API_TOKEN', randomBytes(32).toString('hex'));
fill('MOCK_AIRLINE_SECRET', randomBytes(24).toString('hex'));
writeFileSync('.env', env);
console.log('.env ready');
