import { useQuery, useQueryClient } from "@tanstack/react-query";
import { getMe } from "@/lib/api/auth";

export function useMe() {
  const q = useQuery({
    queryKey: ["me"],
    queryFn: () => getMe(),
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
