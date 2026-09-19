/**
 * Shared Postgres pool. Import as `@cairn/contracts/db` (server-side only —
 * never from a client component). Reads DATABASE_URL.
 */
import { Pool } from "pg";

let pool: Pool | undefined;

export function db(): Pool {
  if (!pool) {
    const connectionString = process.env.DATABASE_URL;
    if (!connectionString) throw new Error("DATABASE_URL is not set (copy .env.example to .env)");
    pool = new Pool({ connectionString, max: 8 });
  }
  return pool;
}
