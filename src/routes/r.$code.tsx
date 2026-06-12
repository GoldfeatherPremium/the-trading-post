import { createFileRoute, redirect } from "@tanstack/react-router";
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { recordReferralClick } from "@/lib/server/growth.server";
import { appContext } from "@/lib/server/app.server";

const trackClick = createServerFn({ method: "POST" })
  .inputValidator(z.object({ code: z.string().min(3).max(16), ua: z.string().max(300).optional() }))
  .handler(async ({ data }) => {
    await appContext();
    await recordReferralClick(data.code.toUpperCase(), data.ua ?? null, null);
    return { ok: true };
  });

export const Route = createFileRoute("/r/$code")({
  beforeLoad: async ({ params }) => {
    try {
      const ua = typeof navigator !== "undefined" ? navigator.userAgent : "";
      await trackClick({ data: { code: params.code, ua } });
      if (typeof window !== "undefined") {
        try {
          localStorage.setItem("ref_code", params.code.toUpperCase());
        } catch {
          /* ignore */
        }
      }
    } catch {
      /* swallow — never block redirect */
    }
    throw redirect({ to: "/" });
  },
  component: () => null,
});
