import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { GitHubPullRequestClient } from "../../src/core/github-client.js";
import { SchemaValidationError, TransportError } from "../../src/core/errors.js";

describe("Integration: Transport vs Schema Error Separation (Point 5)", () => {
  let server: Server;
  let serverPort: number;

  beforeEach(async () => {
    await new Promise<void>((resolve) => {
      server = createServer();
      server.listen(0, "127.0.0.1", () => {
        serverPort = (server.address() as AddressInfo).port;
        resolve();
      });
    });
  });

  afterEach(async () => {
    await new Promise<void>((resolve) => {
      server.close(() => resolve());
    });
  });

  it("throws TransportError (code 3) when socket drops or times out while reading response body", async () => {
    server.on("request", (_req, res) => {
      // Send 200 OK headers and partial chunk, then do not finish
      res.writeHead(200, { "Content-Type": "application/json" });
      res.write("[\n");
      // Do not call res.end() - let client timeout trigger
    });

    const client = new GitHubPullRequestClient({
      endpoint: `http://127.0.0.1:${serverPort}/repos/appwrite/appwrite/pulls`,
      timeoutMs: 100,
    });

    await expect(client.fetchAllOpenPullRequests()).rejects.toThrow(TransportError);
  });

  it("throws SchemaValidationError (code 4) when response body completes but contains invalid JSON syntax", async () => {
    server.on("request", (_req, res) => {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end("Not valid JSON at all {{{");
    });

    const client = new GitHubPullRequestClient({
      endpoint: `http://127.0.0.1:${serverPort}/repos/appwrite/appwrite/pulls`,
      timeoutMs: 1000,
    });

    await expect(client.fetchAllOpenPullRequests()).rejects.toThrow(SchemaValidationError);
  });

  it("throws SchemaValidationError (code 4) when response body is valid JSON but fails schema validation", async () => {
    server.on("request", (_req, res) => {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify([{ invalid_pull_request: true }]));
    });

    const client = new GitHubPullRequestClient({
      endpoint: `http://127.0.0.1:${serverPort}/repos/appwrite/appwrite/pulls`,
      timeoutMs: 1000,
    });

    await expect(client.fetchAllOpenPullRequests()).rejects.toThrow(SchemaValidationError);
  });
});
