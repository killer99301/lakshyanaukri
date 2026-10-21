// Choosing a state on the jobs page
//   npx tsx --tsconfig tsconfig.json tests/cms/state-filter.test.ts
import { suite, test, assert } from "../intelligence/suite";
import type { Opportunity } from "@/types";
import { applyLocationFilter, isNationwide, stateCounts, stateKey } from "@/lib/filters";

const job = (slug: string, state: string) => ({ slug, state }) as unknown as Opportunity;
const JOBS = [job("jkssb", "Jammu and Kashmir"), job("dsssb", "Delhi"), job("bpsc", "Bihar"), job("btsc", "Bihar"), job("rrb", "All India"), job("ssc", "Pan India")];
const slugs = (loc: string) => applyLocationFilter(JOBS, loc).map((j) => j.slug).sort();

suite("State filter");

test("SF01 the picker's spelling finds the job's spelling", () => {
  assert.equal(stateKey("Jammu & Kashmir"), stateKey("Jammu and Kashmir"));
  assert.equal(stateKey("Delhi NCR"), stateKey("Delhi"));
  assert.equal(stateKey("NCT of Delhi"), stateKey("Delhi"));
  assert.notEqual(stateKey("Bihar"), stateKey("Delhi"));
});

test("SF02 a chosen state shows its jobs and the nationwide ones; All India shows everything", () => {
  assert.deepEqual(slugs("Jammu & Kashmir"), ["jkssb", "rrb", "ssc"]);
  assert.deepEqual(slugs("Delhi NCR"), ["dsssb", "rrb", "ssc"]);
  assert.deepEqual(slugs("Bihar"), ["bpsc", "btsc", "rrb", "ssc"]);
  assert.deepEqual(slugs("Kerala"), ["rrb", "ssc"]);
  assert.equal(slugs("All India").length, 6);
  assert.equal(slugs("").length, 6);
});

test("SF03 counts per state, nationwide jobs counted apart", () => {
  const { byState, nationwide } = stateCounts(JOBS);
  assert.equal(byState.get(stateKey("Bihar")), 2);
  assert.equal(byState.get(stateKey("Jammu & Kashmir")), 1);
  assert.equal(nationwide, 2);
  assert.equal(isNationwide("All India"), true);
  assert.equal(isNationwide("pan-india"), true);
  assert.equal(isNationwide("Bihar"), false);
});
