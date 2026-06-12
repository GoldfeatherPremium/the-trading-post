import { createFileRoute } from "@tanstack/react-router";
import { q1 } from "@/lib/server/db.server";

/**
 * Serves a seller-uploaded product image. Public read-only — once a product
 * is published the image is visible to anyone. Image bytes live inline in
 * the `product_images` table as base64; we decode to a Uint8Array on the
 * fly and respond with the original mime type.
 */
export const Route = createFileRoute("/api/public/img/$id")({
  server: {
    handlers: {
      GET: async ({ params }) => {
        const row = await q1<{ mime: string; data: string }>(
          `select mime, data from product_images where id = ?`,
          [params.id],
        );
        if (!row) return new Response("Not found", { status: 404 });
        const binary = Uint8Array.from(atob(row.data), (c) => c.charCodeAt(0));
        return new Response(binary, {
          status: 200,
          headers: {
            "content-type": row.mime,
            "cache-control": "public, max-age=2592000, immutable",
          },
        });
      },
    },
  },
});
