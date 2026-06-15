import pg from "pg";
import { getDatabaseUrl } from "../lib/database-url.js";

const databaseUrl = getDatabaseUrl();

if (!databaseUrl) {
  console.error("Missing DATABASE_URL or POSTGRES_URL.");
  process.exit(1);
}

const expectedTables = ["users", "couples", "invites", "tasks", "events", "push_subscriptions"];
const pool = new pg.Pool({
  connectionString: databaseUrl,
  ssl: process.env.POSTGRES_SSL === "false" ? false : { rejectUnauthorized: false }
});

try {
  const result = await pool.query(
    `select table_name
      from information_schema.tables
      where table_schema = 'public'
      and table_name = any($1::text[])
      order by table_name`,
    [expectedTables]
  );
  const found = result.rows.map((row) => row.table_name);
  const missing = expectedTables.filter((table) => !found.includes(table));

  if (missing.length) {
    console.error(`Database connected, but missing tables: ${missing.join(", ")}`);
    process.exit(1);
  }

  console.log(`Database connected. Tables ready: ${found.join(", ")}`);
} finally {
  await pool.end();
}
