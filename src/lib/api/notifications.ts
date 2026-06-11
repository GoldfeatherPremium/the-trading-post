import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { q, run } from "../server/db.server";
import { appContext } from "../server/app.server";
import { requireUser } from "../server/auth.server";

export const listNotifications = createServerFn({ method: "GET" }).handler(async () => {
  await appContext();
  const user = await requireUser();
  const notifications = await q<{
    id: string;
    type: string;
    title: string;
    body: string | null;
    link: string | null;
    read_at: number | null;
    created_at: number;
  }>(`select * from notifications where user_id = ? order by created_at desc limit 100`, [user.id]);
  return { notifications };
});

export const markNotificationsRead = createServerFn({ method: "POST" })
  .inputValidator(z.object({ ids: z.array(z.string()).optional() }))
  .handler(async ({ data }) => {
    await appContext();
    const user = await requireUser();
    if (data.ids?.length) {
      for (const id of data.ids) {
        await run(`update notifications set read_at = ? where user_id = ? and id = ?`, [
          Date.now(),
          user.id,
          id,
        ]);
      }
    } else {
      await run(`update notifications set read_at = ? where user_id = ? and read_at is null`, [
        Date.now(),
        user.id,
      ]);
    }
    return { ok: true };
  });
