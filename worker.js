import { Buffer } from 'node:buffer';
import stateHandler from './api/state.js';
import authLogin from './api/auth/login.js';
import usersHandler from './api/users/index.js';
import adoSync from './api/ado/sync.js';
import logsHandler from './api/logs.js';
import boardHandler from './api/board.js';

// Mock Node.js Request/Response for existing handlers
function createAdapters(request) {
  const url = new URL(request.url);
  
  const req = {
    method: request.method,
    url: request.url,
    headers: Object.fromEntries(request.headers),
    query: Object.fromEntries(url.searchParams),
    // Mock event emitter for body parsing
    on: async (event, cb) => {
      if (event === 'data') {
        try {
          const buf = await request.arrayBuffer();
          cb(Buffer.from(buf));
        } catch (e) {}
      }
      if (event === 'end') setTimeout(cb, 0);
    }
  };

  let status = 200;
  let headers = {};
  let body = null;

  const res = {
    writeHead: (s, h) => { status = s; if(h) headers = {...headers, ...h}; },
    setHeader: (k, v) => { headers[k] = v; },
    end: (b) => { body = b; }
  };

  return { req, res, getResponse: () => new Response(body, { status, headers }) };
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const path = url.pathname;

    // Inject env vars into process.env for the handlers
    globalThis.process = { env: { ...env, NODE_ENV: 'production' } };

    // FIX: Redirect root URL to login.html since index.html doesn't exist
    if (path === '/' || path === '/build.html') {
      return Response.redirect(url.origin + '/login.html', 302);
    }

    // API Routing
    if (path.startsWith('/api/')) {
      const { req, res, getResponse } = createAdapters(request);

      try {
        if (path === '/api/state') await stateHandler(req, res);
        else if (path === '/api/auth/login') await authLogin(req, res);
        else if (path === '/api/users' || path === '/api/users/list') await usersHandler(req, res);
        else if (path === '/api/ado/sync') await adoSync(req, res);
        else if (path === '/api/logs') await logsHandler(req, res);
        else if (path === '/api/board') await boardHandler(req, res);
        
        // Mock Auth Endpoints (from server.js logic)
        else if (path === '/api/auth/me') {
          // In prod, you might want real session check here. 
          // For now, mimicking server.js mock if no cookie logic exists yet.
          // But since we use cookie.js, let's try to verify session if possible.
          // For simplicity, returning the mock admin as per server.js fallback
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ authenticated: true, userId: 'admin', role: 'admin', permissions: { userManager: true } }));
        }
        else if (path === '/api/auth/logout') {
           res.writeHead(200, { 'Content-Type': 'application/json', 'Set-Cookie': 'execdash_session=; Path=/; HttpOnly; Max-Age=0' });
           res.end(JSON.stringify({ ok: true }));
        }
        else {
          return new Response('Not Found', { status: 404 });
        }

        return getResponse();
      } catch (e) {
        return new Response(JSON.stringify({ error: e.message }), { status: 500, headers: {'Content-Type': 'application/json'} });
      }
    }

    // Static Assets (HTML, JS, CSS)
    return env.ASSETS.fetch(request);
  }
};
