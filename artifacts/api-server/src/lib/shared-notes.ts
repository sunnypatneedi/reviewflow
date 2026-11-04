import * as Y from "yjs";
import { FactoryError } from "./factory-engine";

export const MAX_NOTE_BYTES = 48_000;
export const MAX_NOTE_LENGTH = 2_000;

export function decodeNote(value: unknown): Uint8Array {
  if (
    typeof value !== "string" ||
    value.length > MAX_NOTE_BYTES * 1.4 ||
    !/^[A-Za-z0-9+/]*={0,2}$/.test(value)
  )
    throw new FactoryError("Shared note update is invalid or too large", 400);
  const bytes = Buffer.from(value, "base64");
  if (bytes.byteLength > MAX_NOTE_BYTES)
    throw new FactoryError("Shared note history is full", 413);
  return bytes;
}

/** Apply to a disposable document before accepting any untrusted CRDT state. */
export function mergeNote(current: string | undefined, update?: string) {
  const doc = new Y.Doc();
  try {
    const text = doc.getText("notes");
    if (current) Y.applyUpdate(doc, decodeNote(current));
    if (update) Y.applyUpdate(doc, decodeNote(update));
    if (
      doc.share.size !== 1 ||
      text.length > MAX_NOTE_LENGTH ||
      text
        .toDelta()
        .some(
          (part: { insert?: unknown; attributes?: unknown }) =>
            typeof part.insert !== "string" || part.attributes,
        )
    )
      throw new FactoryError(
        "Use plain text notes of at most 2,000 characters",
        400,
      );
    const state = Y.encodeStateAsUpdate(doc);
    if (state.byteLength > MAX_NOTE_BYTES)
      throw new FactoryError(
        "Shared note history is full; record your review before continuing",
        413,
      );
    return {
      state: Buffer.from(state).toString("base64"),
      text: text.toString(),
    };
  } catch (error) {
    if (error instanceof FactoryError) throw error;
    throw new FactoryError("Shared note update could not be decoded", 400);
  } finally {
    doc.destroy();
  }
}
