import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  allowedDevOrigins: [
    'http://localhost:3000',
    'http://127.0.0.1:3000',
    'http://192.168.1.108:3000',
    'local-origin.dev',
    '*.local-origin.dev',
  ],
};

export default nextConfig;
