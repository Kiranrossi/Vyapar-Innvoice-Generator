import express from 'express';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { api } from './routes.js';
import { dailyBackup } from './backup.js';
import { authRoutes, initAuth, requireAuth } from './auth.js';

const app = express();
const port = Number(process.env.PORT) || 5050;

// Behind a hosting proxy (https), so secure cookies and client IPs work.
app.set('trust proxy', 1);
app.use(express.json({ limit: '5mb' }));
initAuth();
app.use('/api/auth', authRoutes);
app.use('/api', requireAuth, api);

// In production the built React app is served from the same server.
const dist = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'client', 'dist');
if (existsSync(dist)) {
  app.use(express.static(dist));
  app.get('/{*path}', (req, res) => res.sendFile(join(dist, 'index.html')));
}

dailyBackup();
setInterval(dailyBackup, 60 * 60 * 1000);

app.listen(port, () => console.log(`Invoice server running on http://localhost:${port}`));
