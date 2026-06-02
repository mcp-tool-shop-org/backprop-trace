import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { formatDecimalStringForFixture, FormatPolicyError } from "../src/format.js";
import { scientificToPlain } from "../src/runtime-format.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const fixturePath = resolve(__dirname, "../fixtures/formatter.policy.golden.json");

type Case = {
  category: string;
  input_decimal: string;
  expected?: string;
  expected_error?: string;
  note: string;
};

type Fixture = {
  cases: Case[];
};

const fixture = JSON.parse(readFileSync(fixturePath, "utf-8")) as Fixture;

for (const c of fixture.cases) {
  const baseName = `formatDecimalStringForFixture(${JSON.stringify(c.input_decimal)}) [${c.category}]`;

  if (c.expected !== undefined) {
    const expected = c.expected;
    test(`${baseName} -> ${JSON.stringify(expected)}`, () => {
      const result = formatDecimalStringForFixture(c.input_decimal);
      assert.strictEqual(result, expected, c.note);
    });
  } else if (c.expected_error !== undefined) {
    const expectedError = c.expected_error;
    test(`${baseName} throws ${expectedError}`, () => {
      let caught: unknown = undefined;
      try {
        formatDecimalStringForFixture(c.input_decimal);
      } catch (e) {
        caught = e;
      }

      if (caught === undefined) {
        throw new Error(
          `Expected FormatPolicyError(${expectedError}) for input ${JSON.stringify(c.input_decimal)}, but no error was thrown.`,
        );
      }
      if (!(caught instanceof FormatPolicyError)) {
        throw new Error(
          `Caught value must be FormatPolicyError, got ${String(caught)}`,
        );
      }
      assert.strictEqual(caught.kind, expectedError, c.note);
    });
  } else {
    test(`${baseName} has malformed expectations`, () => {
      assert.fail(
        `Policy fixture case is missing both 'expected' and 'expected_error': ${c.category}`,
      );
    });
  }
}

// ---------------------------------------------------------------------------
// io-B-006: scientificToPlain is a PUBLIC export and must guard a non-string
// argument with an actionable message. RegExp.exec coerces its argument, so
// without the guard scientificToPlain(null) throws the misleading "input null
// is not in scientific notation (regex ...)" — implying a malformed scientific
// literal when the real bug is the wrong TYPE. The guard names the type and
// points the caller at formatNumberForEngine.
//
// MUTATION THAT MAKES THIS RED: remove the typeof guard in scientificToPlain.
// Then the non-string cases throw the regex-mismatch message (no "expected a
// string" / "got <type>"), and these assertions fail.
// ---------------------------------------------------------------------------

test("io-B-006: scientificToPlain still expands a valid scientific string (positive baseline)", () => {
  assert.strictEqual(scientificToPlain("1.5e3"), "1500");
  assert.strictEqual(scientificToPlain("1e-9"), "0.000000001");
});

test("io-B-006: scientificToPlain rejects a non-string argument with a type-naming, actionable error", () => {
  for (const bad of [null, undefined, 123, {}] as unknown[]) {
    let caught: unknown;
    try {
      // Cast through unknown — the guard exists for untyped JS callers.
      scientificToPlain(bad as unknown as string);
    } catch (e) {
      caught = e;
    }
    assert.ok(
      caught instanceof Error,
      `non-string ${String(bad)} must throw an Error`,
    );
    const msg = (caught as Error).message;
    assert.match(
      msg,
      /expected a string/i,
      `error must name the type expectation (not a regex mismatch); got: ${msg}`,
    );
    assert.match(
      msg,
      /formatNumberForEngine/,
      `error must point the caller at formatNumberForEngine; got: ${msg}`,
    );
    // It must NOT be the misleading "not in scientific notation" regex message.
    assert.doesNotMatch(
      msg,
      /is not in scientific notation/,
      `non-string failure must not masquerade as a malformed-literal error; got: ${msg}`,
    );
  }
});
