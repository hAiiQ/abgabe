import { readFileSync } from 'node:fs';
import { isAbsolute, posix } from 'node:path';

export function storageOptions(env = process.env, { readMountInfo = () => readFileSync('/proc/self/mountinfo', 'utf8') } = {}) {
  if (env.DATABASE_URL && env.SQLITE_PATH) throw new Error('Bitte nur einen Speicher konfigurieren: SQLITE_PATH für die Disk oder DATABASE_URL für PostgreSQL.');
  if (env.DATABASE_URL) return { url: env.DATABASE_URL };
  if (!env.SQLITE_PATH) {
    if (env.NODE_ENV === 'production') throw new Error('Dauerhafter Speicher fehlt. Füge eine Persistent Disk unter /var/data hinzu und setze SQLITE_PATH=/var/data/portal.sqlite. Alternativ ist DATABASE_URL für PostgreSQL möglich.');
    return {};
  }
  if (!isAbsolute(env.SQLITE_PATH)) throw new Error('SQLITE_PATH muss ein absoluter Dateipfad sein.');
  if (env.RENDER === 'true') {
    const path = posix.normalize(env.SQLITE_PATH);
    if (!path.startsWith('/var/data/') || path === '/var/data/') throw new Error('Auf Render muss SQLITE_PATH unter /var/data liegen, zum Beispiel /var/data/portal.sqlite.');
    let mounted = false;
    try {
      mounted = readMountInfo().split('\n').some((line) => line.split(' ')[4] === '/var/data');
    } catch { /* Fail closed when the runtime cannot verify the persistent mount. */ }
    if (!mounted) throw new Error('Persistent Disk fehlt: Füge in Render unter Advanced → Add Disk eine Disk mit Mount Path /var/data hinzu. Der Start wurde gestoppt, damit keine Daten flüchtig gespeichert werden.');
    return { sqlitePath: path };
  }
  return { sqlitePath: env.SQLITE_PATH };
}
