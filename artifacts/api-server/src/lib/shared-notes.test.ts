import assert from "node:assert/strict";
import { test } from "node:test";
import * as Y from "yjs";
import { mergeNote } from "./shared-notes";
const state = (doc: Y.Doc) =>
  Buffer.from(Y.encodeStateAsUpdate(doc)).toString("base64");
test("concurrent notes merge in either order and duplicate updates are idempotent", () => {
  for (let i = 0; i < 25; i++) {
    const a = new Y.Doc(),
      b = new Y.Doc();
    a.getText("notes").insert(0, "Shared source. ");
    Y.applyUpdate(b, Y.encodeStateAsUpdate(a));
    a.getText("notes").insert(0, "A ");
    b.getText("notes").insert(b.getText("notes").length, "B");
    const ab = mergeNote(state(a), state(b)),
      ba = mergeNote(state(b), state(a));
    assert.equal(ab.text, "A Shared source. B");
    assert.equal(ab.text, ba.text);
    assert.equal(mergeNote(ab.state, state(a)).state, ab.state);
  }
});
test("shared notes reject malformed, oversized, foreign roots and rich text", () => {
  assert.throws(() => mergeNote(undefined, "!!!"));
  assert.throws(() => mergeNote(undefined, "A".repeat(100_000)));
  for (const mutate of [
    (doc: Y.Doc) => doc.getText("notes").insert(0, "x".repeat(2001)),
    (doc: Y.Doc) => doc.getMap("decision").set("accepted", true),
    (doc: Y.Doc) => doc.getText("notes").insert(0, "styled", { bold: true }),
  ]) {
    const doc = new Y.Doc();
    mutate(doc);
    assert.throws(() => mergeNote(undefined, state(doc)));
  }
});
