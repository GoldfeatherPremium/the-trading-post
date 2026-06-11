/**
 * Advanced Search helpers
 *
 * - Tokenization: splits query into searchable tokens (lowercased, stripped).
 * - SQL builder: produces a WHERE fragment that matches ANY token against
 *   product title / description / platform / category / item / seller name.
 * - Fuzzy ranking: Damerau-Levenshtein for did-you-mean suggestions.
 * - Suggestion source: pulled from active product titles + catalog items +
 *   category names so suggestions never point at empty results.
 */

import { q } from "./db.server";

const STOP = new Set([
  "the",
  "a",
  "an",
  "and",
  "or",
  "for",
  "to",
  "of",
  "with",
  "in",
  "on",
  "by",
]);

export function tokenize(query: string): string[] {
  return query
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .split(/\s+/)
    .filter((t) => t.length >= 2 && !STOP.has(t))
    .slice(0, 6);
}

/**
 * Build a SQL WHERE clause that matches if ANY of the haystack columns
 * contain ANY of the tokens (AND across tokens for relevance, OR across
 * columns). Returns `{sql, params}` ready to splice into an existing query.
 */
export function buildSearchClause(
  tokens: string[],
  cols: string[],
): { sql: string; params: string[] } {
  if (tokens.length === 0 || cols.length === 0) return { sql: "1=1", params: [] };
  const params: string[] = [];
  const perToken = tokens.map((tok) => {
    const like = `%${tok}%`;
    const ors = cols.map((c) => {
      params.push(like);
      return `lower(${c}) like ?`;
    });
    return `(${ors.join(" or ")})`;
  });
  return { sql: perToken.join(" and "), params };
}

/** Damerau-Levenshtein distance (capped). */
export function distance(a: string, b: string, max = 3): number {
  if (a === b) return 0;
  if (Math.abs(a.length - b.length) > max) return max + 1;
  const dp: number[][] = [];
  for (let i = 0; i <= a.length; i++) dp[i] = [i];
  for (let j = 0; j <= b.length; j++) dp[0][j] = j;
  for (let i = 1; i <= a.length; i++) {
    let rowMin = Infinity;
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      dp[i][j] = Math.min(
        dp[i - 1][j] + 1,
        dp[i][j - 1] + 1,
        dp[i - 1][j - 1] + cost,
        i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]
          ? dp[i - 2][j - 2] + 1
          : Infinity,
      );
      if (dp[i][j] < rowMin) rowMin = dp[i][j];
    }
    if (rowMin > max) return max + 1;
  }
  return dp[a.length][b.length];
}

/**
 * Pulls a corpus of suggestion strings from active products + catalog +
 * categories. Cached per-process for 60s — small marketplaces are fine.
 */
let suggestionCache: { at: number; words: string[] } | null = null;

async function getSuggestionCorpus(): Promise<string[]> {
  const now = Date.now();
  if (suggestionCache && now - suggestionCache.at < 60_000) return suggestionCache.words;
  const rows = await q<{ s: string }>(
    `select lower(p.title) as s from products p where p.status = 'active'
     union select lower(name) from catalog_items where is_active = 1
     union select lower(name) from categories where is_active = 1`,
  );
  const set = new Set<string>();
  for (const r of rows) {
    for (const tok of tokenize(r.s)) {
      if (tok.length >= 3) set.add(tok);
    }
  }
  const words = Array.from(set);
  suggestionCache = { at: now, words };
  return words;
}

/**
 * Returns up to 3 did-you-mean suggestions when the input query likely has a
 * typo. Token-by-token correction. Skips tokens we already recognise exactly.
 */
export async function didYouMean(query: string): Promise<string | null> {
  const tokens = tokenize(query);
  if (tokens.length === 0) return null;
  const corpus = await getSuggestionCorpus();
  if (corpus.length === 0) return null;
  const exact = new Set(corpus);
  let changed = false;
  const corrected = tokens.map((tok) => {
    if (exact.has(tok) || tok.length < 4) return tok;
    let best = tok;
    let bestD = Math.min(2, Math.floor(tok.length / 3));
    for (const w of corpus) {
      if (Math.abs(w.length - tok.length) > bestD) continue;
      const d = distance(tok, w, bestD);
      if (d < bestD) {
        bestD = d;
        best = w;
      }
    }
    if (best !== tok) changed = true;
    return best;
  });
  if (!changed) return null;
  const result = corrected.join(" ");
  return result === query.trim().toLowerCase() ? null : result;
}
