import { readFile } from "node:fs/promises";
import { join } from "node:path";
import pg from "pg";
import { getDatabaseUrl } from "../lib/database-url.js";

const databaseUrl = getDatabaseUrl();

if (!databaseUrl) {
  console.error("Missing DATABASE_URL or POSTGRES_URL.");
  process.exit(1);
}

const sql = await readFile(join(process.cwd(), "db", "schema.sql"), "utf8");
const pool = new pg.Pool({
  connectionString: databaseUrl,
  ssl: process.env.POSTGRES_SSL === "false" ? false : { rejectUnauthorized: false }
});

try {
  await pool.query(sql);
  console.log("Database schema is ready.");
} finally {
  await pool.end();
}
