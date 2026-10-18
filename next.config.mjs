/** @type {import('next').NextConfig} */
const nextConfig = {
  poweredByHeader: false,
  devIndicators: false,
  // Prompts are read from disk at runtime so prompts/coach.md stays editable without a rebuild.
  serverExternalPackages: ["@prisma/client", "@prisma/adapter-better-sqlite3", "@prisma/adapter-pg", "better-sqlite3", "pg"],
};
export default nextConfig;
