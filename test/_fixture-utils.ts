/**
 * Shared test utilities for fixture discovery.
 *
 * NOTE: this file is intentionally NOT named `*.test.ts` so the test runner
 * (`node --import tsx --test "test/**\/*.test.ts"`) does not execute it as a
 * test — it is a plain module imported by the fixture-discovery code in the
 * adversarial test plates.
 */

/**
 * Robust multi-step detection. A fixture is multi-record iff EVERY non-empty
 * physical line independently parses as JSON AND there is more than one such
 * line. A PRETTY-PRINTED single receipt (e.g. mazur.bad-gradient.jsonl spans
 * ~136 physical lines but is one JSON object) fails the "every line parses"
 * test — its first line is a bare "{" — so it is correctly classified as a
 * single receipt. Counting physical lines alone (the v0.9.1 bad-adam/bad-momentum
 * heuristic `bytes.split("\n").length > 1`) misclassifies pretty-printed single
 * receipts as multi-record and routes them through a line-by-line JSON.parse
 * that breaks; this discriminator does not.
 *
 * @param trimmedBytes the fixture file contents, already `.trim()`-ed.
 */
export function detectMultiStep(trimmedBytes: string): boolean {
  const lines = trimmedBytes.split("\n").filter((l) => l.trim().length > 0);
  if (lines.length <= 1) return false;
  for (const line of lines) {
    try {
      JSON.parse(line);
    } catch {
      return false; // a line that doesn't parse alone => pretty-printed single receipt
    }
  }
  return true;
}
