import { useEffect, useState, useCallback } from "react";

const LOCALE_KEY = "xv_locale";
const CURRENCY_KEY = "xv_currency";

export const SUPPORTED_LOCALES = [
  { code: "en", label: "English" },
  { code: "es", label: "Español" },
  { code: "fr", label: "Français" },
  { code: "de", label: "Deutsch" },
  { code: "ar", label: "العربية" },
] as const;

export const SUPPORTED_CURRENCIES = ["USD", "EUR", "GBP", "INR", "PKR", "BDT"] as const;

function read(key: string, fallback: string): string {
  if (typeof window === "undefined") return fallback;
  try {
    return localStorage.getItem(key) ?? fallback;
  } catch {
    return fallback;
  }
}

export function useLocale() {
  const [locale, setLocaleState] = useState("en");
  const [currency, setCurrencyState] = useState("USD");

  useEffect(() => {
    setLocaleState(read(LOCALE_KEY, "en"));
    setCurrencyState(read(CURRENCY_KEY, "USD"));
  }, []);

  const setLocale = useCallback((v: string) => {
    setLocaleState(v);
    try {
      localStorage.setItem(LOCALE_KEY, v);
      document.documentElement.lang = v;
      document.documentElement.dir = v === "ar" ? "rtl" : "ltr";
    } catch {
      /* ignore */
    }
  }, []);

  const setCurrency = useCallback((v: string) => {
    setCurrencyState(v);
    try {
      localStorage.setItem(CURRENCY_KEY, v);
    } catch {
      /* ignore */
    }
  }, []);

  return { locale, currency, setLocale, setCurrency };
}
