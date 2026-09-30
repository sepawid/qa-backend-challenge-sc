import {
  page1Fixture,
  page2Fixture,
  page3Fixture,
} from "./fixtures/github-pulls-pages.js";

/**
 * Creates a deterministic fetch implementation simulating 3 paginated pages from GitHub API.
 */
export function createFixtureFetch(): typeof fetch {
  return async (input: RequestInfo | URL) => {
    const rawUrl = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
    const parsed = new URL(rawUrl);
    const page = parsed.searchParams.get("page");

    if (page === null || page === "1") {
      return new Response(JSON.stringify(page1Fixture), {
        status: 200,
        headers: {
          "content-type": "application/json",
          link: '<https://api.github.com/repos/appwrite/appwrite/pulls?state=open&per_page=100&sort=created&direction=asc&page=2>; rel="next"',
          "x-ratelimit-remaining": "59",
        },
      });
    }

    if (page === "2") {
      return new Response(JSON.stringify(page2Fixture), {
        status: 200,
        headers: {
          "content-type": "application/json",
          link: '<https://api.github.com/repos/appwrite/appwrite/pulls?state=open&per_page=100&sort=created&direction=asc&page=3>; rel="next"',
          "x-ratelimit-remaining": "58",
        },
      });
    }

    return new Response(JSON.stringify(page3Fixture), {
      status: 200,
      headers: {
        "content-type": "application/json",
        "x-ratelimit-remaining": "57",
      },
    });
  };
}
