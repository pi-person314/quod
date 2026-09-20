import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { db } from "@cairn/contracts/db";

// Test in a temporary schema within one transaction, never enable the app's budget.
const connection = await db().connect();
const schema = `budget_test_${randomUUID().replaceAll("-", "")}`;
try {
  await connection.query("BEGIN");
  await connection.query(`CREATE SCHEMA ${schema}`);
  await connection.query(`SET LOCAL search_path TO ${schema}, public`);
  await connection.query("CREATE TABLE llm_calls(cost_usd numeric, meta jsonb)");
  await connection.query("INSERT INTO llm_calls VALUES (1, '{}'), (99, '{\"synthetic\":true}')");
  await connection.query(await readFile(new URL("../../contracts/migrations/001_api_budget.sql", import.meta.url), "utf8"));
  assert.equal(Number((await connection.query("SELECT opening_microusd FROM api_budget")).rows[0].opening_microusd), 1000000);
  await connection.query("SAVEPOINT denied");
  await assert.rejects(connection.query("SELECT cairn_reserve(1,'test','test')"), /disabled/);
  await connection.query("ROLLBACK TO SAVEPOINT denied");
  await connection.query("UPDATE api_budget SET enabled=true,limit_microusd=2000000");
  const id = (await connection.query("SELECT cairn_reserve(1000000,'test','test') AS id")).rows[0].id;
  await connection.query("SAVEPOINT exhausted");
  await assert.rejects(connection.query("SELECT cairn_reserve(1,'test','test')"), /limit reached/);
  await connection.query("ROLLBACK TO SAVEPOINT exhausted");
  assert.equal((await connection.query("SELECT cairn_settle($1,500000) AS ok", [id])).rows[0].ok, true);
  const next = (await connection.query("SELECT cairn_reserve(500000,'test','test') AS id")).rows[0].id;
  assert.equal((await connection.query("SELECT cairn_settle($1,600000) AS ok", [next])).rows[0].ok, false);
  assert.equal((await connection.query("SELECT enabled FROM api_budget")).rows[0].enabled, false);
  assert.equal(Number((await connection.query("SELECT actual_microusd FROM api_reservations WHERE id=$1", [next])).rows[0].actual_microusd), 600000);
  await connection.query("TRUNCATE api_reservations");
  await connection.query("UPDATE api_budget SET enabled=true");
  await connection.query("COMMIT");
  const contenders = await Promise.all(Array.from({ length: 4 }, () => db().connect()));
  try {
    await Promise.all(contenders.map(client => client.query(`SET search_path TO ${schema}, public`)));
    const outcomes = await Promise.allSettled(contenders.map(client => client.query("SELECT cairn_reserve(600000,'race','test')")));
    assert.equal(outcomes.filter(result => result.status === "fulfilled").length, 1);
    assert.equal(outcomes.filter(result => result.status === "rejected").length, 3);
  } finally {
    for (const client of contenders) { await client.query("RESET search_path"); client.release(); }
  }
  console.log("Shared SQL budget: historical spend, default denial, reservation exhaustion, settlement, overrun blocking, and four-connection race pass.");
} finally {
  await connection.query("ROLLBACK");
  await connection.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
  connection.release();
  await db().end();
}
