import "./time.js";
import { createApp } from "./app.js";
import { createSchema, hasSchema, openDatabase } from "./db.js";
import { seedDatabase } from "./seed.js";
import { aiStatus } from "./ai/agent.js";

const db = openDatabase();
if (!hasSchema(db)) {
  createSchema(db);
  const r = db.transaction(() => seedDatabase(db))();
  console.log(`Created new database with demo data (${r.customers} customers, ${r.jobs} jobs).`);
}
const port = Number(process.env.PORT ?? 3001);
const serveClient = process.argv.includes("--serve-client");
createApp({ serveClient }).listen(port, () => {
  console.log(`FrostLine CRM API listening on http://localhost:${port}${serveClient ? " (serving built client)" : ""}`);
  const ai = aiStatus();
  console.log(ai.enabled ? `AI assistant enabled (${ai.model}).` : `AI assistant disabled: ${ai.reason}`);
});
