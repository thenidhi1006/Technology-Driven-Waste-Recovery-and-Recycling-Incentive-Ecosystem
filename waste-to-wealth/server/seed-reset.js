// Deletes the local database so the next start re-creates it with fresh demo data.
//   npm run seed
const fs = require('fs');
const path = require('path');

const dir = path.join(__dirname, '..', 'data');
for (const f of ['wtw.db', 'wtw.db-wal', 'wtw.db-shm']) {
  try {
    fs.unlinkSync(path.join(dir, f));
    console.log('removed', f);
  } catch {
    /* file did not exist */
  }
}
console.log('Done. Run "npm start" to create fresh demo data.');
