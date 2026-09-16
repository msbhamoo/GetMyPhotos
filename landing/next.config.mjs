/** @type {import('next').NextConfig} */
const nextConfig = {
  // Fully static: deploys to Cloudflare Pages / Vercel with no server
  output: 'export',
  images: { unoptimized: true },
  trailingSlash: true,
}

export default nextConfig
