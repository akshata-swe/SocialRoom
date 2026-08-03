/**
 * GET /user-events/stream
 *
 * User-scoped SSE stream. Currently emits:
 *   - "view-once-opened" → sender is notified when recipient opens their view-once photo
 */

import { Router } from "express";
import { requireAuth, type AuthedRequest } from "../middlewares/requireAuth";
import { subscribeUser } from "../lib/messageBus";

const router = Router();

router.get("/user-events/stream", requireAuth, (req, res) => {
  const { userId } = req as AuthedRequest;

  res.set({
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache",
    Connection: "keep-alive",
    "X-Accel-Buffering": "no",
  });
  res.flushHeaders();

  // Confirm connection
  res.write("event: connected\ndata: {}\n\n");

  const unsubscribe = subscribeUser(userId, (event) => {
    res.write(`event: ${event.type}\ndata: ${JSON.stringify(event.payload)}\n\n`);
  });

  // Keep-alive ping every 25 s to prevent proxy timeouts
  const keepAlive = setInterval(() => {
    res.write(": ping\n\n");
  }, 25_000);

  req.on("close", () => {
    clearInterval(keepAlive);
    unsubscribe();
  });
});

export default router;
