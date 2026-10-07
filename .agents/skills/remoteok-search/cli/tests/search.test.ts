import { describe, test, expect } from "bun:test";
import { runCLI, parseJSON } from "./helpers";

// Live smoke test against the real remoteok.com API — kept minimal (one search,
// one detail lookup) per add-portal.md's "keep volume low" rule.

interface SearchResult {
  id: string;
  title: string;
  company: string | null;
  url: string;
}
interface SearchResponse {
  meta: { count: number };
  results: SearchResult[];
}

describe("remoteok CLI live smoke test", () => {
  test("search returns real results with populated id/title/url", async () => {
    const result = await runCLI(["search", "--tag", "python", "--limit", "5", "--format", "json"]);
    const data = parseJSON<SearchResponse>(result);
    expect(data.results.length).toBeGreaterThan(0);
    for (const r of data.results) {
      expect(r.id).toBeTruthy();
      expect(r.title).toBeTruthy();
      // RemoteOK's own API returns URLs with inconsistent domain casing
      // ("remoteOK.com" on some entries) — not a bug in this CLI to "fix".
      expect(r.url.toLowerCase()).toContain("remoteok.com");
    }
  }, 30000);

  test("detail returns the exact job requested, not an unrelated one", async () => {
    const search = await runCLI(["search", "--tag", "python", "--limit", "1", "--format", "json"]);
    const { results } = parseJSON<SearchResponse>(search);
    const target = results[0];

    const detail = await runCLI(["detail", target.id, "--format", "json"]);
    const job = parseJSON<SearchResult & { description: string | null }>(detail);
    expect(job.id).toBe(target.id);
    expect(job.title).toBe(target.title);
    expect(job.description).toBeTruthy();
  }, 30000);
});
