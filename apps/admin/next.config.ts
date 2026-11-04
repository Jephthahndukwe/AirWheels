import { config } from 'dotenv';
import type { NextConfig } from 'next';
import { resolve } from 'node:path';

// One .env at the repo root for every app.
config({ path: resolve(__dirname, '../../.env') });

const nextConfig: NextConfig = {
  transpilePackages: ['@airwheels/ui', '@airwheels/types', '@airwheels/api-client'],
  poweredByHeader: false,
};

export default nextConfig;
