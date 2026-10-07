import { describe, expect, test } from "bun:test";
import { cleanHtml, toResult, toDetail, type RemoteOkJob } from "../src/helpers.js";

describe("cleanHtml", () => {
  test("strips tags and decodes entities", () => {
    expect(cleanHtml("<p>Build &amp; ship <strong>fast</strong></p>")).toBe("Build & ship fast");
  });

  test("converts <br> and block closings to newlines", () => {
    expect(cleanHtml("Line one<br>Line two</p>Line three")).toBe("Line one\nLine two\nLine three");
  });

  test("fixes CP1252-as-UTF-8 mojibake (smart quote, en dash, emoji)", () => {
    expect(cleanHtml("Delineaâ€™s platform")).toBe("Delinea’s platform");
    expect(cleanHtml("EUR 53,000 â€“ 59,000")).toBe("EUR 53,000 – 59,000");
  });

  test("leaves already-correct UTF-8 untouched", () => {
    expect(cleanHtml("Café team, no‑nonsense")).toBe("Café team, no‑nonsense");
  });

  test("null/empty input returns null", () => {
    expect(cleanHtml(null)).toBeNull();
    expect(cleanHtml("")).toBeNull();
  });
});

function job(overrides: Partial<RemoteOkJob> = {}): RemoteOkJob {
  return {
    id: "123",
    slug: "example-job-123",
    date: "2026-01-01T00:00:00+00:00",
    company: "Acme",
    position: "Engineer",
    tags: ["python"],
    location: "Remote",
    description: "<p>Build things</p>",
    url: "https://remoteok.com/remote-jobs/example-job-123",
    ...overrides,
  };
}

describe("toResult / toDetail", () => {
  test("toResult omits description, toDetail includes the cleaned text", () => {
    const j = job();
    expect(toResult(j).description).toBeNull();
    expect(toDetail(j).description).toBe("Build things");
  });

  test("falls back to a constructed URL when url is missing", () => {
    const r = toResult(job({ url: "" }));
    expect(r.url).toContain("example-job-123");
  });

  test("formats a salary range, a single value, or null", () => {
    expect(toResult(job({ salary_min: 100000, salary_max: 150000 })).salary).toBe("$100,000–$150,000");
    expect(toResult(job({ salary_min: 100000 })).salary).toBe("$100,000");
    expect(toResult(job({})).salary).toBeNull();
  });
});
