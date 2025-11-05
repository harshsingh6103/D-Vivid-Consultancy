/** @type {import('next').NextConfig} */
const nextConfig = {
    images: {
        remotePatterns: [
            {
                protocol: "https",
                hostname: "randomuser.me"
            },
            {
                protocol: "https",
                hostname: "iili.io"
            },
            {
                protocol: "https",
                hostname: "*.vercel.app"
            }
        ],
        // Optimize for Vercel
        deviceSizes: [640, 750, 828, 1080, 1200, 1920, 2048, 3840],
        imageSizes: [16, 32, 48, 64, 96, 128, 256, 384],
    },
    experimental: {
        serverComponentsExternalPackages: ['puppeteer', 'puppeteer-core', '@sparticuz/chromium'],
        // Optimize for Vercel serverless functions - exclude large files
        outputFileTracingExcludes: {
            '*': [
                'node_modules/@swc/**/*',
                'node_modules/@next/swc-*/**/*',
                'node_modules/@types/**/*',
                'node_modules/@dimforge/**/*', 
                'node_modules/@unrs/**/*',
                'node_modules/.pnpm/@swc/**/*',
                'node_modules/.pnpm/@next+swc-*/**/*',
                'node_modules/.pnpm/@types+**/*',
                'node_modules/.pnpm/@dimforge+**/*',
                'node_modules/.pnpm/@unrs+**/*',
                '.next/cache/**/*',
                'node_modules/**/test/**/*',
                'node_modules/**/tests/**/*',
                'node_modules/**/*.test.js',
                'node_modules/**/*.spec.js',
                'node_modules/**/*.d.ts.map',
                'node_modules/**/*.js.map'
            ]
        },
    },
    webpack: (config, { isServer }) => {
        if (isServer) {
            config.externals.push({
                'puppeteer': 'commonjs puppeteer',
                'puppeteer-core': 'commonjs puppeteer-core',
                '@sparticuz/chromium': 'commonjs @sparticuz/chromium',
                '@dimforge/rapier3d-compat': 'commonjs @dimforge/rapier3d-compat',
                '@types/three': 'commonjs @types/three',
                '@unrs/resolver': 'commonjs @unrs/resolver'
            });
        }
        
        // Optimize bundle size for Vercel
        config.resolve.fallback = {
            ...config.resolve.fallback,
            fs: false,
            net: false,
            tls: false,
        };
        
        // Exclude large packages from bundle
        if (isServer) {
            const externals = [
                '@next/swc-linux-x64-gnu',
                '@next/swc-linux-x64-musl', 
                '@swc/core-linux-x64-gnu',
                '@swc/core-linux-x64-musl',
                '@types/three',
                '@dimforge/rapier3d-compat',
                '@unrs/resolver',
                '@unrs/resolver-binding-linux-x64-gnu',
                '@unrs/resolver-binding-linux-x64-musl'
            ];
            
            config.externals = [...config.externals, ...externals.map(pkg => ({ [pkg]: `commonjs ${pkg}` }))];
        }
        
        return config;
    },
    // Vercel optimizations
    poweredByHeader: false,
    generateEtags: false,
    compress: true,
    
    // Ensure environment variables are available
    env: {
        NEXT_PUBLIC_APP_NAME: process.env.NEXT_PUBLIC_APP_NAME,
        NEXT_PUBLIC_APP_DOMAIN: process.env.NEXT_PUBLIC_APP_DOMAIN,
        NEXT_PUBLIC_APP_URL: process.env.NEXT_PUBLIC_APP_URL,
        NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY: process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY,
        CLERK_SECRET_KEY: process.env.CLERK_SECRET_KEY,
        PERPLEXITY_API_KEY: process.env.PERPLEXITY_API_KEY, 
    },
    
    // Better error handling for production
    onDemandEntries: {
        maxInactiveAge: 25 * 1000,
        pagesBufferLength: 2,
    },
};

export default nextConfig;
