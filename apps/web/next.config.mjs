const config = {
  reactStrictMode: true,
  output: 'standalone',
  async rewrites() {
    return [
      { source: '/api/:path*', destination: `${process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:8080'}/api/:path*` },
    ];
  },
};
export default config;
