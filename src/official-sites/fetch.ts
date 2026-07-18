import { type IncomingHttpHeaders, request as httpRequest } from "node:http";
import { request as httpsRequest } from "node:https";
import type { LookupFunction } from "node:net";
import { USER_AGENT } from "../adapters/types.js";
import { OfficialTransportError, remainingTime, runWithTimeout } from "./timeout.js";
import {
  type DnsLookup,
  type IpFamily,
  type UrlPolicyRejection,
  resolvePublicUrl,
} from "./url-policy.js";

export { OfficialTransportError } from "./timeout.js";

const BODY_LIMIT_BYTES = 1024 * 1024;
const DEFAULT_TIMEOUT_MS = 15_000;
const MAX_REDIRECTS = 2;
const ACCEPT = "text/html, application/xhtml+xml, text/plain";
const ALLOWED_CONTENT_TYPES = new Set(["text/html", "application/xhtml+xml", "text/plain"]);
const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);

export type PinnedRequest = {
  readonly url: string;
  readonly hostname: string;
  readonly address: string;
  readonly family: IpFamily;
  readonly method: "GET";
  readonly headers: Readonly<Record<string, string>>;
  readonly timeoutMs: number;
  readonly signal: AbortSignal;
};

export type TransportResponse = {
  readonly statusCode: number;
  readonly headers: Readonly<Record<string, string | readonly string[] | undefined>>;
  readonly body: AsyncIterable<Uint8Array>;
  readonly discard: () => void;
};

export type OfficialTransport = (request: PinnedRequest) => Promise<TransportResponse>;

export type FetchRejection =
  | UrlPolicyRejection
  | "too-many-redirects"
  | "missing-redirect-location"
  | "http-status"
  | "unsupported-content-type"
  | "body-too-large";

export type OfficialFetchResult =
  | {
      readonly kind: "success";
      readonly url: string;
      readonly address: string;
      readonly contentType: string;
      readonly body: string;
    }
  | { readonly kind: "rejected"; readonly url: string; readonly reason: FetchRejection }
  | { readonly kind: "failed"; readonly url: string; readonly reason: "network" | "timeout" };

export type OfficialFetchOptions = {
  readonly lookup?: DnsLookup;
  readonly transport?: OfficialTransport;
  readonly timeoutMs?: number;
};

function firstHeader(
  headers: Readonly<Record<string, string | readonly string[] | undefined>>,
  name: string,
): string | undefined {
  const value = headers[name];
  return typeof value === "string" ? value : value?.[0];
}

function transportHeaders(headers: IncomingHttpHeaders): TransportResponse["headers"] {
  return headers;
}

const nodeTransport: OfficialTransport = (pinned) =>
  new Promise((resolve, reject) => {
    const url = new URL(pinned.url);
    const lookup: LookupFunction = (_hostname, _options, callback) => {
      callback(null, pinned.address, pinned.family);
    };
    const options = {
      protocol: url.protocol,
      hostname: pinned.hostname,
      port: url.port === "" ? undefined : url.port,
      path: `${url.pathname}${url.search}`,
      method: pinned.method,
      headers: pinned.headers,
      lookup,
      family: pinned.family,
      signal: pinned.signal,
      agent: false,
    };
    const requester = url.protocol === "https:" ? httpsRequest : httpRequest;
    const request = requester(options, (response) => {
      resolve({
        statusCode: response.statusCode ?? 0,
        headers: transportHeaders(response.headers),
        body: response,
        discard: () => response.destroy(),
      });
    });
    request.setTimeout(pinned.timeoutMs, () =>
      request.destroy(new OfficialTransportError("timeout")),
    );
    request.once("error", reject);
    request.end();
  });

function redirectUrl(currentUrl: string, location: string): string | undefined {
  try {
    return new URL(location, currentUrl).href;
  } catch {
    return undefined;
  }
}

export async function fetchOfficialPage(
  input: string,
  options: OfficialFetchOptions = {},
): Promise<OfficialFetchResult> {
  const lookup = options.lookup;
  const transport = options.transport ?? nodeTransport;
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  let currentUrl = input;
  let redirects = 0;

  while (true) {
    const deadline = Date.now() + timeoutMs;
    let policy: Awaited<ReturnType<typeof resolvePublicUrl>>;
    try {
      policy = await runWithTimeout(() => resolvePublicUrl(currentUrl, lookup), timeoutMs);
    } catch (error) {
      return {
        kind: "failed",
        url: currentUrl,
        reason: error instanceof OfficialTransportError ? error.reason : "network",
      };
    }
    if (policy.kind === "rejected") {
      return { kind: "rejected", url: currentUrl, reason: policy.reason };
    }
    let response: TransportResponse;
    try {
      const transportTimeoutMs = remainingTime(deadline);
      response = await runWithTimeout(
        (signal) =>
          transport({
            url: policy.url,
            hostname: policy.hostname,
            address: policy.address,
            family: policy.family,
            method: "GET",
            headers: { Accept: ACCEPT, "User-Agent": USER_AGENT },
            timeoutMs: transportTimeoutMs,
            signal,
          }),
        transportTimeoutMs,
      );
    } catch (error) {
      return {
        kind: "failed",
        url: policy.url,
        reason: error instanceof OfficialTransportError ? error.reason : "network",
      };
    }

    if (REDIRECT_STATUSES.has(response.statusCode)) {
      const location = firstHeader(response.headers, "location");
      response.discard();
      if (location === undefined) {
        return { kind: "rejected", url: policy.url, reason: "missing-redirect-location" };
      }
      const target = redirectUrl(policy.url, location);
      if (target === undefined) {
        return { kind: "rejected", url: location, reason: "invalid-url" };
      }
      if (redirects >= MAX_REDIRECTS) {
        return { kind: "rejected", url: target, reason: "too-many-redirects" };
      }
      redirects += 1;
      currentUrl = target;
      continue;
    }

    if (response.statusCode < 200 || response.statusCode >= 300) {
      response.discard();
      return { kind: "rejected", url: policy.url, reason: "http-status" };
    }
    const rawContentType = firstHeader(response.headers, "content-type") ?? "";
    const contentType = rawContentType.split(";", 1)[0]?.trim().toLowerCase() ?? "";
    if (!ALLOWED_CONTENT_TYPES.has(contentType)) {
      response.discard();
      return { kind: "rejected", url: policy.url, reason: "unsupported-content-type" };
    }
    const contentLength = Number(firstHeader(response.headers, "content-length"));
    if (Number.isFinite(contentLength) && contentLength > BODY_LIMIT_BYTES) {
      response.discard();
      return { kind: "rejected", url: policy.url, reason: "body-too-large" };
    }

    const chunks: Uint8Array[] = [];
    let size = 0;
    const iterator = response.body[Symbol.asyncIterator]();
    try {
      while (true) {
        const next = await runWithTimeout(() => iterator.next(), remainingTime(deadline));
        if (next.done === true) break;
        const chunk = next.value;
        size += chunk.byteLength;
        if (size > BODY_LIMIT_BYTES) {
          response.discard();
          return { kind: "rejected", url: policy.url, reason: "body-too-large" };
        }
        chunks.push(chunk);
      }
    } catch (error) {
      response.discard();
      return {
        kind: "failed",
        url: policy.url,
        reason: error instanceof OfficialTransportError ? error.reason : "network",
      };
    }
    return {
      kind: "success",
      url: policy.url,
      address: policy.address,
      contentType,
      body: Buffer.concat(chunks).toString("utf8"),
    };
  }
}
