export interface LinkRelation {
  readonly url: string;
  readonly relations: readonly string[];
  readonly parameters: Readonly<Record<string, string>>;
}

/**
 * Splits a header string on a delimiter while ignoring delimiters enclosed in quotes or angle brackets.
 */
function splitOutsideDelimiters(value: string, delimiter: string): string[] {
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
  parts.push(value.slice(start));
  return parts;
}

/**
 * Removes outer matching quotes and resolves escaped characters.
 */
function unquote(value: string): string {
  const trimmed = value.trim();
  if (trimmed.startsWith('"') && trimmed.endsWith('"') && trimmed.length >= 2) {
    return trimmed.slice(1, -1).replace(/\\([\\"])/g, "$1");
  }
  return trimmed;
}

/**
 * Focused RFC 8288-compatible parser for GitHub pagination Link headers.
 * Extracts URLs and link parameters, handling quoting and relation normalization.
 */
export function parseLinkHeader(header: string | null | undefined): LinkRelation[] {
  if (!header?.trim()) return [];

  return splitOutsideDelimiters(header, ",").flatMap((entry) => {
    const segments = splitOutsideDelimiters(entry, ";");
    const target = segments.shift()?.trim().match(/^<([^>]*)>$/)?.[1];
    if (!target) return [];

    const parameters: Record<string, string> = {};
    for (const segment of segments) {
      const separator = segment.indexOf("=");
      if (separator < 1) continue;
      const name = segment.slice(0, separator).trim().toLowerCase();
      if (name) {
        parameters[name] = unquote(segment.slice(separator + 1));
      }
    }
    const relations = (parameters["rel"] ?? "")
      .split(/\s+/)
      .map((r) => r.trim().toLowerCase())
      .filter(Boolean);

    return [{ url: target, relations, parameters }];
  });
}

/**
 * Extracts the `rel="next"` URL from a Link header, if present.
 * Returns undefined if the header is absent, does not contain a next relation,
 * or contains multiple next relations (rejecting ambiguity).
 */
export function getNextLink(header: string | null | undefined): string | undefined {
  const links = parseLinkHeader(header);
  const nextLinks = links.filter(({ relations }) => relations.includes("next"));
  if (nextLinks.length !== 1) return undefined;
  return nextLinks[0]?.url;
}
