import { createFileRoute } from "@tanstack/react-router";
import type {} from "@tanstack/react-start";
import { q } from "@/lib/server/db.server";

const BASE_URL = "https://warm-trade-space.lovable.app";

export const Route = createFileRoute("/sitemap.xml")({
  server: {
    handlers: {
      GET: async () => {
        const staticPaths = [
          { path: "/", changefreq: "daily", priority: "1.0" },
          { path: "/browse", changefreq: "hourly", priority: "0.9" },
          { path: "/sell", changefreq: "monthly", priority: "0.6" },
          { path: "/auth", changefreq: "yearly", priority: "0.3" },
        ];

        let products: Array<{ slug: string; updated: number }> = [];
        let sellers: Array<{ username: string }> = [];
        let categories: Array<{ slug: string }> = [];
        try {
          [products, sellers, categories] = await Promise.all([
            q<{ slug: string; updated: number }>(
              `select slug, created_at as updated from products where status = 'active' limit 5000`,
            ),
            q<{ username: string }>(
              `select username from users where seller_status = 'approved' and is_banned = 0 limit 2000`,
            ),
            q<{ slug: string }>(`select slug from categories where is_active = 1`),
          ]);
        } catch {
          // DB unavailable during prerender → ship static-only sitemap
        }

        const urls = [
          ...staticPaths.map(
            (p) =>
              `  <url><loc>${BASE_URL}${p.path}</loc><changefreq>${p.changefreq}</changefreq><priority>${p.priority}</priority></url>`,
          ),
          ...categories.map(
            (c) =>
              `  <url><loc>${BASE_URL}/browse?category=${encodeURIComponent(c.slug)}</loc><changefreq>daily</changefreq><priority>0.7</priority></url>`,
          ),
          ...products.map(
            (p) =>
              `  <url><loc>${BASE_URL}/p/${encodeURIComponent(p.slug)}</loc><lastmod>${new Date(p.updated).toISOString().slice(0, 10)}</lastmod><changefreq>weekly</changefreq><priority>0.8</priority></url>`,
          ),
          ...sellers.map(
            (s) =>
              `  <url><loc>${BASE_URL}/s/${encodeURIComponent(s.username)}</loc><changefreq>weekly</changefreq><priority>0.6</priority></url>`,
          ),
        ];

        const xml = [
          `<?xml version="1.0" encoding="UTF-8"?>`,
          `<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">`,
          ...urls,
          `</urlset>`,
        ].join("\n");

        return new Response(xml, {
          headers: {
            "Content-Type": "application/xml; charset=utf-8",
            "Cache-Control": "public, max-age=3600",
          },
        });
      },
    },
  },
});
