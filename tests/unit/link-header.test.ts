import { describe, expect, it } from "vitest";
import { getNextLink, parseLinkHeader, resolveNextLink } from "../../src/core/link-header.js";

describe("Core: link-header parser", () => {
  it("returns empty array / undefined / kind:none for null, undefined, or empty header", () => {
    expect(parseLinkHeader(null)).toEqual([]);
    expect(parseLinkHeader(undefined)).toEqual([]);
    expect(parseLinkHeader("")).toEqual([]);
    expect(parseLinkHeader("   ")).toEqual([]);

    expect(getNextLink(null)).toBeUndefined();
    expect(getNextLink(undefined)).toBeUndefined();
    expect(getNextLink("")).toBeUndefined();
    expect(resolveNextLink(null)).toEqual({ kind: "none" });
  });

  it("extracts a single rel=next link", () => {
    const header = '<https://api.github.com/repositories/123/pulls?page=2>; rel="next"';
    const parsed = parseLinkHeader(header);

    expect(parsed).toHaveLength(1);
    expect(parsed[0]?.url).toBe("https://api.github.com/repositories/123/pulls?page=2");
    expect(parsed[0]?.relations).toEqual(["next"]);
    expect(getNextLink(header)).toBe("https://api.github.com/repositories/123/pulls?page=2");
    expect(resolveNextLink(header)).toEqual({
      kind: "next",
      url: "https://api.github.com/repositories/123/pulls?page=2",
    });
  });

  it("preserves first rel occurrence when rel is repeated per RFC 8288 §3.3", () => {
    const header = '<https://api.github.com/repositories/123/pulls?page=2>; rel="next"; rel="last"';
    const parsed = parseLinkHeader(header);

    expect(parsed[0]?.relations).toEqual(["next"]);
    expect(resolveNextLink(header)).toEqual({
      kind: "next",
      url: "https://api.github.com/repositories/123/pulls?page=2",
    });
    expect(getNextLink(header)).toBe("https://api.github.com/repositories/123/pulls?page=2");
  });

  it("decodes quoted-pairs in parameters per RFC 8288 Appendix B.4", () => {
    const header = '<https://api.github.com/repositories/123/pulls?page=2>; rel="ne\\xt"';
    const parsed = parseLinkHeader(header);

    expect(parsed[0]?.relations).toEqual(["next"]);
    expect(resolveNextLink(header)).toEqual({
      kind: "next",
      url: "https://api.github.com/repositories/123/pulls?page=2",
    });
  });

  it("flags malformed header with unclosed angle bracket as malformed", () => {
    const unclosedTarget = '<https://api.github.com/repos/appwrite/appwrite/pulls?page=2; rel="next"';
    const resolved = resolveNextLink(unclosedTarget);

    expect(resolved.kind).toBe("malformed");
    expect(getNextLink(unclosedTarget)).toBeUndefined();
  });

  it("flags malformed header with unclosed quote as malformed", () => {
    const unclosedQuote = '<https://api.github.com/repositories/123/pulls?page=2>; rel="next';
    const resolved = resolveNextLink(unclosedQuote);

    expect(resolved.kind).toBe("malformed");
    expect(getNextLink(unclosedQuote)).toBeUndefined();
  });

  it("flags malformed segment without valid angle-bracket target as malformed", () => {
    const malformed = 'invalid-entry; rel="next", <https://api.github.com/repositories/123/pulls?page=2>; rel="next"';
    const resolved = resolveNextLink(malformed);

    expect(resolved.kind).toBe("malformed");
    expect(getNextLink(malformed)).toBeUndefined();
  });

  it("extracts next link when multiple relations exist in arbitrary order", () => {
    const header = [
      '<https://api.github.com/repositories/123/pulls?page=1>; rel="prev"',
      '<https://api.github.com/repositories/123/pulls?page=3>; rel="next"',
      '<https://api.github.com/repositories/123/pulls?page=10>; rel="last"',
    ].join(", ");

    const links = parseLinkHeader(header);
    expect(links).toHaveLength(3);
    expect(getNextLink(header)).toBe("https://api.github.com/repositories/123/pulls?page=3");
  });

  it("handles multiple space-separated relations in a single rel parameter", () => {
    const header = '<https://api.github.com/repositories/123/pulls?page=2>; rel="next last"';
    const parsed = parseLinkHeader(header);

    expect(parsed[0]?.relations).toEqual(["next", "last"]);
    expect(getNextLink(header)).toBe("https://api.github.com/repositories/123/pulls?page=2");
  });

  it("preserves delimiters enclosed in quoted parameters", () => {
    const header = '<https://api.github.com/repositories/123/pulls?page=2>; rel="next"; title="foo, bar; baz"';
    const parsed = parseLinkHeader(header);

    expect(parsed).toHaveLength(1);
    expect(parsed[0]?.parameters["title"]).toBe("foo, bar; baz");
    expect(getNextLink(header)).toBe("https://api.github.com/repositories/123/pulls?page=2");
  });

  it("handles unquoted rel parameters gracefully", () => {
    const header = "<https://api.github.com/repositories/123/pulls?page=2>; rel=next";
    expect(getNextLink(header)).toBe("https://api.github.com/repositories/123/pulls?page=2");
  });

  it("returns kind: none when rel=next is not present in a valid header", () => {
    const header = '<https://api.github.com/repositories/123/pulls?page=1>; rel="first", <https://api.github.com/repositories/123/pulls?page=2>; rel="prev"';
    expect(getNextLink(header)).toBeUndefined();
    expect(resolveNextLink(header)).toEqual({ kind: "none" });
  });

  it("resolves relative URI references against currentUrl", () => {
    const currentUrl = "https://api.github.com/repos/appwrite/appwrite/pulls?state=open&per_page=100&sort=created&direction=asc&page=1";
    const header = '<?state=open&per_page=100&sort=created&direction=asc&page=2>; rel="next"';

    const resolved = resolveNextLink(header, currentUrl);
    expect(resolved).toEqual({
      kind: "next",
      url: "https://api.github.com/repos/appwrite/appwrite/pulls?state=open&per_page=100&sort=created&direction=asc&page=2",
    });
  });

  it("ignores foreign anchor parameter per RFC 8288 §3.2 and avoids false ambiguity", () => {
    const currentUrl = "https://api.github.com/repos/appwrite/appwrite/pulls?page=1";
    const header = [
      '<https://api.github.com/repos/appwrite/appwrite/pulls?page=2>; rel="next"',
      '<https://api.github.com/other>; rel="next"; anchor="https://example.com/another-resource"',
    ].join(", ");

    const resolved = resolveNextLink(header, currentUrl);
    expect(resolved).toEqual({
      kind: "next",
      url: "https://api.github.com/repos/appwrite/appwrite/pulls?page=2",
    });
  });

  it("identifies ambiguous headers with multiple conflicting rel=next links in current context", () => {
    const header = [
      '<https://api.github.com/repositories/123/pulls?page=2>; rel="next"',
      '<https://api.github.com/repositories/123/pulls?page=3>; rel="next"',
    ].join(", ");

    const resolved = resolveNextLink(header);
    expect(resolved).toEqual({
      kind: "ambiguous",
      urls: [
        "https://api.github.com/repositories/123/pulls?page=2",
        "https://api.github.com/repositories/123/pulls?page=3",
      ],
    });
    expect(getNextLink(header)).toBeUndefined();
  });

  it("deduplicates identical rel=next links and treats them as unambiguous", () => {
    const header = [
      '<https://api.github.com/repositories/123/pulls?page=2>; rel="next"',
      '<https://api.github.com/repositories/123/pulls?page=2>; rel="next"',
    ].join(", ");

    const resolved = resolveNextLink(header);
    expect(resolved).toEqual({
      kind: "next",
      url: "https://api.github.com/repositories/123/pulls?page=2",
    });
    expect(getNextLink(header)).toBe("https://api.github.com/repositories/123/pulls?page=2");
  });
});
