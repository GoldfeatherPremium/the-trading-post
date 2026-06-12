import { createStart, createMiddleware } from "@tanstack/react-start";

import { renderErrorPage } from "./lib/error-page";
import { withDbRequest } from "./lib/server/db.server";

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
      headers: { "content-type": "text/html; charset=utf-8" },
    });
  }
});

// Scope the postgres client to each request so Cloudflare Workers'
// "Cannot perform I/O on behalf of a different request" error never fires.
const dbRequestMiddleware = createMiddleware().server(({ next }) => withDbRequest(() => next()));
const dbFnMiddleware = createMiddleware({ type: "function" }).server(({ next }) =>
  withDbRequest(() => next()),
);

export const startInstance = createStart(() => ({
  requestMiddleware: [errorMiddleware, dbRequestMiddleware],
  functionMiddleware: [dbFnMiddleware],
}));
