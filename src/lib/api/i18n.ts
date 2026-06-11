import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { q, q1, run } from "../server/db.server";
import { appContext } from "../server/app.server";
import { audit, fail, now } from "../server/core.server";
import { requireStaff, requireUser } from "../server/auth.server";

export interface FxRate {
  currency: string;
  rate_to_base: number;
  symbol: string | null;
  updated_at: number;
}

export const ISO_COUNTRIES: Array<{ code: string; name: string }> = [
  { code: "US", name: "United States" },
  { code: "GB", name: "United Kingdom" },
  { code: "DE", name: "Germany" },
  { code: "FR", name: "France" },
  { code: "ES", name: "Spain" },
  { code: "IT", name: "Italy" },
  { code: "NL", name: "Netherlands" },
  { code: "PL", name: "Poland" },
  { code: "TR", name: "Türkiye" },
  { code: "RU", name: "Russia" },
  { code: "UA", name: "Ukraine" },
  { code: "BR", name: "Brazil" },
  { code: "AR", name: "Argentina" },
  { code: "MX", name: "Mexico" },
  { code: "CA", name: "Canada" },
  { code: "AU", name: "Australia" },
  { code: "JP", name: "Japan" },
  { code: "KR", name: "South Korea" },
  { code: "CN", name: "China" },
  { code: "IN", name: "India" },
  { code: "ID", name: "Indonesia" },
  { code: "PH", name: "Philippines" },
  { code: "VN", name: "Vietnam" },
  { code: "TH", name: "Thailand" },
  { code: "AE", name: "United Arab Emirates" },
  { code: "SA", name: "Saudi Arabia" },
  { code: "EG", name: "Egypt" },
  { code: "NG", name: "Nigeria" },
  { code: "ZA", name: "South Africa" },
  { code: "KE", name: "Kenya" },
];

export const LOCALES: Array<{ code: string; label: string }> = [
  { code: "en", label: "English" },
  { code: "es", label: "Español" },
  { code: "pt", label: "Português" },
  { code: "fr", label: "Français" },
  { code: "de", label: "Deutsch" },
  { code: "it", label: "Italiano" },
  { code: "ru", label: "Русский" },
  { code: "uk", label: "Українська" },
  { code: "tr", label: "Türkçe" },
  { code: "ar", label: "العربية" },
  { code: "hi", label: "हिन्दी" },
  { code: "id", label: "Bahasa Indonesia" },
  { code: "ja", label: "日本語" },
  { code: "ko", label: "한국어" },
  { code: "zh", label: "中文" },
];

export const getI18nBootstrap = createServerFn({ method: "GET" }).handler(async () => {
  await appContext();
  const [settings, rates] = await Promise.all([
    q1<{ base_currency: string }>(`select base_currency from site_settings where id = 1`),
    q<FxRate>(`select currency, rate_to_base, symbol, updated_at from fx_rates order by currency`),
  ]);
  return {
    baseCurrency: settings?.base_currency ?? "USD",
    rates,
    countries: ISO_COUNTRIES,
    locales: LOCALES,
  };
});

export const adminUpsertFxRate = createServerFn({ method: "POST" })
  .inputValidator(
    z.object({
      currency: z
        .string()
        .min(3)
        .max(4)
        .regex(/^[A-Z]+$/),
      rate_to_base: z.number().positive().max(10_000_000),
      symbol: z.string().max(4).optional(),
    }),
  )
  .handler(async ({ data }) => {
    await appContext();
    const user = await requireStaff(["admin", "finance"]);
    const existing = await q1(`select 1 as x from fx_rates where currency = ?`, [data.currency]);
    if (existing) {
      await run(
        `update fx_rates set rate_to_base = ?, symbol = ?, updated_at = ? where currency = ?`,
        [data.rate_to_base, data.symbol ?? null, now(), data.currency],
      );
    } else {
      await run(
        `insert into fx_rates (currency, rate_to_base, symbol, updated_at) values (?,?,?,?)`,
        [data.currency, data.rate_to_base, data.symbol ?? null, now()],
      );
    }
    await audit(user.id, "fx.upsert", "fx_rate", data.currency);
    return { ok: true };
  });

export const adminDeleteFxRate = createServerFn({ method: "POST" })
  .inputValidator(z.object({ currency: z.string() }))
  .handler(async ({ data }) => {
    await appContext();
    const user = await requireStaff(["admin", "finance"]);
    if (data.currency === "USD") fail("USD cannot be deleted.");
    await run(`delete from fx_rates where currency = ?`, [data.currency]);
    await audit(user.id, "fx.delete", "fx_rate", data.currency);
    return { ok: true };
  });

export const adminSetBaseCurrency = createServerFn({ method: "POST" })
  .inputValidator(z.object({ currency: z.string().min(3).max(4) }))
  .handler(async ({ data }) => {
    await appContext();
    const user = await requireStaff(["admin"]);
    const row = await q1(`select 1 as x from fx_rates where currency = ?`, [data.currency]);
    if (!row) fail("Currency not in rate table.");
    await run(`update site_settings set base_currency = ? where id = 1`, [data.currency]);
    await audit(user.id, "fx.set_base", "site_settings", data.currency);
    return { ok: true };
  });

export const updatePreferences = createServerFn({ method: "POST" })
  .inputValidator(
    z.object({
      locale: z.string().min(2).max(8).optional(),
      preferred_currency: z
        .string()
        .min(3)
        .max(4)
        .regex(/^[A-Z]+$/)
        .optional(),
      country: z.string().length(2).optional().nullable(),
    }),
  )
  .handler(async ({ data }) => {
    await appContext();
    const user = await requireUser();
    if (data.preferred_currency) {
      const ok = await q1(`select 1 as x from fx_rates where currency = ?`, [
        data.preferred_currency,
      ]);
      if (!ok) fail("Currency not supported.");
    }
    const sets: string[] = [];
    const params: Array<string | null> = [];
    if (data.locale !== undefined) {
      sets.push("locale = ?");
      params.push(data.locale);
    }
    if (data.preferred_currency !== undefined) {
      sets.push("preferred_currency = ?");
      params.push(data.preferred_currency);
    }
    if (data.country !== undefined) {
      sets.push("country = ?");
      params.push(data.country);
    }
    if (sets.length === 0) return { ok: true };
    params.push(user.id);
    await run(`update users set ${sets.join(", ")} where id = ?`, params);
    return { ok: true };
  });
