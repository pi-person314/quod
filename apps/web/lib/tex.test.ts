import assert from "node:assert/strict";
import test from "node:test";
import { assertStandaloneTex, TexCompileError } from "./tex";

const standalone = String.raw`\documentclass{article}\usepackage{amsmath,amsthm,amssymb}\newtheorem{theorem}{Theorem}\begin{document}\begin{theorem}$a=b$\end{theorem}\end{document}`;
test("standalone TeX accepts standard document preamble", () => assert.doesNotThrow(() => assertStandaloneTex(standalone)));
test("TeX rejects file dependencies and shell escape", () => {
  assert.throws(() => assertStandaloneTex(String.raw`${standalone}\input{private}`), TexCompileError);
  assert.throws(() => assertStandaloneTex(String.raw`${standalone}\write18{cmd}`), TexCompileError);
});
test("TeX rejects malformed non-documents", () => assert.throws(() => assertStandaloneTex("plain text"), TexCompileError));
