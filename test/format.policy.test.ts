import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { formatDecimalStringForFixture, FormatPolicyError } from "../src/format.js";

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
