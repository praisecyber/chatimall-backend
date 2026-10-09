import { Router } from 'express';
import { Call, User } from '../models.js';
import { requireAuth } from '../auth.js';
import { wrap } from '../util.js';

const router = Router();
router.use(requireAuth);

router.get(
  '/',
  wrap(async (req, res) => {
    const me = req.userId;
    const calls = await Call.find({ $or: [{ caller: me }, { callee: me }] }).sort({ createdAt: -1 }).limit(100).lean();
    const otherOf = (c) => (String(c.caller) === me ? String(c.callee) : String(c.caller));
    const users = await User.find({ _id: { $in: [...new Set(calls.map(otherOf))] } }).lean();
    const byId = new Map(users.map((u) => [String(u._id), u]));

    res.json(
      calls
        .map((c) => {
          const other = byId.get(otherOf(c));
          if (!other) return null;
          const outgoing = String(c.caller) === me;
          return {
            id: String(c._id),
            other_id: String(other._id),
            other_name: other.name,
            other_phone: other.phone,
            other_avatar: other.avatarUrl ?? null,
            type: c.type,
            direction: outgoing ? 'outgoing' : ['missed', 'canceled'].includes(c.status) ? 'missed' : 'incoming',
            status: c.status,
            created_at: new Date(c.createdAt).toISOString(),
            duration_secs:
              c.answeredAt && c.endedAt ? Math.round((new Date(c.endedAt) - new Date(c.answeredAt)) / 1000) : null,
          };
        })
        .filter(Boolean)
    );
  })
);

export default router;
