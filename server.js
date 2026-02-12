// server.js
// Simple Node.js server to run the dashboard locally
// Usage: node server.js

const http = require('http');
const fs = require('fs');
const path = require('path');
const url = require('url');
const { log } = require('./api/_lib/logger'); // Import logger
const { setSession, clearSession, getSession } = require('./api/_lib/cookie');

// Allow selecting database folder via command line argument
// Usage: node server.js "D:\My\Custom\Db\Path"
if (process.argv[2]) {
  process.env.LOCAL_DB_ROOT = process.argv[2];
} else if (!process.env.LOCAL_DB_ROOT && !process.env.GITHUB_OWNER) {
  process.env.LOCAL_DB_ROOT = __dirname;
}

// Ensure local DB exists for dev to prevent crashes and auth errors
const DB_PATH = path.join(process.env.LOCAL_DB_ROOT, 'db');
if (!fs.existsSync(DB_PATH)) {
  try { fs.mkdirSync(DB_PATH, { recursive: true }); } catch (e) {}
}
const USERS_FILE = path.join(DB_PATH, 'users.json');
if (!fs.existsSync(USERS_FILE)) {
  const defaultUsers = {
    users: {
      admin: { userId: 'admin', role: 'admin', permissions: { userManager: true } }
    }
  };
  try { fs.writeFileSync(USERS_FILE, JSON.stringify(defaultUsers, null, 2)); } catch (e) {}
}

// Set default session secret for local development to prevent crashes
if (!process.env.SESSION_SECRET) {
  process.env.SESSION_SECRET = 'local-dev-secret-key-123';
}

const PORT = 3000;
const BASE_DIR = __dirname;

const MIME_TYPES = {
  '.html': 'text/html',
  '.js': 'text/javascript',
  '.css': 'text/css',
  '.json': 'application/json',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml',
};

const server = http.createServer(async (req, res) => {
  const baseURL = 'http://' + req.headers.host + '/';
  const parsedUrl = new URL(req.url, baseURL);
  req.query = Object.fromEntries(parsedUrl.searchParams); // Attach query parameters to req for API handlers
  
  let pathname;
  try { pathname = decodeURIComponent(parsedUrl.pathname); } catch (e) { pathname = parsedUrl.pathname; }

  // --- API Handling ---
  if (pathname.startsWith('/api/')) {
    try {
      // 1. Resolve the module path (e.g., /api/state -> api/state.js)
      // SECURITY FIX: Prevent directory traversal in API loading
      let relativePath = pathname.substring(1).replace(/^(\.\.[\/\\])+/, ''); 
      let modulePath = path.join(BASE_DIR, relativePath + '.js');

      // SECURITY FIX: Ensure we are only loading files from the 'api' directory
      if (!modulePath.startsWith(path.join(BASE_DIR, 'api'))) {
        throw new Error('Forbidden: Invalid API path');
      }

      // 2. Check if file exists
      if (fs.existsSync(modulePath)) {
        // Clear require cache to allow hot-reloading of API logic
        delete require.cache[require.resolve(modulePath)];
        
        // Clear helper cache (like cookie.js) so updates take effect immediately
        Object.keys(require.cache).forEach(key => {
          if (key.includes('_lib')) delete require.cache[key];
        });

        const handler = require(modulePath);
        await handler(req, res);
        return;
      }
      
      // 3. Mock Auth endpoints if files are missing (Convenience for local dev)
      if (pathname === '/api/auth/me') {
        const sess = getSession(req);
        if (!sess) {
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ authenticated: false }));
          return;
        }
        
        let user = { userId: sess.userId, role: 'viewer', permissions: {} };
        try {
          const usersData = JSON.parse(fs.readFileSync(USERS_FILE, 'utf8'));
          if (usersData.users && usersData.users[sess.userId]) user = usersData.users[sess.userId];
        } catch(e) {}

        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ 
          authenticated: true, userId: user.userId, role: user.role, permissions: user.permissions 
        }));
        return;
      }
      
      if (pathname === '/api/auth/login') {
        const sessionVal = encodeURIComponent(JSON.stringify({ userId: 'admin', role: 'admin' }));
        log('admin', 'system', 'login', 'User logged in (Mock Auth)'); // Log login
        setSession(res, { userId: 'admin' });
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: true, user: { userId: 'admin', role: 'admin' } }));
        return;
      }

      if (pathname === '/api/auth/logout') {
        log('admin', 'system', 'logout', 'User logged out (Mock Auth)'); // Log logout
        clearSession(res);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: true }));
        return;
      }

      // 4. Not Found
      console.log(`API 404: ${pathname}`);
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: `API endpoint not found: ${pathname}` }));

    } catch (e) {
      console.error(`API Error ${pathname}:`, e);
      if (!res.headersSent) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: e.message || String(e) }));
      }
    }
    return;
  }

  // --- Favicon Handling ---
  // Silence 404s for favicon if it doesn't exist
  if (pathname === '/favicon.ico') {
    if (!fs.existsSync(path.join(BASE_DIR, 'favicon.ico'))) {
      res.writeHead(204);
      res.end();
      return;
    }
  }

  // --- Static File Handling ---
  if (pathname === '/') pathname = '/index.html';
  
  // Security: prevent directory traversal
  const normalizedPath = path.normalize(pathname).replace(/^(\.\.[\/\\])+/, '');

  // Explicitly block portfolio.html
  if (normalizedPath === 'portfolio.html' || normalizedPath === 'portfolio') {
    res.writeHead(404, { 'Content-Type': 'text/plain' });
    res.end('404 Not Found');
    return;
  }

  let filePath = path.join(BASE_DIR, normalizedPath);

  // If no extension, try adding .html (clean URLs)
  if (!path.extname(filePath)) {
    if (fs.existsSync(filePath + '.html')) {
      filePath += '.html';
    } else if (fs.existsSync(path.join(filePath, 'index.html'))) {
      filePath = path.join(filePath, 'index.html');
    }
  }

  const ext = path.extname(filePath);

  fs.readFile(filePath, (err, data) => {
    if (err) {
      if (err.code === 'ENOENT') {
        // Fallback: If index.html is missing, list available HTML files
        if (pathname === '/index.html') {
          fs.readdir(BASE_DIR, (err2, files) => {
            const htmlFiles = (files || []).filter(f => f.endsWith('.html') && f !== 'portfolio.html');
            if (!err2 && htmlFiles.length > 0) {
              res.writeHead(200, { 'Content-Type': 'text/html' });
              res.end(`
                <html><body style="font-family:sans-serif;padding:20px;">
                  <h2>Index not found</h2>
                  <p>Please select a file to open:</p>
                  <ul>${htmlFiles.map(f => `<li><a href="/${f}">${f}</a></li>`).join('')}</ul>
                </body></html>
              `);
              return;
            }
            res.writeHead(404, { 'Content-Type': 'text/plain' });
            res.end('404 Not Found (index.html is missing)');
          });
          return;
        }
        console.log(`[404] ${pathname} -> ${filePath}`);
        res.writeHead(404, { 'Content-Type': 'text/plain' });
        res.end('404 Not Found');
      } else {
        res.writeHead(500, { 'Content-Type': 'text/plain' });
        res.end(`Server Error: ${err.code}`);
      }
    } else {
      res.writeHead(200, { 'Content-Type': MIME_TYPES[ext] || 'application/octet-stream' });
      res.end(data);
    }
  });
});

server.listen(PORT, () => {
  console.log(`\n--- Dashboard Local Server ---`);
  console.log(`Url: http://localhost:${PORT}`);
  console.log(`Root: ${BASE_DIR}`);
  console.log(`DB Path: ${process.env.LOCAL_DB_ROOT || 'Default (D:\\My Project\\Database-main\\db)'}`);
  console.log(`------------------------------\n`);
  log('system', 'system', 'startup', 'Server started on port ' + PORT);
});