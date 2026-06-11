import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { q, q1, run } from "../server/db.server";
import { appContext } from "../server/app.server";
import { automodCheck, fail, notify, now, uid } from "../server/core.server";
import { isStaff, requireUser } from "../server/auth.server";

interface ConversationRow {
  id: string;
  order_id: string | null;
  product_id: string | null;
  buyer_id: string;
  seller_id: string;
  buyer_last_read_at: number;
  seller_last_read_at: number;
}

async function canAccessConversation(userId: string, convId: string, staff: boolean) {
  const c = await q1<ConversationRow>(`select * from conversations where id = ?`, [convId]);
  if (!c) return null;
  if (c.buyer_id !== userId && c.seller_id !== userId && !staff) return null;
  return c;
}

export const listConversations = createServerFn({ method: "GET" }).handler(async () => {
  await appContext();
  const user = await requireUser();
  const id = user.id;
  const rows = await q<Record<string, string | number | null>>(
    `select cv.id, cv.order_id, cv.last_message_at, cv.created_at,
            case when cv.buyer_id = ? then cv.buyer_last_read_at else cv.seller_last_read_at end as my_last_read,
            ub.username as buyer_name, us.username as seller_name,
            cv.buyer_id, cv.seller_id,
            o.order_no, o.product_title, o.status as order_status,
            p.title as product_title_presale,
            (select body from messages m where m.conversation_id = cv.id order by m.created_at desc limit 1) as last_body,
            (select count(*) from messages m where m.conversation_id = cv.id
               and m.created_at > case when cv.buyer_id = ? then cv.buyer_last_read_at else cv.seller_last_read_at end
               and (m.sender_id is null or m.sender_id != ?)) as unread
     from conversations cv
     join users ub on ub.id = cv.buyer_id
     join users us on us.id = cv.seller_id
     left join orders o on o.id = cv.order_id
     left join products p on p.id = cv.product_id
     where cv.buyer_id = ? or cv.seller_id = ?
     order by coalesce(cv.last_message_at, cv.created_at) desc limit 100`,
    [id, id, id, id, id],
  );
  return { conversations: rows, myId: id };
});

export const getMessages = createServerFn({ method: "GET" })
  .inputValidator(z.object({ conversationId: z.string() }))
  .handler(async ({ data }) => {
    await appContext();
    const user = await requireUser();
    const c = await canAccessConversation(user.id, data.conversationId, isStaff(user));
    if (!c) fail("Conversation not found.");
    const messages = await q<{
      id: string;
      sender_id: string | null;
      body: string;
      is_system: number;
      is_flagged: number;
      created_at: number;
      sender_name: string | null;
    }>(
      `select m.id, m.sender_id, m.body, m.is_system, m.is_flagged, m.created_at, u.username as sender_name
       from messages m left join users u on u.id = m.sender_id
       where m.conversation_id = ? order by m.created_at limit 500`,
      [data.conversationId],
    );
    // mark read
    const col =
      c!.buyer_id === user.id
        ? "buyer_last_read_at"
        : c!.seller_id === user.id
          ? "seller_last_read_at"
          : null;
    if (col)
      await run(`update conversations set ${col} = ? where id = ?`, [now(), data.conversationId]);
    const other = (await q1<{ username: string }>(`select username from users where id = ?`, [
      c!.buyer_id === user.id ? c!.seller_id : c!.buyer_id,
    ]))!;
    return { messages, myId: user.id, otherName: other.username, orderId: c!.order_id };
  });

export const sendMessage = createServerFn({ method: "POST" })
  .inputValidator(z.object({ conversationId: z.string(), body: z.string().min(1).max(3000) }))
  .handler(async ({ data }) => {
    await appContext();
    const user = await requireUser();
    const c = await canAccessConversation(user.id, data.conversationId, isStaff(user));
    if (!c) fail("Conversation not found.");
    // basic rate limit: max 20 messages/minute per user
    const recent = (await q1<{ cnt: number }>(
      `select count(*) cnt from messages where sender_id = ? and created_at > ?`,
      [user.id, now() - 60_000],
    ))!.cnt;
    if (recent >= 20) fail("You're sending messages too quickly.");

    const flagReason = automodCheck(data.body);
    await run(
      `insert into messages (id, conversation_id, sender_id, body, is_flagged, flag_reason, created_at) values (?,?,?,?,?,?,?)`,
      [uid(), data.conversationId, user.id, data.body, flagReason ? 1 : 0, flagReason, now()],
    );
    await run(`update conversations set last_message_at = ? where id = ?`, [
      now(),
      data.conversationId,
    ]);

    const recipient = c!.buyer_id === user.id ? c!.seller_id : c!.buyer_id;
    await notify(
      recipient,
      "chat",
      `New message from ${user.username}`,
      data.body.slice(0, 80),
      `/chat?c=${data.conversationId}`,
    );
    return { ok: true, flagged: !!flagReason };
  });

/** Pre-sale "Chat with seller" from a product page. */
export const startProductConversation = createServerFn({ method: "POST" })
  .inputValidator(z.object({ productId: z.string() }))
  .handler(async ({ data }) => {
    await appContext();
    const user = await requireUser();
    const p = await q1<{ id: string; seller_id: string }>(
      `select id, seller_id from products where id = ?`,
      [data.productId],
    );
    if (!p) fail("Product not found.");
    if (p!.seller_id === user.id) fail("You can't chat with yourself.");
    const existing = await q1<{ id: string }>(
      `select id from conversations where product_id = ? and buyer_id = ? and order_id is null`,
      [data.productId, user.id],
    );
    if (existing) return { conversationId: existing.id };
    const id = uid();
    await run(
      `insert into conversations (id, product_id, buyer_id, seller_id, created_at) values (?,?,?,?,?)`,
      [id, data.productId, user.id, p!.seller_id, now()],
    );
    return { conversationId: id };
  });
