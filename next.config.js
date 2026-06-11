// Load .env before any app code runs (so Prisma and others see DATABASE_URL)
require('dotenv').config({ path: require('path').join(process.cwd(), '.env') })

/** @type {import('next').NextConfig} */
const nextConfig = {
  experimental: {
    serverComponentsExternalPackages: ['@prisma/client', 'bcryptjs'],
  },
  images: {
    remotePatterns: [
      { protocol: 'https', hostname: '**' },
    ],
  },
}

module.exports = nextConfig
