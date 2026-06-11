import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { db } from "../server/db.server";
import { appContext } from "../server/app.server";
import { requireUser } from "../server/auth.server";

export const listNotifications = createServerFn({ method: "GET" }).handler(async () => {
  appContext();
  const user = requireUser();
  const notifications = db()
    .prepare(`select * from notifications where user_id = ? order by created_at desc limit 100`)
    .all(user.id) as Array<{
    id: string;
    type: string;
    title: string;
    body: string | null;
    link: string | null;
    read_at: number | null;
    created_at: number;
  }>;
  return { notifications };
});

export const markNotificationsRead = createServerFn({ method: "POST" })
  .inputValidator(z.object({ ids: z.array(z.string()).optional() }))
  .handler(async ({ data }) => {
    appContext();
    const user = requireUser();
    const d = db();
    if (data.ids?.length) {
      const stmt = d.prepare(`update notifications set read_at = ? where user_id = ? and id = ?`);
      for (const id of data.ids) stmt.run(Date.now(), user.id, id);
    } else {
      d.prepare(`update notifications set read_at = ? where user_id = ? and read_at is null`).run(
        Date.now(),
        user.id,
      );
    }
    return { ok: true };
  });
