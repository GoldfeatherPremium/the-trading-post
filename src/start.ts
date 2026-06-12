import { createStart, createMiddleware } from "@tanstack/react-start";

import { renderErrorPage } from "./lib/error-page";
import { withDbRequest } from "./lib/server/db.server";

const SECURITY_HEADERS: Record<string, string> = {
  "X-Content-Type-Options": "nosniff",
  "X-Frame-Options": "SAMEORIGIN",
  "Referrer-Policy": "strict-origin-when-cross-origin",
  "Permissions-Policy": "camera=(), microphone=(), geolocation=()",
  "Strict-Transport-Security": "max-age=31536000; includeSubDomains",
};

const securityHeadersMiddleware = createMiddleware().server(async ({ next }) => {
  const result = await next();
  const res = (result as { response?: Response })?.response;
  if (res && res.headers) {
    for (const [k, v] of Object.entries(SECURITY_HEADERS)) {
      if (!res.headers.has(k)) res.headers.set(k, v);
    }
  }
  return result;
});

const errorMiddleware = createMiddleware().server(async ({ next }) => {
  try {
    return await next();
  } catch (error) {
    if (error != null && typeof error === "object" && "statusCode" in error) {
      throw error;
    }
    console.error(error);
    return new Response(renderErrorPage(), {
      status: 500,
      headers: { "content-type": "text/html; charset=utf-8", ...SECURITY_HEADERS },
    });
  }
});

// Scope the postgres client to each request so Cloudflare Workers'
// "Cannot perform I/O on behalf of a different request" error never fires.
const dbRequestMiddleware = createMiddleware().server(async ({ next }) =>
  withDbRequest(async () => await next()),
);
const dbFnMiddleware = createMiddleware({ type: "function" }).server(async ({ next }) =>
  withDbRequest(async () => await next()),
);

export const startInstance = createStart(() => ({
  requestMiddleware: [errorMiddleware, dbRequestMiddleware],
  functionMiddleware: [dbFnMiddleware],
}));
