import { describe, expect, it } from "vitest";
import { getNextLink, parseLinkHeader } from "../../src/core/link-header.js";

describe("Core: link-header parser", () => {
  it("returns empty array / undefined for null, undefined, or empty header", () => {
    expect(parseLinkHeader(null)).toEqual([]);
    expect(parseLinkHeader(undefined)).toEqual([]);
    expect(parseLinkHeader("")).toEqual([]);
    expect(parseLinkHeader("   ")).toEqual([]);

    expect(getNextLink(null)).toBeUndefined();
    expect(getNextLink(undefined)).toBeUndefined();
    expect(getNextLink("")).toBeUndefined();
  });

  it("extracts a single rel=next link", () => {
    const header = '<https://api.github.com/repositories/123/pulls?page=2>; rel="next"';
    const parsed = parseLinkHeader(header);

    expect(parsed).toHaveLength(1);
    expect(parsed[0]?.url).toBe("https://api.github.com/repositories/123/pulls?page=2");
    expect(parsed[0]?.relations).toEqual(["next"]);
    expect(getNextLink(header)).toBe("https://api.github.com/repositories/123/pulls?page=2");
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

  it("returns undefined when rel=next is not present", () => {
    const header = '<https://api.github.com/repositories/123/pulls?page=1>; rel="first", <https://api.github.com/repositories/123/pulls?page=2>; rel="prev"';
    expect(getNextLink(header)).toBeUndefined();
  });

  it("ignores malformed segments without valid angle-bracket target", () => {
    const header = 'invalid-entry; rel="next", <https://api.github.com/repositories/123/pulls?page=2>; rel="next"';
    expect(getNextLink(header)).toBe("https://api.github.com/repositories/123/pulls?page=2");
  });

  it("rejects ambiguous headers with two conflicting rel=next links", () => {
    const header = [
      '<https://api.github.com/repositories/123/pulls?page=2>; rel="next"',
      '<https://api.github.com/repositories/123/pulls?page=3>; rel="next"',
    ].join(", ");

    // Multiple next links are ambiguous — function must reject by returning undefined
    expect(getNextLink(header)).toBeUndefined();

    // But parseLinkHeader should still parse both entries
    const links = parseLinkHeader(header);
    expect(links).toHaveLength(2);
  });
});
