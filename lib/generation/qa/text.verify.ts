import assert from "node:assert/strict";

import { evaluateEntityCoverage, parseEntity } from "./text";

/**
 * Deterministic regression checks for entity coverage matching —
 * dependency-free (Node's built-in `assert`), same pattern as
 * `lib/generation/blueprint/tree-order.verify.ts`.
 *
 * Run with: npx tsx lib/generation/qa/text.verify.ts
 *
 * Covers, in one permanent suite:
 * - `parseEntity()`'s primary/alias split (LEAVES-01, unchanged).
 * - QD10 (docs/architecture/phase-4-6-qa-plan.md, locked 2026-08-20,
 *   QA-13) — normalized significant-word coverage, replacing the
 *   original literal-contiguous-phrase rule. The 12 cases below are
 *   the exact classes audited during QA-11 (real entities/bodies from
 *   project `ce718b4d-25e1-40f6-9af5-9716c7ce1aa0`, plus the same
 *   labeled synthetic cases used for classes that project's real data
 *   didn't naturally contain) — promoted here from that session's
 *   throwaway audit script into a permanent regression suite.
 * - The two previously-shipped fixes this rule must not regress:
 *   Markdown-formatting insensitivity (`containsNormalized`) and
 *   parenthetical-alias handling (`parseEntity`).
 */

let passed = 0;

function check(name: string, fn: () => void) {
  fn();
  passed++;
  console.log(`ok - ${name}`);
}

// --- parseEntity (LEAVES-01, unchanged by QD10) --------------------------

check("parseEntity: splits a trailing parenthetical into primary + one alias", () => {
  const parsed = parseEntity("Bolognese sauce (ragu alla bolognese)");
  assert.equal(parsed.primary, "Bolognese sauce");
  assert.deepEqual(parsed.aliases, ["ragu alla bolognese"]);
});

check("parseEntity: splits multiple comma/semicolon-separated aliases", () => {
  const parsed = parseEntity("Bolognese sauce (ragu alla bolognese, ragù)");
  assert.equal(parsed.primary, "Bolognese sauce");
  assert.deepEqual(parsed.aliases, ["ragu alla bolognese", "ragù"]);
});

check("parseEntity: an entity with no parenthetical has no alias, primary is the whole string", () => {
  const parsed = parseEntity("Crowded bar test");
  assert.equal(parsed.primary, "Crowded bar test");
  assert.deepEqual(parsed.aliases, []);
});

check("parseEntity: a parenthetical with nothing before it is not split (whole string stays primary)", () => {
  const parsed = parseEntity("(just a parenthetical)");
  assert.equal(parsed.primary, "(just a parenthetical)");
  assert.deepEqual(parsed.aliases, []);
});

// --- QD10: the 12 audited cases (QA-11), permanent regression -------------

check("QD10 case 1 (real, exact full phrase): 'Ground beef' present verbatim -> full", () => {
  const body =
    "For the best flavor, use a mix of ground beef and ground pork. Beef gives the sauce a hearty, savory base, while pork adds fat that keeps the meat tender and rich.";
  const result = evaluateEntityCoverage(body, "Ground beef");
  assert.equal(result.coverage, "full");
});

check("QD10 case 2 (real, primary + parenthetical alias, primary matches): 'Bolognese sauce (ragu alla bolognese)' -> full via primary", () => {
  const body =
    "Bolognese sauce needs to simmer for at least 45 minutes, but an hour and a half to two hours will give you a richer, deeper flavor.";
  const result = evaluateEntityCoverage(body, "Bolognese sauce (ragu alla bolognese)");
  assert.equal(result.coverage, "full");
  assert.equal(result.matchedOn, "Bolognese sauce");
});

check("QD10 case 3 (real, alias present, primary's exact phrase absent but its own words are individually present): 'Bolognese sauce (ragu alla bolognese)' -> full via order-independent primary word coverage", () => {
  const body =
    "The short answer is: it depends on where you are. In Bologna, Italy, the traditional meat sauce is called ragu alla bolognese, and it is typically served with tagliatelle pasta, not spaghetti.";
  const result = evaluateEntityCoverage(body, "Bolognese sauce (ragu alla bolognese)");
  // The literal contiguous phrase "Bolognese sauce" never appears, but
  // both of its significant words ("bolognese", "sauce") are present
  // independently elsewhere in the body ("...meat sauce is called
  // ragu alla bolognese...") -> full via order-independent primary
  // coverage, QD10's own core fix — no contiguity/adjacency required.
  assert.equal(result.coverage, "full");
  assert.equal(result.matchedOn, "Bolognese sauce");
});

check("QD10: alias-only coverage (primary's own words genuinely absent) still satisfies full, per parseEntity's unchanged 'primary or alias' contract", () => {
  const body = "In Emilia-Romagna, this dish is traditionally called ragu alla bolognese and served with tagliatelle.";
  const result = evaluateEntityCoverage(body, "Bolognese sauce (ragu alla bolognese)");
  // Primary "Bolognese sauce" -> only "bolognese" present, "sauce" is
  // genuinely absent from this body -> primary alone is partial.
  // Alias "ragu alla bolognese" -> all 3 of its own words present ->
  // full. Best-of correctly resolves to full via the alias — a
  // deliberate, documented change from the pre-QD10 behavior, which
  // always capped an alias-only match at "partial" regardless of how
  // completely the alias itself was covered.
  assert.equal(result.coverage, "full");
  assert.equal(result.matchedOn, "ragu alla bolognese");
});

check("QD10 case 4 (real, the original audited bug — multi-word entity split across clauses/sentences): 'Pasta cooking techniques' -> partial, not FAIL", () => {
  const body =
    "When most Americans think of bolognese, spaghetti is the first pasta that comes to mind. It is widely available, easy to cook, and works well with a thick, meaty sauce. If you want a simple tip for choosing pasta: flat or ridged shapes tend to hold a hearty sauce better than very thin or smooth noodles. Whatever shape you pick, cook it to al dente (firm with a slight bite) for the best texture when tossed with the sauce.";
  const result = evaluateEntityCoverage(body, "Pasta cooking techniques");
  assert.equal(result.coverage, "partial", "only 'pasta' of the 3 significant words is present -> partial, an honest WARN instead of the old false FAIL");
});

check("QD10 case 5 (synthetic, word order changed): 'Tomato paste' vs. 'paste made from tomatoes' -> full, order-independent", () => {
  const body = "The paste made from tomatoes is a key flavor builder in this sauce.";
  const result = evaluateEntityCoverage(body, "Tomato paste");
  assert.equal(result.coverage, "full");
});

check("QD10 case 6 (real, false-positive stress test — one generic token only): 'Italian cuisine' where only 'Italian' appears -> partial, never full", () => {
  const body =
    "That said, other pasta shapes also pair beautifully with bolognese. Tagliatelle, a broad flat ribbon pasta, is often cited as a more traditional Italian pairing for a rich meat ragu.";
  const result = evaluateEntityCoverage(body, "Italian cuisine");
  assert.equal(result.coverage, "partial", "a single generic token ('Italian') must never alone produce a false full/PASS");
});

check("QD10 case 7 (synthetic, false-positive stress test — two generic tokens only): 'Fresh basil garnish' where only 'fresh'/'garnish' appear, 'basil' absent -> partial, never full", () => {
  const body = "Finish the dish with a fresh, simple garnish of your choice for a bright, appealing plate.";
  const result = evaluateEntityCoverage(body, "Fresh basil garnish");
  assert.equal(result.coverage, "partial", "generic words alone (2 of 3) must never cross into full when the one specific, defining word is absent");
});

check("QD10 case 8 (real, fully absent): 'Ground beef' in a section with zero meat mentions -> none", () => {
  const body =
    "Pour in about half a cup of red or white wine and stir to combine. Let it bubble over medium-high heat for 2 to 3 minutes. This gives the alcohol time to cook off, leaving behind only the wine's rich, savory flavor.";
  const result = evaluateEntityCoverage(body, "Ground beef");
  assert.equal(result.coverage, "none");
  assert.equal(result.matchedOn, null);
});

check("QD10 case 9 (real, Markdown formatting around the match): 'Soffritto (onion, celery, carrot)' inside bold Markdown -> full", () => {
  const body =
    "Here is what to prep ahead of time:\n\n- **Soffritto base:** finely dice one onion, two celery stalks, and one carrot\n- **Meat and aromatics:** measure out your ground meat and mince any garlic";
  const result = evaluateEntityCoverage(body, "Soffritto (onion, celery, carrot)");
  assert.equal(result.coverage, "full");
});

check("QD10 case 10 (synthetic, one-word entity — unchanged-behavior control): 'Parmesan' present -> full, absent -> none, identical to pre-QD10", () => {
  const present = evaluateEntityCoverage("Stir in freshly grated Parmesan just before serving.", "Parmesan");
  assert.equal(present.coverage, "full");
  const absent = evaluateEntityCoverage("This section covers something else entirely.", "Parmesan");
  assert.equal(absent.coverage, "none");
});

check("QD10 case 11 (synthetic, long 4+ word entity missing one minor word): 'San Marzano canned whole tomatoes' missing only 'whole' -> partial (accepted conservative trade-off)", () => {
  const body =
    "San Marzano tomatoes are a popular choice because they tend to be sweeter and less acidic than other canned varieties. That natural sweetness balances the meat and wine beautifully.";
  const result = evaluateEntityCoverage(body, "San Marzano canned whole tomatoes");
  assert.equal(
    result.coverage,
    "partial",
    "3 of 4 significant words present ('whole' missing) -> partial, not full — the documented, accepted QD10 trade-off (conservative WARN over a risked false PASS)",
  );
});

check("QD10 case 12 (real, false-negative regression control): genuinely absent entity stays FAIL-worthy even under the relaxed rule", () => {
  const body =
    "Heat a drizzle of olive oil in a large pan over medium-low heat. Add your diced onion, celery, and carrot (the soffritto) and cook gently for about 8 to 10 minutes, stirring often, until the vegetables are soft and just starting to turn golden.";
  const result = evaluateEntityCoverage(body, "Ground beef");
  assert.equal(result.coverage, "none", "QD10 must not over-relax to the point a genuinely absent entity stops failing");
});

// --- True "partial" case: some, but not all, words of any single representation present ---

check("QD10: a representation with some but not all of its own significant words present is 'partial', matchedOn names the best-covered representation", () => {
  // Neither the full primary ("Bolognese sauce") nor the full alias
  // ("ragu alla bolognese") is present — only the shared word
  // "bolognese" appears, satisfying 1 of 2 primary words and 1 of 3
  // alias words. Best-of is the primary (tied rank, evaluated first).
  const body = "This dish is a bolognese classic, loved by home cooks everywhere.";
  const result = evaluateEntityCoverage(body, "Bolognese sauce (ragu alla bolognese)");
  assert.equal(result.coverage, "partial");
  assert.equal(result.matchedOn, "Bolognese sauce");
});

// --- an entity with no alias behaves exactly as before -------------------

check("an entity with no parenthetical: present -> full, absent -> none (unchanged pre-LEAVES-01/QD10 behavior)", () => {
  const present = evaluateEntityCoverage("The crowded bar test is a simple way to validate a business name.", "Crowded bar test");
  assert.equal(present.coverage, "full");

  const absent = evaluateEntityCoverage("This section covers something else entirely.", "Crowded bar test");
  assert.equal(absent.coverage, "none");
});

console.log(`\n${passed} check(s) passed.`);
