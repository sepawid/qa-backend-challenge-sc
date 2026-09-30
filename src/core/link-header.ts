export interface LinkRelation {
  readonly url: string;
  readonly relations: readonly string[];
  readonly parameters: Readonly<Record<string, string>>;
}

export type ResolvedNextLink =
  | { readonly kind: "none" }
  | { readonly kind: "next"; readonly url: string }
  | { readonly kind: "ambiguous"; readonly urls: readonly string[] }
  | { readonly kind: "malformed"; readonly error: string };

interface SplitResult {
  readonly parts: string[];
  readonly malformed?: string | undefined;
}

/**
 * Splits a header string on a delimiter while ignoring delimiters enclosed in quotes or angle brackets.
 * Returns malformed error if quotes or angle brackets are unclosed.
 */
function splitOutsideDelimiters(value: string, delimiter: string): SplitResult {
  const parts: string[] = [];
  let start = 0;
  let quoted = false;
  let angled = false;
  let escaped = false;

  for (let index = 0; index < value.length; index += 1) {
    const character = value[index];
    if (escaped) {
      escaped = false;
    } else if (character === "\\" && quoted) {
      escaped = true;
    } else if (character === '"') {
      quoted = !quoted;
    } else if (!quoted && character === "<") {
      angled = true;
    } else if (!quoted && character === ">") {
      angled = false;
    } else if (!quoted && !angled && character === delimiter) {
      parts.push(value.slice(start, index));
      start = index + 1;
    }
  }

  if (quoted) {
    return { parts: [], malformed: "Unclosed quote in Link header" };
  }
  if (angled) {
    return { parts: [], malformed: "Unclosed angle bracket in Link header" };
  }

  parts.push(value.slice(start));
  return { parts };
}

/**
 * Removes outer matching quotes and resolves quoted-pair escapes per RFC 8288 / RFC 7230 §3.2.6.
 */
function unquote(value: string): string {
  const trimmed = value.trim();
  if (trimmed.startsWith('"') && trimmed.endsWith('"') && trimmed.length >= 2) {
    return trimmed.slice(1, -1).replace(/\\([\s\S])/g, "$1");
  }
  return trimmed;
}

export interface ParseLinkHeaderResult {
  readonly links: readonly LinkRelation[];
  readonly malformed?: string | undefined;
}

/**
 * Internal RFC 8288 Link header parser returning parsed links and error status.
 */
export function parseLinkHeaderDetailed(header: string | null | undefined): ParseLinkHeaderResult {
  if (header === null || header === undefined || !header.trim()) {
    return { links: [] };
  }

  const splitEntries = splitOutsideDelimiters(header, ",");
  if (splitEntries.malformed) {
    return { links: [], malformed: splitEntries.malformed };
  }

  const links: LinkRelation[] = [];

  for (const entry of splitEntries.parts) {
    const trimmedEntry = entry.trim();
    if (!trimmedEntry) continue; // RFC 7230 empty list element

    const segmentSplit = splitOutsideDelimiters(trimmedEntry, ";");
    if (segmentSplit.malformed) {
      return { links: [], malformed: segmentSplit.malformed };
    }

    const segments = segmentSplit.parts;
    const rawTarget = segments.shift()?.trim();
    if (!rawTarget || !rawTarget.startsWith("<") || !rawTarget.endsWith(">") || rawTarget.length < 2) {
      return {
        links: [],
        malformed: `Invalid link target format in "${trimmedEntry}": missing enclosing angle brackets <...>`,
      };
    }

    const targetUri = rawTarget.slice(1, -1).trim();
    if (!targetUri) {
      return {
        links: [],
        malformed: `Empty link URI reference in "${trimmedEntry}"`,
      };
    }

    const parameters: Record<string, string> = {};
    for (const segment of segments) {
      const trimmedSegment = segment.trim();
      if (!trimmedSegment) continue;

      const separator = trimmedSegment.indexOf("=");
      if (separator < 0) {
        const name = trimmedSegment.toLowerCase();
        if (name && !(name in parameters)) {
          parameters[name] = "";
        }
      } else {
        const name = trimmedSegment.slice(0, separator).trim().toLowerCase();
        const rawValue = trimmedSegment.slice(separator + 1).trim();
        if (!name) {
          return {
            links: [],
            malformed: `Invalid link parameter without name in "${trimmedEntry}"`,
          };
        }
        if (rawValue.startsWith('"') && (!rawValue.endsWith('"') || rawValue.length < 2)) {
          return {
            links: [],
            malformed: `Unclosed quote in parameter "${name}" in "${trimmedEntry}"`,
          };
        }
        // RFC 8288 §3.3: First parameter occurrence takes precedence, subsequent ignored
        if (!(name in parameters)) {
          parameters[name] = unquote(rawValue);
        }
      }
    }

    const relations = (parameters["rel"] ?? "")
      .split(/\s+/)
      .map((r) => r.trim().toLowerCase())
      .filter(Boolean);

    links.push({ url: targetUri, relations, parameters });
  }

  return { links };
}

/**
 * Focused RFC 8288-compatible parser for GitHub pagination Link headers.
 * Extracts URLs and link parameters, handling quoting and relation normalization.
 */
export function parseLinkHeader(header: string | null | undefined): LinkRelation[] {
  return [...parseLinkHeaderDetailed(header).links];
}

/**
 * Resolves the `rel="next"` URL from a Link header, taking into account representation context (currentUrl).
 * Handles:
 * - RFC 8288 §3.3: First occurrence of rel parameter wins.
 * - RFC 8288 Appendix B.4: quoted-pair decoding.
 * - RFC 8288 §3.1-3.2: link anchor context filtering (foreign anchors are ignored for current representation).
 * - RFC 3986 §5: relative URL resolution against currentUrl.
 * - Deduplication of identical next URLs.
 */
export function resolveNextLink(
  header: string | null | undefined,
  currentUrl?: string,
): ResolvedNextLink {
  if (header === null || header === undefined || !header.trim()) {
    return { kind: "none" };
  }

  const detailed = parseLinkHeaderDetailed(header);
  if (detailed.malformed) {
    return { kind: "malformed", error: detailed.malformed };
  }

  let currentNormalized: string | undefined;
  if (currentUrl) {
    try {
      currentNormalized = new URL(currentUrl).toString();
    } catch {
      currentNormalized = undefined;
    }
  }

  const candidateUrls: string[] = [];

  for (const link of detailed.links) {
    // RFC 8288 §3.2 anchor handling:
    // If anchor parameter is present, verify if it targets the current representation.
    const anchorParam = link.parameters["anchor"];
    if (anchorParam !== undefined && currentNormalized !== undefined) {
      let resolvedAnchor: string;
      try {
        resolvedAnchor = new URL(anchorParam, currentNormalized).toString();
      } catch {
        return { kind: "malformed", error: `Invalid anchor URI reference: "${anchorParam}"` };
      }
      if (resolvedAnchor !== currentNormalized) {
        // Link is anchored to another resource; not relevant for paginating current resource
        continue;
      }
    }

    if (link.relations.includes("next")) {
      let resolvedUrl: string;
      if (currentNormalized !== undefined) {
        try {
          resolvedUrl = new URL(link.url, currentNormalized).toString();
        } catch {
          return { kind: "malformed", error: `Invalid next URI reference: "${link.url}"` };
        }
      } else {
        resolvedUrl = link.url;
      }
      candidateUrls.push(resolvedUrl);
    }
  }

  const uniqueNextUrls = Array.from(new Set(candidateUrls));

  if (uniqueNextUrls.length === 0) {
    return { kind: "none" };
  }

  const [firstUrl] = uniqueNextUrls;
  if (uniqueNextUrls.length === 1 && firstUrl !== undefined) {
    return { kind: "next", url: firstUrl };
  }

  return { kind: "ambiguous", urls: uniqueNextUrls };
}

/**
 * Extracts the `rel="next"` URL from a Link header, if present and unambiguous.
 * Returns undefined if absent, not present, ambiguous, or malformed.
 */
export function getNextLink(
  header: string | null | undefined,
  currentUrl?: string,
): string | undefined {
  const resolved = resolveNextLink(header, currentUrl);
  return resolved.kind === "next" ? resolved.url : undefined;
}
