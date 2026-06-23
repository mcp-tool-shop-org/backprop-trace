/**
 * hash-general-receipt-raw-throw — hashReceipt(object) for the General
 * receipt family (v0.2+).
 *
 * hashReceipt's object overload was typed for a Mazur receipt and ALWAYS
 * routed through emitMazurReceipt. Handing it any v0.2+ General receipt
 * (xor/iris/softmax/observer-imported) therefore threw a raw formatter
 * Error ("formatNumberForEngine: input is not finite (got [object
 * Object])") instead of returning a digest — even though the README
 * presents hashReceipt as the in-toto attestation seam and real receipts
 * are overwhelmingly General.
 *
 * The fix discriminates the family on the receipt's own `schema_version`
 * (the same in-band discriminator the validator dispatches on) and routes
 * to emitMazurReceipt ("0.1.0") vs emitGeneralReceipt (everything else).
 *
 * This test pins BOTH halves of the contract:
 *   1. hashReceipt(generalReceipt) RETURNS a digest (no throw) for each
 *      golden family — xor (0.2.0), iris (0.2.0), softmax-ce (0.3.0).
 *   2. hashReceipt(generalReceipt) === hashReceipt(emitGeneralReceipt(
 *      generalReceipt)) — the object path equals the already-working
 *      string path, i.e. the object overload hashes over the General
 *      receipt's OWN canonical bytes.
 *   3. The Mazur path is UNCHANGED — hashReceipt(mazur) still equals the
 *      pinned golden digest, and still equals the on-disk golden bytes.
 *   4. sha512 works on a General receipt too (128-char hex).
 */

import { test } from "node:test"
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { fileURLToPath } from "node:url"
import { dirname, resolve } from "node:path"
import { hashReceipt } from "../src/hash.js"
import { emitGeneralReceipt } from "../src/emit.js"
import type { GeneralReceipt } from "../src/general-engine.js"
import type { MazurReceipt } from "../src/engine.js"

const __dirname = dirname(fileURLToPath(import.meta.url))
const repoRoot = resolve(__dirname, "..")

/** The pinned Mazur golden digest — must stay byte-for-byte unchanged. */
const MAZUR_GOLDEN_SHA256 =
  "e781a6d214acc29ec113f40664b2994fa3d50b4d60663115f7d7ac227954b71a"

function loadGeneral(name: string): GeneralReceipt {
  const path = resolve(repoRoot, `fixtures/${name}.golden.jsonl`)
  return JSON.parse(readFileSync(path, "utf-8")) as GeneralReceipt
}

/**
 * Each canonical General golden + the schema_version it declares. These
 * span both generalized schema lines: 0.2.0 (half_squared_error: xor/iris)
 * and 0.3.0 (cross_entropy_softmax: softmax-ce).
 */
const GENERAL_GOLDENS = [
  { name: "xor", schemaVersion: "0.2.0" },
  { name: "iris", schemaVersion: "0.2.0" },
  { name: "softmax-ce", schemaVersion: "0.3.0" },
] as const

for (const { name, schemaVersion } of GENERAL_GOLDENS) {
  test(`hashReceipt(${name} general receipt) returns a 64-char sha256 hex instead of throwing`, () => {
    const receipt = loadGeneral(name)
    assert.strictEqual(
      receipt.schema_version,
      schemaVersion,
      `test setup: ${name} golden must declare schema_version ${schemaVersion}`,
    )
    let digest: string
    assert.doesNotThrow(() => {
      digest = hashReceipt(receipt)
    }, `hashReceipt(${name}) must NOT throw — General receipts are the common case`)
    assert.match(
      digest!,
      /^[0-9a-f]{64}$/,
      `sha256 hex must be 64 lowercase hex chars; got: ${digest!}`,
    )
  })

  test(`hashReceipt(${name} object) === hashReceipt(emitGeneralReceipt(${name})) — object path equals string path`, () => {
    const receipt = loadGeneral(name)
    const objectDigest = hashReceipt(receipt)
    const stringDigest = hashReceipt(emitGeneralReceipt(receipt))
    assert.strictEqual(
      objectDigest,
      stringDigest,
      `the object overload must hash over the General receipt's OWN canonical bytes — ` +
        `routing through emitGeneralReceipt — so it must equal the string-overload digest`,
    )
  })

  test(`hashReceipt(${name} object) === hashReceipt(on-disk golden bytes)`, () => {
    // The object overload re-emits; the on-disk golden IS those canonical
    // bytes, so the two digests must agree (the in-toto "digest matches the
    // file on disk" property the attestation seam relies on).
    const path = resolve(repoRoot, `fixtures/${name}.golden.jsonl`)
    const rawBytes = readFileSync(path, "utf-8")
    const receipt = JSON.parse(rawBytes) as GeneralReceipt
    assert.strictEqual(
      hashReceipt(receipt),
      hashReceipt(rawBytes),
      `hashReceipt(parsed ${name}) must equal hashReceipt(raw ${name} bytes)`,
    )
  })
}

test("hashReceipt(general receipt, 'sha512') returns 128-char hex", () => {
  const receipt = loadGeneral("xor")
  const digest = hashReceipt(receipt, "sha512")
  assert.match(
    digest,
    /^[0-9a-f]{128}$/,
    `sha512 hex must be 128 lowercase hex chars; got: ${digest}`,
  )
})

test("hashReceipt(mazur) is UNCHANGED by the General-receipt routing — pinned digest stays byte-equal", () => {
  // The Mazur path (schema_version "0.1.0") must still route through
  // emitMazurReceipt and produce the exact pinned golden digest. A regression
  // here means the discriminator mis-routed the Mazur family.
  const path = resolve(repoRoot, "fixtures/mazur.golden.jsonl")
  const mazur = JSON.parse(readFileSync(path, "utf-8")) as MazurReceipt
  assert.strictEqual(mazur.schema_version, "0.1.0", "test setup: mazur is 0.1.0")
  const digest = hashReceipt(mazur)
  assert.strictEqual(
    digest,
    MAZUR_GOLDEN_SHA256,
    `Mazur digest must be unchanged by the General-receipt routing — ` +
      `expected pinned ${MAZUR_GOLDEN_SHA256}, got ${digest}`,
  )
})
