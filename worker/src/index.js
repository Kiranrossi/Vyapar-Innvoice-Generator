import { Hono } from 'hono';
import { api } from './api.js';
import { authRoutes, requireAuth } from './auth.js';
import { HttpError } from './db.js';

// Cloudflare Worker: /api/* runs here, everything else is the React app
// served from static assets (see wrangler.jsonc).
const app = new Hono();

app.route('/api/auth', authRoutes);
app.use('/api/*', async (c, next) => (c.req.path.startsWith('/api/auth/') ? next() : requireAuth(c, next)));
app.route('/api', api);

app.notFound((c) => (c.req.path.startsWith('/api/') ? c.json({ error: 'Not found' }, 404) : c.env.ASSETS.fetch(c.req.raw)));

app.onError((err, c) => {
  if (err instanceof HttpError) return c.json({ error: err.message }, err.status);
  if (err instanceof SyntaxError) return c.json({ error: 'Invalid request' }, 400);
  if (/UNIQUE constraint failed: (parties|items)\.name/i.test(err.message)) return c.json({ error: 'That name already exists' }, 409);
  console.error(err);
  return c.json({ error: 'Something went wrong on the server' }, 500);
});

export default app;
