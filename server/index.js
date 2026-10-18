import { createDatabase } from './database.js';
import { createApp } from './app.js';

const production = process.env.NODE_ENV === 'production';
if (production && !process.env.DATABASE_URL) throw new Error('Auf Render muss DATABASE_URL für die dauerhafte PostgreSQL-Datenbank gesetzt sein.');
const db = await createDatabase({ url: process.env.DATABASE_URL });
const app = createApp({ db, production, adminSetupCode: process.env.ADMIN_SETUP_CODE });
const port = Number(process.env.PORT || 3000);
const server = app.listen(port, '0.0.0.0', () => console.log(`Abgabenkonto: http://localhost:${port}`));
async function shutdown() {
  server.close(async () => { await db.close(); process.exit(0); });
  setTimeout(() => process.exit(1), 10000).unref();
}
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
