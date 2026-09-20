import test from "node:test";
import assert from "node:assert/strict";
import type { Node } from "@quod/contracts";
import { ankiCsv } from "../lib/anki-export";
test("Anki export declares two fields, safely quotes content, preserves sources and converts math", () => {
  const node = {id:"node",doc_id:"book",kind:"theorem",label:"Theorem 1.2",title:'A "quoted", result',page:2,statement_md:'If $x < y$, then "yes".\n$$a+b=c$$\n<script>alert(1)</script>'} as Node;
  const csv=ankiCsv([node],[{id:"book",title:"Algebra & notes"}]);
  assert.ok(csv.startsWith("#separator:Comma\r\n#html:true\r\n#columns:Front,Back\r\n#tags:quod\r\n"));
  assert.match(csv,/A ""quoted"", result/);
  assert.ok(csv.includes('\\(x &lt; y\\)'));
  assert.ok(csv.includes('\\[a+b=c\\]'));
  assert.ok(csv.includes('<br>&lt;script&gt;'));
  assert.ok(!csv.includes('<script>'));
  assert.ok(csv.includes('Algebra &amp; notes · p. 2'));
  const row=csv.split('\r\n')[4];
  assert.match(row,/^"(?:[^"]|"")*","(?:[^"]|"")*"$/);
});
