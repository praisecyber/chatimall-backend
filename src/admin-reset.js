import mongoose from 'mongoose';
import {
  Call,
  Channel,
  ChannelPost,
  Conversation,
  DeviceLinkRequest,
  DeviceToken,
  EmailOtp,
  Follow,
  LinkedDevice,
  Listing,
  Message,
  Otp,
  StarredMessage,
  Status,
  SupportTicket,
  TikTokConnection,
  TikTokOAuthState,
  User,
  WatchSession,
} from './models.js';
import { isStaffOrAdmin } from './auth.js';
import { disconnectLinkedDevice, disconnectPrimarySession } from './realtime.js';
import { previewOf } from './util.js';

const count = (result) => result.deletedCount ?? 0;

export async function resetNonAdminData() {
  const users = await User.find({})
    .select('_id role phone email emailVerifiedAt')
    .lean();
  const preservedUsers = users.filter(isStaffOrAdmin);
  const deletedUsers = users.filter((user) => !isStaffOrAdmin(user));
  const userIds = deletedUsers.map((user) => user._id);
  const preservedUserIds = new Set(preservedUsers.map((user) => String(user._id)));

  if (userIds.length === 0) {
    return {
      deletedUsers: 0,
      preservedAdmins: preservedUsers.length,
      deletedMessages: 0,
      deletedConversations: 0,
      deletedMediaFiles: 0,
    };
  }

  const deletedPhones = deletedUsers.map((user) => user.phone).filter(Boolean);
  const deletedEmails = deletedUsers.map((user) => user.email).filter(Boolean);
  const linkedDeviceIds = await LinkedDevice.find({ user: { $in: userIds } }).distinct('_id');
  for (const userId of userIds) {
    disconnectPrimarySession(userId);
  }
  for (const deviceId of linkedDeviceIds) {
    disconnectLinkedDevice(deviceId);
  }

  const ownedChannels = await Channel.find({ owner: { $in: userIds } }).select('_id gistRoom').lean();
  const channelIds = ownedChannels.map((channel) => channel._id);
  const gistRoomIds = ownedChannels.map((channel) => channel.gistRoom).filter(Boolean);

  const relatedConversations = await Conversation.find({
    $or: [
      { members: { $in: userIds } },
      { owner: { $in: userIds } },
      { admins: { $in: userIds } },
      { archivedBy: { $in: userIds } },
      { 'anonymous.vote.startedBy': { $in: userIds } },
      { 'anonymous.vote.yes': { $in: userIds } },
      { 'anonymous.vote.no': { $in: userIds } },
      ...(channelIds.length ? [{ channel: { $in: channelIds } }] : []),
    ],
  })
    .select('_id isGroup members admins owner archivedBy lastRead')
    .lean();

  const deletedConversationIds = new Set(gistRoomIds.map(String));
  const retainedGroups = [];
  for (const conversation of relatedConversations) {
    const adminMembers = (conversation.members || []).filter((id) => preservedUserIds.has(String(id)));
    if (conversation.isGroup && adminMembers.length > 0 && !deletedConversationIds.has(String(conversation._id))) {
      retainedGroups.push({ conversation, adminMembers });
    } else {
      deletedConversationIds.add(String(conversation._id));
    }
  }
  const conversationIds = [...deletedConversationIds].map((id) => new mongoose.Types.ObjectId(id));

  const deletedMessageIds = await Message.distinct('_id', {
    $or: [
      { sender: { $in: userIds } },
      ...(conversationIds.length ? [{ conversation: { $in: conversationIds } }] : []),
    ],
  });

  const [messageResult, starResult, deletedStatuses, statusViewResult, callResult, followResult, postResult, listingResult,
    watchResult, ticketResult, tokenResult, linkedDeviceResult, tiktokStateResult, tiktokResult,
    emailOtpResult, otpResult, deviceLinkResult] = await Promise.all([
    Message.updateMany(
      { 'reports.user': { $in: userIds } },
      { $pull: { reports: { user: { $in: userIds } } } }
    ).then(() => Message.deleteMany({
      $or: [
        { sender: { $in: userIds } },
        ...(conversationIds.length ? [{ conversation: { $in: conversationIds } }] : []),
      ],
    })),
    StarredMessage.deleteMany({
      $or: [
        { user: { $in: userIds } },
        ...(deletedMessageIds.length ? [{ message: { $in: deletedMessageIds } }] : []),
      ],
    }),
    Status.deleteMany({ user: { $in: userIds } }),
    Status.updateMany({ 'views.user': { $in: userIds } }, { $pull: { views: { user: { $in: userIds } } } }),
    Call.deleteMany({ $or: [{ caller: { $in: userIds } }, { callee: { $in: userIds } }] }),
    Follow.deleteMany({
      $or: [
        { user: { $in: userIds } },
        ...(channelIds.length ? [{ channel: { $in: channelIds } }] : []),
      ],
    }),
    ChannelPost.deleteMany({
      $or: [
        { author: { $in: userIds } },
        ...(channelIds.length ? [{ channel: { $in: channelIds } }] : []),
      ],
    }),
    Listing.deleteMany({
      $or: [
        { seller: { $in: userIds } },
        ...(conversationIds.length ? [{ conversation: { $in: conversationIds } }] : []),
      ],
    }),
    WatchSession.deleteMany({
      $or: [
        { queuedBy: { $in: userIds } },
        ...(conversationIds.length ? [{ conversation: { $in: conversationIds } }] : []),
      ],
    }),
    SupportTicket.deleteMany({ user: { $in: userIds } }),
    DeviceToken.deleteMany({ user: { $in: userIds } }),
    LinkedDevice.deleteMany({ user: { $in: userIds } }),
    TikTokOAuthState.deleteMany({ user: { $in: userIds } }),
    TikTokConnection.deleteMany({ user: { $in: userIds } }),
    EmailOtp.deleteMany({
      $or: [
        { user: { $in: userIds } },
        ...(deletedPhones.length ? [{ phone: { $in: deletedPhones } }] : []),
        ...(deletedEmails.length ? [{ email: { $in: deletedEmails } }] : []),
      ],
    }),
    Otp.deleteMany({ phone: { $in: deletedPhones } }),
    DeviceLinkRequest.deleteMany({
      $or: [
        { user: { $in: userIds } },
        ...(linkedDeviceIds.length ? [{ linkedDevice: { $in: linkedDeviceIds } }] : []),
      ],
    }),
  ]);

  await Promise.all([
    Conversation.deleteMany({ _id: { $in: conversationIds } }),
    ...retainedGroups.map(({ conversation, adminMembers }) => {
      const ownerId = preservedUserIds.has(String(conversation.owner))
        ? conversation.owner
        : adminMembers[0];
      const groupAdmins = (conversation.admins || []).filter((id) => preservedUserIds.has(String(id)));
      const lastRead = Object.fromEntries(
        Object.entries(conversation.lastRead || {}).filter(([id]) => preservedUserIds.has(id))
      );
      return Conversation.updateOne(
        { _id: conversation._id },
        {
          $set: {
            members: adminMembers,
            admins: groupAdmins.length ? groupAdmins : adminMembers,
            owner: ownerId,
            archivedBy: (conversation.archivedBy || []).filter((id) => preservedUserIds.has(String(id))),
            lastRead,
            lastMessagePreview: '',
            'anonymous.vote.startedBy': null,
            'anonymous.vote.startedAt': null,
            'anonymous.vote.yes': [],
            'anonymous.vote.no': [],
          },
        }
      );
    }),
    ...(channelIds.length ? [Channel.deleteMany({ _id: { $in: channelIds } })] : []),
  ]);

  for (const { conversation } of retainedGroups) {
    const latestMessage = await Message.findOne({ conversation: conversation._id })
      .sort({ createdAt: -1 })
      .select('type body encrypted anonymous createdAt')
      .lean();
    await Conversation.updateOne(
      { _id: conversation._id },
      {
        $set: {
          lastMessageAt: latestMessage?.createdAt || conversation.createdAt || new Date(0),
          lastMessagePreview: latestMessage
            ? latestMessage.anonymous
              ? 'Anonymous message'
              : latestMessage.encrypted
                ? 'Encrypted message'
                : previewOf(latestMessage.type, latestMessage.body)
            : '',
        },
      }
    );
  }

  const gridFsFiles = await mongoose.connection.db
    .collection('media.files')
    .find({ 'metadata.owner': { $in: userIds.map(String) } }, { projection: { _id: 1 } })
    .toArray();
  const mediaBucket = new mongoose.mongo.GridFSBucket(mongoose.connection.db, { bucketName: 'media' });
  for (const file of gridFsFiles) {
    await mediaBucket.delete(file._id);
  }

  const userResult = await User.deleteMany({ _id: { $in: userIds } });

  return {
    deletedUsers: count(userResult),
    preservedAdmins: preservedUsers.length,
    deletedMessages: count(messageResult),
    deletedConversations: conversationIds.length,
    deletedMediaFiles: gridFsFiles.length,
    deletedStatuses: count(deletedStatuses),
    removedStatusViews: statusViewResult.modifiedCount ?? 0,
    deletedCalls: count(callResult),
    deletedFollows: count(followResult),
    deletedChannelPosts: count(postResult),
    deletedListings: count(listingResult),
    deletedWatchSessions: count(watchResult),
    deletedSupportTickets: count(ticketResult),
    deletedDeviceTokens: count(tokenResult),
    deletedLinkedDevices: count(linkedDeviceResult),
    deletedTikTokConnections: count(tiktokResult),
    deletedTikTokOAuthStates: count(tiktokStateResult),
    deletedOtpRecords: count(emailOtpResult) + count(otpResult),
    deletedDeviceLinkRequests: count(deviceLinkResult),
  };
}
