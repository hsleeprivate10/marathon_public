import type { FetchRejection } from "./fetch.js";

export type TraversalRejectionBucket = "policy" | "fetch";

export function traversalRejectionBucket(reason: FetchRejection): TraversalRejectionBucket {
  switch (reason) {
    case "invalid-url":
    case "unsupported-protocol":
    case "credentials":
    case "blocked-hostname":
    case "blocked-address":
    case "unsafe-public-url":
    case "dns-failure":
      return "policy";
    case "too-many-redirects":
    case "missing-redirect-location":
    case "http-status":
    case "unsupported-content-type":
    case "body-too-large":
      return "fetch";
    default:
      return assertNever(reason);
  }
}

function assertNever(value: never): never {
  throw new Error(`Unexpected traversal rejection: ${JSON.stringify(value)}`);
}
