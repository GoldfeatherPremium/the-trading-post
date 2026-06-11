import { useQuery, useQueryClient } from "@tanstack/react-query";
import { getMe } from "@/lib/api/auth";

const CACHE_KEY = "xv_me_cache_v1";

type MeData = Awaited<ReturnType<typeof getMe>>;

function readCache(): MeData | undefined {
  if (typeof window === "undefined") return undefined;
  try {
    const raw = window.localStorage.getItem(CACHE_KEY);
    if (!raw) return undefined;
    return JSON.parse(raw) as MeData;
  } catch {
    return undefined;
  }
}

function writeCache(data: MeData | undefined) {
  if (typeof window === "undefined") return;
  try {
    if (data && data.user) window.localStorage.setItem(CACHE_KEY, JSON.stringify(data));
    else window.localStorage.removeItem(CACHE_KEY);
  } catch {
    /* noop */
  }
}

export function useMe() {
  const q = useQuery({
    queryKey: ["me"],
    queryFn: async () => {
      const data = await getMe();
      writeCache(data);
      return data;
    },
    initialData: readCache,
    staleTime: 10_000,
    refetchInterval: 30_000,
  });
  return {
    me: q.data?.user ?? null,
    unreadNotifications: q.data?.unreadNotifications ?? 0,
    unreadMessages: q.data?.unreadMessages ?? 0,
    banner: q.data?.banner ?? { announcement: null, maintenance: false },
    isLoading: q.isLoading,
  };
}

export function useInvalidate() {
  const qc = useQueryClient();
  return (...keys: string[]) => {
    if (keys.length === 0) qc.invalidateQueries();
    for (const k of keys) qc.invalidateQueries({ queryKey: [k] });
  };
}
