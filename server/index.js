import { createDatabase } from './database.js';
import { createApp } from './app.js';
import { storageOptions } from './storage.js';

const production = process.env.NODE_ENV === 'production';
const db = await createDatabase(storageOptions());
const app = createApp({ db, production, adminSetupCode: process.env.ADMIN_SETUP_CODE });
const port = Number(process.env.PORT || 3000);
const server = app.listen(port, '0.0.0.0', () => console.log(`Abgabenkonto: http://localhost:${port}`));
async function shutdown() {
  server.close(async () => { await db.close(); process.exit(0); });
  setTimeout(() => process.exit(1), 10000).unref();
}
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
