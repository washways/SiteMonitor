/*  WASH Dashboard – CORS Proxy Worker
 *  Deploy this on Cloudflare Workers (free tier).
 *
 *  Routes:
 *    /dcp/*   →  https://api-dev.dcp.solar/water/*
 *    /ssl/*   →  https://sonsetlink.org/water/technical/*
 */

const ROUTES = {
    '/dcp/': 'https://api-dev.dcp.solar/water/',
    '/ssl/': 'https://sonsetlink.org/water/technical/',
};

// Only allow requests from your own site(s)
const ALLOWED_ORIGINS = [
    'https://washways.org',
    'https://www.washways.org',
    'https://washways.github.io',
    'http://localhost:3000',
];

function corsHeaders(origin) {
    return {
        'Access-Control-Allow-Origin': ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0],
        'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type, X-API-Key, X-Authorization, Authorization',
        'Access-Control-Max-Age': '86400',
    };
}

export default {
    async fetch(request) {
        const url = new URL(request.url);
        const origin = request.headers.get('Origin') || '';

        // Handle preflight
        if (request.method === 'OPTIONS') {
            return new Response(null, { status: 204, headers: corsHeaders(origin) });
        }

        // Find matching route
        let targetBase = null;
        let prefix = null;
        for (const [p, t] of Object.entries(ROUTES)) {
            if (url.pathname.startsWith(p)) {
                prefix = p;
                targetBase = t;
                break;
            }
        }

        if (!targetBase) {
            return new Response('Not found', { status: 404 });
        }

        // Build target URL: strip the prefix, keep the rest of the path + query
        const remainingPath = url.pathname.slice(prefix.length);
        const targetUrl = targetBase + remainingPath + url.search;

        // Clone headers, remove browser-added origin/referer
        const proxyHeaders = new Headers(request.headers);
        proxyHeaders.delete('Origin');
        proxyHeaders.delete('Referer');
        proxyHeaders.set('Host', new URL(targetBase).host);
        proxyHeaders.set('User-Agent', 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36');

        // Forward the request
        const apiResponse = await fetch(targetUrl, {
            method: request.method,
            headers: proxyHeaders,
            body: request.method !== 'GET' ? request.body : undefined,
        });

        // Return response with CORS headers
        const responseHeaders = new Headers(apiResponse.headers);
        for (const [k, v] of Object.entries(corsHeaders(origin))) {
            responseHeaders.set(k, v);
        }

        return new Response(apiResponse.body, {
            status: apiResponse.status,
            headers: responseHeaders,
        });
    },
};
