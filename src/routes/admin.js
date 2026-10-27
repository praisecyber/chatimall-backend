import { Router } from 'express';
import mongoose from 'mongoose';
import { requireAuth, requireAdmin, requireSuperAdmin, getUserRole, isUserAdmin } from '../auth.js';
import {
  User,
  Conversation,
  Message,
  Channel,
  ChannelPost,
  Follow,
  DeviceToken,
  Call,
  Listing,
  AppConfig,
} from '../models.js';
import { wrap } from '../util.js';
import { getIo, emitToUsers } from '../realtime.js';
import { startDirectConversation } from './_shared.js';
import { getCountryForPhone } from '../countries.js';

const router = Router();

// Strict security: all endpoints require valid authentication AND staff/admin verification
router.use(requireAuth);
router.use(requireAdmin);

async function getOrCreateAppConfig() {
  let cfg = await AppConfig.findOne({ key: 'system_settings' });
  if (!cfg) {
    cfg = await AppConfig.create({
      key: 'system_settings',
      fileSharingLimitMb: 50,
      voiceInputEnabled: true,
      callsEnabled: true,
      systemWelcomeMessage: 'Welcome to Chatimall! Connect, chat, and trade seamlessly.',
      maintenanceMode: false,
      maintenanceNotice: 'Chatimall is currently undergoing scheduled maintenance.',
      bannedWords: ['scam', 'phishing', 'fraud', 'bvn hack', 'bank pin'],
      notificationRules: {
        quietHoursStart: '22:00',
        quietHoursEnd: '07:00',
        allowCriticalAlerts: true,
      },
    });
  }
  return cfg;
}

/**
 * GET /api/admin/overview
 * Real-time platform metrics and recent activity
 */
router.get(
  '/overview',
  wrap(async (req, res) => {
    const [
      totalUsers,
      totalConversations,
      totalMessages,
      totalChannels,
      totalChannelPosts,
      totalCalls,
      totalListings,
      totalDeviceTokens,
    ] = await Promise.all([
      User.countDocuments(),
      Conversation.countDocuments(),
      Message.countDocuments(),
      Channel.countDocuments(),
      ChannelPost.countDocuments(),
      Call.countDocuments(),
      Listing.countDocuments(),
      DeviceToken.countDocuments(),
    ]);

    const recentUsers = await User.find({})
      .sort({ createdAt: -1 })
      .limit(6)
      .select('name phone email avatarUrl bio lastSeen isSuspended isBanned banReason role createdAt')
      .lean();

    const recentChannels = await Channel.find({})
      .sort({ createdAt: -1 })
      .limit(6)
      .populate('owner', 'name phone')
      .lean();

    const reportedMessagesCount = await Message.countDocuments({ 'reports.0': { $exists: true } });

    const mem = process.memoryUsage();
    const serverMetrics = {
      uptimeSeconds: Math.floor(process.uptime()),
      nodeVersion: process.version,
      platform: process.platform,
      memoryMb: Math.round(mem.rss / 1024 / 1024),
      heapUsedMb: Math.round(mem.heapUsed / 1024 / 1024),
    };

    res.json({
      ok: true,
      stats: {
        totalUsers,
        totalConversations,
        totalMessages,
        totalChannels,
        totalChannelPosts,
        totalCalls,
        totalListings,
        totalDeviceTokens,
        reportedMessagesCount,
      },
      recentUsers: recentUsers.map((u) => ({
        id: String(u._id),
        name: u.name || 'Unnamed',
        phone: u.phone,
        email: u.email,
        avatar_url: u.avatarUrl,
        bio: u.bio,
        last_seen: u.lastSeen,
        is_suspended: Boolean(u.isSuspended),
        is_banned: Boolean(u.isBanned),
        ban_reason: u.banReason || null,
        role: getUserRole(u),
        is_admin: isUserAdmin(u),
        created_at: u.createdAt,
      })),
      recentChannels: recentChannels.map((c) => ({
        id: String(c._id),
        name: c.name,
        description: c.description,
        avatar_url: c.avatarUrl,
        owner_name: c.owner?.name || 'Unknown',
        owner_phone: c.owner?.phone || null,
        created_at: c.createdAt,
      })),
      server: serverMetrics,
    });
  })
);

/**
 * GET /api/admin/analytics
 * Comprehensive time-series usage, peak hours, platforms, and demographics
 */
router.get(
  '/analytics',
  wrap(async (_req, res) => {
    const oneDayAgo = new Date(Date.now() - 24 * 3600 * 1000);
    const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 3600 * 1000);

    const [
      activeUsers24h,
      activeUsers7d,
      totalUsers,
      totalMessages,
      totalCalls,
      hourlyAggregation,
      dailyMessagesAggregation,
      platformCounts,
      usersWithPhone,
    ] = await Promise.all([
      User.countDocuments({ lastSeen: { $gte: oneDayAgo } }),
      User.countDocuments({ lastSeen: { $gte: sevenDaysAgo } }),
      User.countDocuments(),
      Message.countDocuments(),
      Call.countDocuments(),
      Message.aggregate([
        {
          $project: {
            hour: { $hour: '$createdAt' },
          },
        },
        {
          $group: {
            _id: '$hour',
            count: { $sum: 1 },
          },
        },
      ]),
      Message.aggregate([
        { $match: { createdAt: { $gte: sevenDaysAgo } } },
        {
          $group: {
            _id: { $dateToString: { format: '%Y-%m-%d', date: '$createdAt' } },
            count: { $sum: 1 },
          },
        },
        { $sort: { _id: 1 } },
      ]),
      DeviceToken.aggregate([{ $group: { _id: '$platform', count: { $sum: 1 } } }]),
      User.find({ phone: { $exists: true, $ne: null } })
        .select('name phone avatarUrl role isSuspended isBanned createdAt lastSeen')
        .lean(),
    ]);

    // Build complete 24h distribution (0 to 23)
    const hourlyMap = new Map(hourlyAggregation.map((h) => [h._id, h.count]));
    const hourlyActivity = Array.from({ length: 24 }, (_, i) => ({
      hour: i,
      label: `${String(i).padStart(2, '0')}:00`,
      messages: hourlyMap.get(i) || 0,
    }));

    // Real demographics breakdown matching all global countries via getCountryForPhone
    const demographicsMap = new Map();
    for (const u of usersWithPhone) {
      const match = getCountryForPhone(u.phone);
      const region = match ? `${match.name} (${match.code})` : 'Other International';
      const dial = match ? match.code : '';
      const iso = match ? match.iso : '';
      const flag = match ? match.flag : '🌐';

      if (!demographicsMap.has(region)) {
        demographicsMap.set(region, {
          region,
          dial,
          iso,
          flag,
          count: 0,
          users: [],
        });
      }
      const entry = demographicsMap.get(region);
      entry.count++;
      entry.users.push({
        id: String(u._id),
        name: u.name || 'Unnamed User',
        phone: u.phone,
        avatar_url: u.avatarUrl || null,
        role: u.role || 'member',
        is_suspended: Boolean(u.isSuspended),
        is_banned: Boolean(u.isBanned),
        last_seen: u.lastSeen,
        created_at: u.createdAt,
      });
    }

    const demographics = Array.from(demographicsMap.values()).sort((a, b) => b.count - a.count);

    const retentionRate = totalUsers > 0 ? Math.round((activeUsers7d / totalUsers) * 100) : 0;

    res.json({
      ok: true,
      analytics: {
        activeUsers24h,
        activeUsers7d,
        totalUsers,
        totalMessages,
        totalCalls,
        retentionRate,
        hourlyActivity,
        dailyActivity: dailyMessagesAggregation.map((d) => ({ date: d._id, count: d.count })),
        platforms: platformCounts.map((p) => ({ platform: p._id || 'web', count: p.count })),
        demographics,
      },
    });
  })
);

/**
 * GET /api/admin/users
 * Search and paginate registered users
 */
router.get(
  '/users',
  wrap(async (req, res) => {
    const search = String(req.query.search || '').trim();
    const page = Math.max(1, parseInt(req.query.page, 10) || 1);
    const limit = Math.min(50, Math.max(1, parseInt(req.query.limit, 10) || 20));
    const skip = (page - 1) * limit;

    const filter = {};
    if (search) {
      const regex = new RegExp(search.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
      filter.$or = [{ name: regex }, { phone: regex }, { email: regex }, { bio: regex }];
    }

    const [total, users] = await Promise.all([
      User.countDocuments(filter),
      User.find(filter)
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .select('name phone email avatarUrl bio lastSeen isSuspended isBanned banReason role createdAt settings')
        .lean(),
    ]);

    res.json({
      ok: true,
      total,
      page,
      limit,
      users: users.map((u) => ({
        id: String(u._id),
        name: u.name || 'Unnamed',
        phone: u.phone,
        email: u.email,
        avatar_url: u.avatarUrl,
        bio: u.bio,
        last_seen: u.lastSeen,
        is_suspended: Boolean(u.isSuspended),
        is_banned: Boolean(u.isBanned),
        ban_reason: u.banReason || null,
        role: getUserRole(u),
        is_admin: isUserAdmin(u),
        created_at: u.createdAt,
      })),
    });
  })
);

/**
 * PATCH /api/admin/users/:id/suspend
 * Suspend or reactivate user account
 */
router.patch(
  '/users/:id/suspend',
  wrap(async (req, res) => {
    const { id } = req.params;
    if (!mongoose.isValidObjectId(id)) return res.status(400).json({ error: 'INVALID_ID' });

    if (String(req.userId) === id) {
      return res.status(400).json({ error: 'CANNOT_SUSPEND_SELF', message: 'You cannot suspend your own admin account.' });
    }

    const user = await User.findById(id);
    if (!user) return res.status(404).json({ error: 'USER_NOT_FOUND' });

    if (isUserAdmin(user)) {
      return res.status(400).json({ error: 'CANNOT_SUSPEND_ADMIN', message: 'Cannot suspend an administrator account.' });
    }

    const newStatus = typeof req.body.suspended === 'boolean' ? req.body.suspended : !user.isSuspended;
    user.isSuspended = newStatus;
    if (newStatus) {
      user.activeSessionId = null;
    }
    await user.save();

    res.json({ ok: true, is_suspended: user.isSuspended });
  })
);

/**
 * PATCH /api/admin/users/:id/ban
 * Ban or unban user account with formal reason
 */
router.patch(
  '/users/:id/ban',
  wrap(async (req, res) => {
    const { id } = req.params;
    const { banned, reason } = req.body;
    if (!mongoose.isValidObjectId(id)) return res.status(400).json({ error: 'INVALID_ID' });

    if (String(req.userId) === id) {
      return res.status(400).json({ error: 'CANNOT_BAN_SELF', message: 'You cannot ban your own account.' });
    }

    const user = await User.findById(id);
    if (!user) return res.status(404).json({ error: 'USER_NOT_FOUND' });

    if (isUserAdmin(user)) {
      return res.status(400).json({ error: 'CANNOT_BAN_ADMIN', message: 'Cannot ban an administrator account.' });
    }

    user.isBanned = typeof banned === 'boolean' ? banned : !user.isBanned;
    user.banReason = user.isBanned ? (reason || 'Violated community guidelines') : null;
    if (user.isBanned) {
      user.activeSessionId = null;
    }
    await user.save();

    res.json({ ok: true, user_id: id, is_banned: user.isBanned, ban_reason: user.banReason });
  })
);

/**
 * PATCH /api/admin/users/:id/role
 * Assign user permissions (Super-Admin only)
 */
router.patch(
  '/users/:id/role',
  requireSuperAdmin,
  wrap(async (req, res) => {
    const { id } = req.params;
    const { role } = req.body;
    if (!mongoose.isValidObjectId(id)) return res.status(400).json({ error: 'INVALID_ID' });

    if (!['super_admin', 'moderator', 'support_agent', 'member'].includes(role)) {
      return res.status(400).json({
        error: 'INVALID_ROLE',
        message: 'Allowed roles: super_admin, moderator, support_agent, member',
      });
    }

    if (String(req.userId) === id && role !== 'super_admin') {
      return res.status(400).json({ error: 'CANNOT_DEMOTE_SELF', message: 'You cannot remove your own super-admin status.' });
    }

    const user = await User.findById(id);
    if (!user) return res.status(404).json({ error: 'USER_NOT_FOUND' });

    user.role = role;
    await user.save();

    res.json({ ok: true, user_id: id, role: user.role });
  })
);

/**
 * GET /api/admin/users/:id/activity
 * Profile activity tracking for audits and support
 */
router.get(
  '/users/:id/activity',
  wrap(async (req, res) => {
    const { id } = req.params;
    if (!mongoose.isValidObjectId(id)) return res.status(400).json({ error: 'INVALID_ID' });

    const user = await User.findById(id).lean();
    if (!user) return res.status(404).json({ error: 'USER_NOT_FOUND' });

    const [messagesCount, convsCount, channelsCount, reportsAgainst] = await Promise.all([
      Message.countDocuments({ sender: id }),
      Conversation.countDocuments({ members: id }),
      Channel.countDocuments({ owner: id }),
      Message.countDocuments({ sender: id, 'reports.0': { $exists: true } }),
    ]);

    res.json({
      ok: true,
      activity: {
        userId: id,
        name: user.name || 'Unnamed',
        phone: user.phone,
        email: user.email,
        role: getUserRole(user),
        isSuspended: Boolean(user.isSuspended),
        isBanned: Boolean(user.isBanned),
        banReason: user.banReason,
        messagesCount,
        convsCount,
        channelsCount,
        reportsAgainst,
        lastSeen: user.lastSeen,
        registeredAt: user.createdAt,
      },
    });
  })
);

/**
 * DELETE /api/admin/users/:id
 * Permanently delete a user account and associated data
 */
router.delete(
  '/users/:id',
  wrap(async (req, res) => {
    const { id } = req.params;
    if (!mongoose.isValidObjectId(id)) return res.status(400).json({ error: 'INVALID_ID' });

    if (String(req.userId) === id) {
      return res.status(400).json({ error: 'CANNOT_DELETE_SELF', message: 'You cannot delete your own admin account.' });
    }

    const user = await User.findById(id);
    if (!user) return res.status(404).json({ error: 'USER_NOT_FOUND' });

    if (isUserAdmin(user)) {
      return res.status(400).json({ error: 'CANNOT_DELETE_ADMIN', message: 'Cannot delete an administrator account.' });
    }

    await Promise.all([
      User.deleteOne({ _id: id }),
      Follow.deleteMany({ user: id }),
      DeviceToken.deleteMany({ user: id }),
      Conversation.updateMany({ members: id }, { $pull: { members: id, admins: id } }),
    ]);

    res.json({ ok: true, message: 'User deleted successfully.' });
  })
);

/**
 * POST /api/admin/users/:id/message
 * Send official admin direct notice to a user inbox
 */
router.post(
  '/users/:id/message',
  wrap(async (req, res) => {
    const { id } = req.params;
    const text = String(req.body.message || '').trim();
    if (!mongoose.isValidObjectId(id)) return res.status(400).json({ error: 'INVALID_ID' });
    if (!text) return res.status(400).json({ error: 'EMPTY_MESSAGE', message: 'Message body cannot be empty.' });

    const targetUser = await User.findById(id);
    if (!targetUser) return res.status(404).json({ error: 'USER_NOT_FOUND' });

    const conv = await startDirectConversation(req.userId, id);
    const now = new Date();
    const noticeBody = `🛡️ [Official Chatimall Admin Notice]\n\n${text}`;

    const msg = await Message.create({
      conversation: conv._id,
      sender: req.userId,
      type: 'text',
      body: noticeBody,
      createdAt: now,
    });

    conv.lastMessageAt = now;
    conv.lastMessagePreview = text.slice(0, 50);
    await conv.save();

    try {
      emitToUsers([id], 'chat:message', {
        id: String(msg._id),
        conversation_id: String(conv._id),
        sender_id: String(req.userId),
        body: noticeBody,
        type: 'text',
        created_at: now.toISOString(),
      });
    } catch {
      // realtime socket fallback
    }

    res.json({ ok: true, message: 'Notice delivered to user inbox.', messageId: String(msg._id) });
  })
);

/**
 * GET /api/admin/users/:id/notes
 * Fetch internal staff notes for a user
 */
router.get(
  '/users/:id/notes',
  wrap(async (req, res) => {
    const { id } = req.params;
    if (!mongoose.isValidObjectId(id)) return res.status(400).json({ error: 'INVALID_ID' });

    const user = await User.findById(id).select('staffNotes').lean();
    if (!user) return res.status(404).json({ error: 'USER_NOT_FOUND' });

    res.json({
      ok: true,
      notes: (user.staffNotes || [])
        .map((n) => ({
          id: String(n._id),
          userId: id,
          author: n.author || 'Admin',
          text: n.text,
          date: new Date(n.createdAt).toLocaleDateString(undefined, {
            month: 'short',
            day: 'numeric',
            hour: '2-digit',
            minute: '2-digit',
          }),
          createdAt: n.createdAt,
        }))
        .reverse(),
    });
  })
);

/**
 * POST /api/admin/users/:id/notes
 * Save internal staff note for a user
 */
router.post(
  '/users/:id/notes',
  wrap(async (req, res) => {
    const { id } = req.params;
    const text = String(req.body.text || '').trim();
    if (!mongoose.isValidObjectId(id)) return res.status(400).json({ error: 'INVALID_ID' });
    if (!text) return res.status(400).json({ error: 'EMPTY_NOTE', message: 'Note text cannot be empty.' });

    const user = await User.findById(id);
    if (!user) return res.status(404).json({ error: 'USER_NOT_FOUND' });

    const adminUser = await User.findById(req.userId).select('name role').lean();
    const authorName = adminUser?.name
      ? `${adminUser.name} (${(adminUser.role || 'Admin').replace('_', ' ')})`
      : 'Praise (Admin)';

    user.staffNotes = user.staffNotes || [];
    user.staffNotes.push({
      author: authorName,
      text,
      createdAt: new Date(),
    });
    await user.save();

    const createdNote = user.staffNotes[user.staffNotes.length - 1];

    res.status(201).json({
      ok: true,
      note: {
        id: String(createdNote._id),
        userId: id,
        author: createdNote.author,
        text: createdNote.text,
        date: 'Just now',
        createdAt: createdNote.createdAt,
      },
    });
  })
);

/**
 * GET /api/admin/channels
 * List all public channels with metrics
 */
router.get(
  '/channels',
  wrap(async (req, res) => {
    const search = String(req.query.search || '').trim();
    const filter = {};
    if (search) {
      filter.name = new RegExp(search.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
    }

    const channels = await Channel.find(filter)
      .sort({ createdAt: -1 })
      .populate('owner', 'name phone email avatarUrl')
      .lean();

    const channelIds = channels.map((c) => c._id);
    const [followCounts, postCounts] = await Promise.all([
      Follow.aggregate([{ $match: { channel: { $in: channelIds } } }, { $group: { _id: '$channel', count: { $sum: 1 } } }]),
      ChannelPost.aggregate([{ $match: { channel: { $in: channelIds } } }, { $group: { _id: '$channel', count: { $sum: 1 } } }]),
    ]);

    const followsMap = new Map(followCounts.map((f) => [String(f._id), f.count]));
    const postsMap = new Map(postCounts.map((p) => [String(p._id), p.count]));

    res.json({
      ok: true,
      channels: channels.map((c) => ({
        id: String(c._id),
        name: c.name,
        description: c.description || '',
        avatar_url: c.avatarUrl,
        owner_id: c.owner ? String(c.owner._id) : null,
        owner_name: c.owner?.name || 'Unknown',
        owner_phone: c.owner?.phone || null,
        subscribers: followsMap.get(String(c._id)) || 0,
        posts_count: postsMap.get(String(c._id)) || 0,
        has_gist_room: Boolean(c.gistRoom),
        created_at: c.createdAt,
      })),
    });
  })
);

/**
 * POST /api/admin/channels
 * Create an official verified channel
 */
router.post(
  '/channels',
  wrap(async (req, res) => {
    const name = String(req.body.name || '').trim();
    const description = String(req.body.description || '').trim();
    const avatarUrl = req.body.avatar_url || null;

    if (name.length < 2) {
      return res.status(400).json({ error: 'INVALID_NAME', message: 'Channel name must be at least 2 characters.' });
    }

    const channel = await Channel.create({
      owner: req.userId,
      name,
      description,
      avatarUrl,
    });

    // Auto follow by the admin creator
    await Follow.create({ channel: channel._id, user: req.userId });

    res.status(201).json({
      ok: true,
      channel: {
        id: String(channel._id),
        name: channel.name,
        description: channel.description,
        avatar_url: channel.avatarUrl,
        subscribers: 1,
        posts_count: 0,
        created_at: channel.createdAt,
      },
    });
  })
);

/**
 * DELETE /api/admin/channels/:id
 * Delete any channel
 */
router.delete(
  '/channels/:id',
  wrap(async (req, res) => {
    const { id } = req.params;
    if (!mongoose.isValidObjectId(id)) return res.status(400).json({ error: 'INVALID_ID' });

    const channel = await Channel.findById(id);
    if (!channel) return res.status(404).json({ error: 'CHANNEL_NOT_FOUND' });

    await Promise.all([
      Channel.deleteOne({ _id: id }),
      Follow.deleteMany({ channel: id }),
      ChannelPost.deleteMany({ channel: id }),
      channel.gistRoom ? Conversation.deleteOne({ _id: channel.gistRoom }) : Promise.resolve(),
    ]);

    res.json({ ok: true, message: 'Channel and its posts deleted successfully.' });
  })
);

/**
 * POST /api/admin/broadcast
 * Broadcast official announcement to all connected users
 */
router.post(
  '/broadcast',
  wrap(async (req, res) => {
    const title = String(req.body.title || '').trim();
    const message = String(req.body.message || '').trim();
    const channelId = req.body.channel_id;

    if (!message) {
      return res.status(400).json({ error: 'INVALID_MESSAGE', message: 'Broadcast message body cannot be empty.' });
    }

    let postedPost = null;
    if (channelId && mongoose.isValidObjectId(channelId)) {
      postedPost = await ChannelPost.create({
        channel: channelId,
        author: req.userId,
        type: 'text',
        body: title ? `📢 [${title}]\n\n${message}` : message,
      });
    }

    // Broadcast live event via Socket.IO if available
    try {
      const io = getIo();
      if (io) {
        io.emit('admin:broadcast', {
          id: String(Date.now()),
          title: title || 'Official Announcement',
          message,
          channel_id: channelId ? String(channelId) : null,
          created_at: new Date().toISOString(),
        });
      }
    } catch {
      // Socket may not be initialized in test environments
    }

    res.json({
      ok: true,
      message: 'Broadcast sent successfully.',
      post_id: postedPost ? String(postedPost._id) : null,
    });
  })
);

/**
 * GET /api/admin/reports
 * Moderation queue: reported messages
 */
router.get(
  '/reports',
  wrap(async (_req, res) => {
    const reportedMessages = await Message.find({ 'reports.0': { $exists: true } })
      .sort({ createdAt: -1 })
      .populate('sender', 'name phone email avatarUrl')
      .populate('reports.user', 'name phone')
      .lean();

    res.json({
      ok: true,
      reports: reportedMessages.map((m) => ({
        message_id: String(m._id),
        conversation_id: String(m.conversation),
        sender_id: m.sender ? String(m.sender._id) : null,
        sender_name: m.sender?.name || 'Unknown',
        sender_phone: m.sender?.phone || null,
        type: m.type,
        body: m.encrypted ? '[Encrypted Message]' : m.body,
        media_url: m.mediaUrl,
        created_at: m.createdAt,
        reports: (m.reports || []).map((r) => ({
          reporter_name: r.user?.name || 'User',
          reporter_phone: r.user?.phone || null,
          reason: r.reason || 'Flagged for review',
          reported_at: r.at,
        })),
      })),
    });
  })
);

/**
 * DELETE /api/admin/reports/:messageId
 * Delete a reported/abusive message
 */
router.delete(
  '/reports/:messageId',
  wrap(async (req, res) => {
    const { messageId } = req.params;
    if (!mongoose.isValidObjectId(messageId)) return res.status(400).json({ error: 'INVALID_ID' });

    await Message.deleteOne({ _id: messageId });
    res.json({ ok: true, message: 'Message removed from conversation.' });
  })
);

/**
 * POST /api/admin/reports/:messageId/dismiss
 * Clear reports on a message (approved / not a violation)
 */
router.post(
  '/reports/:messageId/dismiss',
  wrap(async (req, res) => {
    const { messageId } = req.params;
    if (!mongoose.isValidObjectId(messageId)) return res.status(400).json({ error: 'INVALID_ID' });

    await Message.updateOne({ _id: messageId }, { $set: { reports: [] } });
    res.json({ ok: true, message: 'Reports dismissed.' });
  })
);

/**
 * POST /api/admin/reports/:messageId/action
 * Perform moderation action on reported message
 */
router.post(
  '/reports/:messageId/action',
  wrap(async (req, res) => {
    const { messageId } = req.params;
    const { action, note } = req.body;
    if (!mongoose.isValidObjectId(messageId)) return res.status(400).json({ error: 'INVALID_ID' });

    const msg = await Message.findById(messageId).populate('sender');
    if (!msg) return res.status(404).json({ error: 'MESSAGE_NOT_FOUND' });

    if (action === 'suspend_sender' && msg.sender) {
      if (!isUserAdmin(msg.sender)) {
        await User.updateOne({ _id: msg.sender._id }, { $set: { isSuspended: true, activeSessionId: null } });
      }
    } else if (action === 'delete_message') {
      await Message.deleteOne({ _id: messageId });
      return res.json({ ok: true, message: 'Message deleted successfully.' });
    }

    // Dismiss the reports with note
    await Message.updateOne({ _id: messageId }, { $set: { reports: [] } });

    res.json({ ok: true, message: `Moderation action "${action}" completed.`, note: note || null });
  })
);

/**
 * GET /api/admin/settings
 * Retrieve platform configuration & messaging limits
 */
router.get(
  '/settings',
  wrap(async (_req, res) => {
    const cfg = await getOrCreateAppConfig();
    res.json({
      ok: true,
      settings: {
        fileSharingLimitMb: cfg.fileSharingLimitMb,
        voiceInputEnabled: cfg.voiceInputEnabled,
        callsEnabled: cfg.callsEnabled,
        systemWelcomeMessage: cfg.systemWelcomeMessage,
        maintenanceMode: cfg.maintenanceMode,
        maintenanceNotice: cfg.maintenanceNotice,
        bannedWords: cfg.bannedWords || [],
        notificationRules: cfg.notificationRules || {
          quietHoursStart: '22:00',
          quietHoursEnd: '07:00',
          allowCriticalAlerts: true,
        },
        updatedAt: cfg.updatedAt,
      },
    });
  })
);

/**
 * PATCH /api/admin/settings
 * Update platform configuration (Super-Admin only)
 */
router.patch(
  '/settings',
  requireSuperAdmin,
  wrap(async (req, res) => {
    const cfg = await getOrCreateAppConfig();
    const {
      fileSharingLimitMb,
      voiceInputEnabled,
      callsEnabled,
      systemWelcomeMessage,
      maintenanceMode,
      maintenanceNotice,
      bannedWords,
      notificationRules,
    } = req.body;

    if (typeof fileSharingLimitMb === 'number') cfg.fileSharingLimitMb = Math.max(1, Math.min(500, fileSharingLimitMb));
    if (typeof voiceInputEnabled === 'boolean') cfg.voiceInputEnabled = voiceInputEnabled;
    if (typeof callsEnabled === 'boolean') cfg.callsEnabled = callsEnabled;
    if (typeof systemWelcomeMessage === 'string') cfg.systemWelcomeMessage = systemWelcomeMessage.slice(0, 300);
    if (typeof maintenanceMode === 'boolean') cfg.maintenanceMode = maintenanceMode;
    if (typeof maintenanceNotice === 'string') cfg.maintenanceNotice = maintenanceNotice.slice(0, 300);
    if (Array.isArray(bannedWords)) cfg.bannedWords = bannedWords.map((w) => String(w).trim().toLowerCase()).filter(Boolean);
    if (notificationRules && typeof notificationRules === 'object') {
      cfg.notificationRules = {
        quietHoursStart: notificationRules.quietHoursStart || cfg.notificationRules?.quietHoursStart || '22:00',
        quietHoursEnd: notificationRules.quietHoursEnd || cfg.notificationRules?.quietHoursEnd || '07:00',
        allowCriticalAlerts: typeof notificationRules.allowCriticalAlerts === 'boolean' ? notificationRules.allowCriticalAlerts : true,
      };
    }
    cfg.updatedAt = new Date();
    await cfg.save();

    res.json({
      ok: true,
      message: 'System settings saved successfully.',
      settings: cfg,
    });
  })
);

export default router;
