// API documentation (OpenAPI 3). This file has no code: swagger-jsdoc reads the @openapi blocks below.
// Keep it in sync when you add or change a route. `npm test` fails if a route is missing from here.

/**
 * @openapi
 * components:
 *   schemas:
 *     Error:
 *       type: object
 *       properties:
 *         error: { type: string, example: NOT_FOUND }
 *         message: { type: string, example: Human readable explanation }
 *     Ok:
 *       type: object
 *       properties:
 *         ok: { type: boolean, example: true }
 *     User:
 *       type: object
 *       properties:
 *         id: { type: string, example: 665f1c2ab1c2d3e4f5a6b7c8 }
 *         phone: { type: string, description: Digits only, example: "15551234567" }
 *         name: { type: string, example: Amina }
 *         bio: { type: string, example: Hey there! I am using Chatimall. }
 *         avatar_url: { type: string, nullable: true, example: /api/files/3f2b8c1e-4d5a-4b6c-9d7e-1a2b3c4d5e6f }
 *         last_seen: { type: string, format: date-time }
 *     Message:
 *       type: object
 *       properties:
 *         id: { type: string }
 *         conversation_id: { type: string }
 *         sender_id: { type: string }
 *         type: { type: string, enum: [text, image, video, voice, file] }
 *         body: { type: string, description: Text, caption or file name }
 *         media_url: { type: string, nullable: true, description: Relative path from /api/upload }
 *         duration_secs: { type: integer, nullable: true, description: Voice notes only }
 *         created_at: { type: string, format: date-time }
 *     ChatSummary:
 *       type: object
 *       properties:
 *         conversation_id: { type: string }
 *         other_id: { type: string }
 *         other_name: { type: string }
 *         other_phone: { type: string }
 *         other_avatar: { type: string, nullable: true }
 *         other_last_seen: { type: string, format: date-time, description: Set to "now" while the person is online }
 *         last_message_at: { type: string, format: date-time }
 *         last_message_preview: { type: string }
 *         unread: { type: integer }
 *     StatusItem:
 *       type: object
 *       properties:
 *         id: { type: string }
 *         type: { type: string, enum: [text, image] }
 *         body: { type: string }
 *         media_url: { type: string, nullable: true }
 *         bg: { type: string, enum: [emerald, indigo, rose, sky] }
 *         created_at: { type: string, format: date-time }
 *         viewed: { type: boolean }
 *         view_count: { type: integer, description: Only on your own statuses }
 *         anonymous: { type: boolean }
 *         posted_by: { type: string, nullable: true, description: Null when anonymous and you are not the poster }
 *     StatusGroup:
 *       type: object
 *       properties:
 *         user_id: { type: string }
 *         name: { type: string }
 *         phone: { type: string }
 *         avatar_url: { type: string, nullable: true }
 *         is_mine: { type: boolean }
 *         items:
 *           type: array
 *           items: { $ref: '#/components/schemas/StatusItem' }
 *     GroupStatusGroup:
 *       type: object
 *       properties:
 *         group_id: { type: string }
 *         name: { type: string }
 *         avatar_url: { type: string, nullable: true }
 *         items:
 *           type: array
 *           items: { $ref: '#/components/schemas/StatusItem' }
 *     ChannelStatusGroup:
 *       type: object
 *       properties:
 *         channel_id: { type: string }
 *         name: { type: string }
 *         avatar_url: { type: string, nullable: true }
 *         items:
 *           type: array
 *           items: { $ref: '#/components/schemas/StatusItem' }
 *     Channel:
 *       type: object
 *       properties:
 *         id: { type: string }
 *         name: { type: string }
 *         description: { type: string }
 *         avatar_url: { type: string, nullable: true }
 *         owner_id: { type: string }
 *         gist_room_id: { type: string, nullable: true, description: The attached discussion Group of this channel, open it through the groups endpoints }
 *         subscribers: { type: integer }
 *         is_subscribed: { type: boolean }
 *         is_owner: { type: boolean }
 *         last_post: { type: string, nullable: true }
 *         last_post_at: { type: string, format: date-time, nullable: true }
 *     ChannelPost:
 *       type: object
 *       properties:
 *         id: { type: string }
 *         channel_id: { type: string }
 *         type: { type: string, enum: [text, image] }
 *         body: { type: string }
 *         media_url: { type: string, nullable: true }
 *         created_at: { type: string, format: date-time }
 *     CallRecord:
 *       type: object
 *       properties:
 *         id: { type: string }
 *         other_id: { type: string }
 *         other_name: { type: string }
 *         other_phone: { type: string }
 *         other_avatar: { type: string, nullable: true }
 *         type: { type: string, enum: [voice, video] }
 *         direction: { type: string, enum: [incoming, outgoing, missed] }
 *         status: { type: string, enum: [ringing, answered, declined, missed, canceled, ended] }
 *         created_at: { type: string, format: date-time }
 *         duration_secs: { type: integer, nullable: true }
 *   parameters:
 *     IdPath:
 *       name: id
 *       in: path
 *       required: true
 *       schema: { type: string }
 *       description: Record id (24-character MongoDB id)
 *   responses:
 *     Unauthorized:
 *       description: Missing, invalid or expired token
 *       content:
 *         application/json:
 *           schema: { $ref: '#/components/schemas/Error' }
 *     NotFound:
 *       description: Not found, or you are not allowed to see it
 *       content:
 *         application/json:
 *           schema: { $ref: '#/components/schemas/Error' }
 *     BadRequest:
 *       description: Invalid input
 *       content:
 *         application/json:
 *           schema: { $ref: '#/components/schemas/Error' }
 */

/**
 * @openapi
 * /api/health:
 *   get:
 *     summary: Is the server running?
 *     tags: [System]
 *     security: []
 *     responses:
 *       200:
 *         description: Server is up
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/Ok' }
 */

/**
 * @openapi
 * /api/me:
 *   get:
 *     summary: Get my profile
 *     tags: [Profile]
 *     responses:
 *       200:
 *         description: My profile
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/User' }
 *       401: { $ref: '#/components/responses/Unauthorized' }
 *   patch:
 *     summary: Update my name, bio or profile photo
 *     tags: [Profile]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               name: { type: string, maxLength: 40 }
 *               bio: { type: string, maxLength: 140 }
 *               avatar_url: { type: string, nullable: true, description: A path returned by /api/upload, or null to remove }
 *     responses:
 *       200:
 *         description: Updated profile
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/User' }
 *       400: { $ref: '#/components/responses/BadRequest' }
 *       401: { $ref: '#/components/responses/Unauthorized' }
 */

/**
 * @openapi
 * /api/me/settings:
 *   get:
 *     summary: Get my settings
 *     tags: [Profile]
 *     responses:
 *       200:
 *         description: My privacy, security, and notification settings
 *       401: { $ref: '#/components/responses/Unauthorized' }
 *   patch:
 *     summary: Update my settings
 *     tags: [Profile]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             description: Partial settings grouped by privacy, security, or notifications
 *             properties:
 *               privacy:
 *                 type: object
 *                 properties:
 *                   read_receipts: { type: boolean }
 *                   last_seen: { type: string, enum: [Everyone, Contacts, Nobody] }
 *                   disappearing_timer: { type: string, enum: [Off, 24h, 7d, 90d] }
 *               security:
 *                 type: object
 *                 properties:
 *                   biometrics_lock: { type: boolean }
 *               notifications:
 *                 type: object
 *                 properties:
 *                   sound: { type: string, enum: [Pulse Chime, Aurora, Celestial Bell] }
 *                   vibrate: { type: boolean }
 *                   preview: { type: boolean }
 *               appearance:
 *                 type: object
 *                 properties:
 *                   wallpaper: { type: string, enum: [default, light, plain] }
 *     responses:
 *       200:
 *         description: Updated settings
 *       400: { $ref: '#/components/responses/BadRequest' }
 *       401: { $ref: '#/components/responses/Unauthorized' }
 */

/**
 * @openapi
 * /api/me/security/two-factor:
 *   post:
 *     summary: Enable or disable two-step verification
 *     tags: [Profile]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [enabled, code]
 *             properties:
 *               enabled: { type: boolean }
 *               code: { type: string, description: Fresh SMS verification code }
 *               pin: { type: string, description: Required when enabling; 6 to 12 digits }
 *               current_pin: { type: string, description: Required when disabling }
 *     responses:
 *       200: { description: Two-step verification updated }
 *       400: { $ref: '#/components/responses/BadRequest' }
 *       401: { $ref: '#/components/responses/Unauthorized' }
 */

/**
 * @openapi
 * /api/settings/contacts:
 *   get:
 *     summary: List people from my direct conversations
 *     tags: [Settings]
 *     responses:
 *       200:
 *         description: Contacts from active and archived conversations
 *       401: { $ref: '#/components/responses/Unauthorized' }
 * /api/settings/contacts/sync:
 *   post:
 *     summary: Match phone contacts against registered accounts without storing the submitted address book
 *     tags: [Settings]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [contacts]
 *             properties:
 *               contacts:
 *                 type: array
 *                 items:
 *                   type: object
 *                   required: [name, phone]
 *                   properties:
 *                     name: { type: string, maxLength: 40 }
 *                     phone: { type: string, example: +15555550123 }
 *     responses:
 *       200: { description: Contact list synced }
 *       400: { $ref: '#/components/responses/BadRequest' }
 *       401: { $ref: '#/components/responses/Unauthorized' }
 * /api/settings/archived:
 *   get:
 *     summary: List my archived direct conversations
 *     tags: [Settings]
 *     responses:
 *       200: { description: Archived conversations }
 *       401: { $ref: '#/components/responses/Unauthorized' }
 * /api/settings/archive/{conversationId}:
 *   patch:
 *     summary: Archive or restore a direct conversation
 *     tags: [Settings]
 *     parameters:
 *       - { name: conversationId, in: path, required: true, schema: { type: string } }
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [archived]
 *             properties:
 *               archived: { type: boolean }
 *     responses:
 *       200: { description: Archive state updated }
 *       400: { $ref: '#/components/responses/BadRequest' }
 *       401: { $ref: '#/components/responses/Unauthorized' }
 *       404: { $ref: '#/components/responses/NotFound' }
 * /api/settings/starred:
 *   get:
 *     summary: List my starred messages
 *     tags: [Settings]
 *     responses:
 *       200: { description: Starred messages }
 *       401: { $ref: '#/components/responses/Unauthorized' }
 * /api/settings/starred/{messageId}:
 *   post:
 *     summary: Star a message in one of my conversations
 *     tags: [Settings]
 *     parameters:
 *       - { name: messageId, in: path, required: true, schema: { type: string } }
 *     responses:
 *       201: { description: Message starred }
 *       400: { $ref: '#/components/responses/BadRequest' }
 *       401: { $ref: '#/components/responses/Unauthorized' }
 *       404: { $ref: '#/components/responses/NotFound' }
 *   delete:
 *     summary: Remove a message from my starred messages
 *     tags: [Settings]
 *     parameters:
 *       - { name: messageId, in: path, required: true, schema: { type: string } }
 *     responses:
 *       200: { description: Star removed }
 *       401: { $ref: '#/components/responses/Unauthorized' }
 * /api/settings/storage:
 *   get:
 *     summary: Get storage used by my uploaded files
 *     tags: [Settings]
 *     responses:
 *       200: { description: Per-type file counts and byte totals }
 *       401: { $ref: '#/components/responses/Unauthorized' }
 * /api/settings/support:
 *   post:
 *     summary: Create a support request
 *     tags: [Settings]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [subject, message]
 *             properties:
 *               subject: { type: string, maxLength: 100 }
 *               message: { type: string, maxLength: 2000 }
 *     responses:
 *       201: { description: Support request created }
 *       400: { $ref: '#/components/responses/BadRequest' }
 *       401: { $ref: '#/components/responses/Unauthorized' }
 */

/**
 * @openapi
 * /api/upload:
 *   post:
 *     summary: Upload a file (photo, video, voice note, document)
 *     description: Max 50 MB. Use the returned `url` as `media_url` when sending a message, status or channel post.
 *     tags: [Files]
 *     requestBody:
 *       required: true
 *       content:
 *         multipart/form-data:
 *           schema:
 *             type: object
 *             required: [file]
 *             properties:
 *               file: { type: string, format: binary }
 *     responses:
 *       200:
 *         description: File stored
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 url: { type: string, example: /api/files/3f2b8c1e-4d5a-4b6c-9d7e-1a2b3c4d5e6f }
 *                 name: { type: string }
 *                 size: { type: integer }
 *                 content_type: { type: string }
 *       400: { $ref: '#/components/responses/BadRequest' }
 *       401: { $ref: '#/components/responses/Unauthorized' }
 *       413:
 *         description: File is larger than 50 MB
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/Error' }
 * /api/files/{key}:
 *   get:
 *     summary: Download or stream a stored file
 *     description: Public link (the key is unguessable). Supports the HTTP Range header, so audio and video can seek.
 *     tags: [Files]
 *     security: []
 *     parameters:
 *       - { name: key, in: path, required: true, schema: { type: string }, description: The key at the end of the url returned by /api/upload }
 *       - { name: Range, in: header, required: false, schema: { type: string, example: "bytes=0-1023" } }
 *     responses:
 *       200:
 *         description: The file
 *         content:
 *           application/octet-stream:
 *             schema: { type: string, format: binary }
 *       206:
 *         description: Partial content (Range request)
 *       404:
 *         description: No such file
 */

/**
 * @openapi
 * /api/chats:
 *   get:
 *     summary: My chat list (with last message and unread counts)
 *     tags: [Chats]
 *     responses:
 *       200:
 *         description: Chats, newest first
 *         content:
 *           application/json:
 *             schema:
 *               type: array
 *               items: { $ref: '#/components/schemas/ChatSummary' }
 *       401: { $ref: '#/components/responses/Unauthorized' }
 * /api/chats/direct:
 *   post:
 *     summary: Start (or reuse) a 1-to-1 chat by phone number
 *     tags: [Chats]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [phone]
 *             properties:
 *               phone: { type: string, example: "+15550002222" }
 *     responses:
 *       200:
 *         description: The conversation id
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 conversation_id: { type: string }
 *       400:
 *         description: INVALID_PHONE, or SELF (your own number)
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/Error' }
 *       401: { $ref: '#/components/responses/Unauthorized' }
 *       404:
 *         description: NO_USER, that number is not on Chatimall
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/Error' }
 * /api/chats/{id}/encryption-key:
 *   get:
 *     summary: Get the other direct-chat participant's encryption public key
 *     tags: [Chats]
 *     parameters: [{ $ref: '#/components/parameters/IdPath' }]
 *     responses:
 *       200:
 *         description: The other member's public key, or null if not published
 *         content:
 *           application/json:
 *             schema: { type: object, properties: { user_id: { type: string }, public_key: { type: object, nullable: true } } }
 *       401: { $ref: '#/components/responses/Unauthorized' }
 *       404: { $ref: '#/components/responses/NotFound' }
 * /api/chats/{id}/messages:
 *   get:
 *     summary: Messages in a chat (latest 300, oldest first)
 *     tags: [Chats]
 *     parameters:
 *       - $ref: '#/components/parameters/IdPath'
 *     responses:
 *       200:
 *         description: Messages
 *         content:
 *           application/json:
 *             schema:
 *               type: array
 *               items: { $ref: '#/components/schemas/Message' }
 *       401: { $ref: '#/components/responses/Unauthorized' }
 *       404: { $ref: '#/components/responses/NotFound' }
 *   post:
 *     summary: Send a message
 *     description: Text and media payloads must be encrypted client-side. For media, upload ciphertext first and pass its `media_url` and recipient-wrapped `media_key`.
 *     tags: [Chats]
 *     parameters:
 *       - $ref: '#/components/parameters/IdPath'
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               type: { type: string, enum: [text, image, video, voice, file], default: text }
 *               body: { type: string, maxLength: 16000, description: Encrypted text envelope or generic media label }
 *               encrypted: { type: boolean, enum: [true] }
 *               media_url: { type: string, description: Required for every non-text type; points to encrypted bytes }
 *               media_key: { type: string, description: Required for encrypted media; recipient-wrapped decryption key envelope }
 *               duration_secs: { type: integer, description: Voice notes }
 *     responses:
 *       201:
 *         description: The saved message (also pushed live to everyone in the chat)
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/Message' }
 *       400: { $ref: '#/components/responses/BadRequest' }
 *       401: { $ref: '#/components/responses/Unauthorized' }
 *       404: { $ref: '#/components/responses/NotFound' }
 * /api/chats/{id}/read:
 *   post:
 *     summary: Mark the chat as read (turns the ticks blue for the other person)
 *     tags: [Chats]
 *     parameters:
 *       - $ref: '#/components/parameters/IdPath'
 *     responses:
 *       200:
 *         description: Done
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/Ok' }
 *       401: { $ref: '#/components/responses/Unauthorized' }
 *       404: { $ref: '#/components/responses/NotFound' }
 * /api/chats/{id}/read-state:
 *   get:
 *     summary: When did the other person last read this chat?
 *     tags: [Chats]
 *     parameters:
 *       - $ref: '#/components/parameters/IdPath'
 *     responses:
 *       200:
 *         description: Timestamp, or null
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 at: { type: string, format: date-time, nullable: true }
 *       401: { $ref: '#/components/responses/Unauthorized' }
 *       404: { $ref: '#/components/responses/NotFound' }
 */

/**
 * @openapi
 * /api/status:
 *   get:
 *     summary: Status updates of me and the people I chat with (last 24 hours)
 *     tags: [Status]
 *     responses:
 *       200:
 *         description: One group per person
 *         content:
 *           application/json:
 *             schema:
 *               type: array
 *               items: { $ref: '#/components/schemas/StatusGroup' }
 *       401: { $ref: '#/components/responses/Unauthorized' }
 *   post:
 *     summary: Post a status update
 *     tags: [Status]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               type: { type: string, enum: [text, image], default: text }
 *               body: { type: string, maxLength: 300, description: Text (required for text statuses) or caption }
 *               bg: { type: string, enum: [emerald, indigo, rose, sky], description: Background for text statuses }
 *               media_url: { type: string, description: Required for image statuses }
 *     responses:
 *       201:
 *         description: Created
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 id: { type: string }
 *       400: { $ref: '#/components/responses/BadRequest' }
 *       401: { $ref: '#/components/responses/Unauthorized' }
 * /api/status/{id}/view:
 *   post:
 *     summary: Record that I viewed someone's status
 *     tags: [Status]
 *     parameters:
 *       - $ref: '#/components/parameters/IdPath'
 *     responses:
 *       200:
 *         description: Done
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/Ok' }
 *       401: { $ref: '#/components/responses/Unauthorized' }
 *       404: { $ref: '#/components/responses/NotFound' }
 * /api/status/{id}:
 *   delete:
 *     summary: Delete my own status
 *     tags: [Status]
 *     parameters:
 *       - $ref: '#/components/parameters/IdPath'
 *     responses:
 *       200:
 *         description: Done
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/Ok' }
 *       401: { $ref: '#/components/responses/Unauthorized' }
 *       404: { $ref: '#/components/responses/NotFound' }
 */
/**
 * @openapi
 * /api/status/groups:
 *   get:
 *     summary: Status updates from groups I'm a member of
 *     tags: [Status]
 *     responses:
 *       200:
 *         description: One group per Group
 *         content:
 *           application/json:
 *             schema: { type: array, items: { $ref: '#/components/schemas/GroupStatusGroup' } }
 *       401: { $ref: '#/components/responses/Unauthorized' }
 * /api/status/groups/{id}:
 *   post:
 *     summary: Post a status to a group (Normal, always available — or Anonymous, weekends only by default)
 *     tags: [Status]
 *     parameters: [{ $ref: '#/components/parameters/IdPath' }]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               type: { type: string, enum: [text, image], default: text }
 *               body: { type: string, maxLength: 300 }
 *               bg: { type: string, enum: [emerald, indigo, rose, sky] }
 *               media_url: { type: string }
 *               anonymous: { type: boolean, default: false }
 *     responses:
 *       201:
 *         description: Created
 *         content: { application/json: { schema: { type: object, properties: { id: { type: string } } } } }
 *       400:
 *         description: INVALID_TYPE, EMPTY, BAD_MEDIA, or ANON_STATUS_WEEKEND_ONLY
 *         content: { application/json: { schema: { $ref: '#/components/schemas/Error' } } }
 *       401: { $ref: '#/components/responses/Unauthorized' }
 *       404: { $ref: '#/components/responses/NotFound' }
 * /api/status/channels:
 *   get:
 *     summary: Status updates from channels I follow
 *     tags: [Status]
 *     responses:
 *       200:
 *         description: One group per Channel
 *         content:
 *           application/json:
 *             schema: { type: array, items: { $ref: '#/components/schemas/ChannelStatusGroup' } }
 *       401: { $ref: '#/components/responses/Unauthorized' }
 * /api/status/channels/{id}:
 *   post:
 *     summary: Post a status to a channel (Normal is owner-only; Anonymous is open to any follower, weekends only by default)
 *     tags: [Status]
 *     parameters: [{ $ref: '#/components/parameters/IdPath' }]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               type: { type: string, enum: [text, image], default: text }
 *               body: { type: string, maxLength: 300 }
 *               bg: { type: string, enum: [emerald, indigo, rose, sky] }
 *               media_url: { type: string }
 *               anonymous: { type: boolean, default: false }
 *     responses:
 *       201:
 *         description: Created
 *         content: { application/json: { schema: { type: object, properties: { id: { type: string } } } } }
 *       400:
 *         description: INVALID_TYPE, EMPTY, BAD_MEDIA, or ANON_STATUS_WEEKEND_ONLY
 *         content: { application/json: { schema: { $ref: '#/components/schemas/Error' } } }
 *       401: { $ref: '#/components/responses/Unauthorized' }
 *       403:
 *         description: FORBIDDEN (not the owner, for a normal status) or NOT_FOLLOWING (for an anonymous one)
 *         content: { application/json: { schema: { $ref: '#/components/schemas/Error' } } }
 *       404: { $ref: '#/components/responses/NotFound' }
 */

/**
 * @openapi
 * /api/channels:
 *   get:
 *     summary: Discover all channels
 *     tags: [Channels]
 *     responses:
 *       200:
 *         description: Channels, most recently active first
 *         content:
 *           application/json:
 *             schema:
 *               type: array
 *               items: { $ref: '#/components/schemas/Channel' }
 *       401: { $ref: '#/components/responses/Unauthorized' }
 *   post:
 *     summary: Create a channel (you become its owner and first follower)
 *     tags: [Channels]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [name]
 *             properties:
 *               name: { type: string, minLength: 2, maxLength: 60 }
 *               description: { type: string, maxLength: 300 }
 *     responses:
 *       201:
 *         description: Created
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 id: { type: string }
 *       400: { $ref: '#/components/responses/BadRequest' }
 *       401: { $ref: '#/components/responses/Unauthorized' }
 * /api/channels/{id}/follow:
 *   post:
 *     summary: Follow a channel
 *     tags: [Channels]
 *     parameters:
 *       - $ref: '#/components/parameters/IdPath'
 *     responses:
 *       200:
 *         description: Done
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/Ok' }
 *       401: { $ref: '#/components/responses/Unauthorized' }
 *       404: { $ref: '#/components/responses/NotFound' }
 *   delete:
 *     summary: Unfollow a channel
 *     tags: [Channels]
 *     parameters:
 *       - $ref: '#/components/parameters/IdPath'
 *     responses:
 *       200:
 *         description: Done
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/Ok' }
 *       401: { $ref: '#/components/responses/Unauthorized' }
 *       404: { $ref: '#/components/responses/NotFound' }
 * /api/channels/{id}/posts:
 *   get:
 *     summary: Posts in a channel (latest 200, oldest first)
 *     tags: [Channels]
 *     parameters:
 *       - $ref: '#/components/parameters/IdPath'
 *     responses:
 *       200:
 *         description: Posts
 *         content:
 *           application/json:
 *             schema:
 *               type: array
 *               items: { $ref: '#/components/schemas/ChannelPost' }
 *       401: { $ref: '#/components/responses/Unauthorized' }
 *       404: { $ref: '#/components/responses/NotFound' }
 *   post:
 *     summary: Publish a post (channel owner only)
 *     tags: [Channels]
 *     parameters:
 *       - $ref: '#/components/parameters/IdPath'
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               type: { type: string, enum: [text, image], default: text }
 *               body: { type: string, maxLength: 4000 }
 *               media_url: { type: string, description: Required for image posts }
 *     responses:
 *       201:
 *         description: The saved post (also pushed live to viewers)
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/ChannelPost' }
 *       400: { $ref: '#/components/responses/BadRequest' }
 *       401: { $ref: '#/components/responses/Unauthorized' }
 *       403:
 *         description: Only the channel owner can post
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/Error' }
 *       404: { $ref: '#/components/responses/NotFound' }
 */

/**
 * @openapi
 * /api/calls:
 *   get:
 *     summary: My call history (latest 100)
 *     description: Calls themselves are started over Socket.IO (see the realtime tables above).
 *     tags: [Calls]
 *     responses:
 *       200:
 *         description: Calls, newest first
 *         content:
 *           application/json:
 *             schema:
 *               type: array
 *               items: { $ref: '#/components/schemas/CallRecord' }
 *       401: { $ref: '#/components/responses/Unauthorized' }
 */

/**
 * @openapi
 * /api/devices:
 *   post:
 *     summary: Register this phone for push notifications
 *     tags: [Devices]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [token]
 *             properties:
 *               token: { type: string, description: Firebase Cloud Messaging token }
 *               platform: { type: string, example: android }
 *     responses:
 *       200:
 *         description: Registered
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/Ok' }
 *       400: { $ref: '#/components/responses/BadRequest' }
 *       401: { $ref: '#/components/responses/Unauthorized' }
 * /api/devices/remove:
 *   post:
 *     summary: Unregister this phone (call on logout)
 *     tags: [Devices]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [token]
 *             properties:
 *               token: { type: string }
 *     responses:
 *       200:
 *         description: Removed
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/Ok' }
 *       401: { $ref: '#/components/responses/Unauthorized' }
 */

/**
 * @openapi
 * components:
 *   schemas:
 *     Group:
 *       type: object
 *       properties:
 *         id: { type: string }
 *         name: { type: string }
 *         avatar_url: { type: string, nullable: true }
 *         owner_id: { type: string }
 *         is_owner: { type: boolean }
 *         is_admin: { type: boolean }
 *         member_count: { type: integer }
 *         is_gist_room: { type: boolean, description: True when this group is a Channel's own attached Gist Room }
 *         channel_id: { type: string, nullable: true }
 *         last_message_at: { type: string, format: date-time }
 *         last_message_preview: { type: string }
 *         anonymous:
 *           type: object
 *           properties:
 *             active: { type: boolean }
 *             expires_at: { type: string, format: date-time, nullable: true }
 *             vote:
 *               type: object
 *               nullable: true
 *               properties:
 *                 started_by: { type: string }
 *                 started_at: { type: string, format: date-time }
 *                 yes: { type: integer }
 *                 no: { type: integer }
 *                 total_members: { type: integer }
 *                 closes_at: { type: string, format: date-time, description: Voting always runs the full 24 hours, even once everyone has voted }
 *                 my_vote: { type: string, nullable: true, enum: [yes, no, null] }
 *                 open: { type: boolean }
 *     GroupMessage:
 *       allOf:
 *         - $ref: '#/components/schemas/Message'
 *         - type: object
 *           properties:
 *             sender_id: { type: string, nullable: true, description: Null when this message was sent while Anonymous Mode was active and you are not the sender }
 *             anonymous: { type: boolean }
 */

/**
 * @openapi
 * /api/groups:
 *   get:
 *     summary: My groups (not Gist Rooms — those are listed under their Channel)
 *     tags: [Groups]
 *     responses:
 *       200:
 *         description: Groups, most recently active first
 *         content:
 *           application/json:
 *             schema: { type: array, items: { $ref: '#/components/schemas/Group' } }
 *       401: { $ref: '#/components/responses/Unauthorized' }
 *   post:
 *     summary: Create a group (you become its owner)
 *     tags: [Groups]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [name]
 *             properties:
 *               name: { type: string, minLength: 2, maxLength: 60 }
 *               member_ids: { type: array, items: { type: string } }
 *     responses:
 *       201:
 *         description: Created
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/Group' }
 *       400: { $ref: '#/components/responses/BadRequest' }
 *       401: { $ref: '#/components/responses/Unauthorized' }
 * /api/groups/{id}:
 *   get:
 *     summary: A group's details
 *     tags: [Groups]
 *     parameters: [{ $ref: '#/components/parameters/IdPath' }]
 *     responses:
 *       200:
 *         description: The group
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/Group' }
 *       401: { $ref: '#/components/responses/Unauthorized' }
 *       404: { $ref: '#/components/responses/NotFound' }
 * /api/groups/{id}/encryption-keys:
 *   get:
 *     summary: Encryption public keys of the group's current members
 *     tags: [Groups]
 *     parameters: [{ $ref: '#/components/parameters/IdPath' }]
 *     responses:
 *       200:
 *         description: Public keys visible only to current group members
 *         content:
 *           application/json:
 *             schema: { type: array, items: { type: object, properties: { user_id: { type: string }, name: { type: string }, public_key: { type: object, nullable: true } } } }
 *       401: { $ref: '#/components/responses/Unauthorized' }
 *       404: { $ref: '#/components/responses/NotFound' }
 * /api/groups/{id}/members:
 *   post:
 *     summary: Add a member
 *     tags: [Groups]
 *     parameters: [{ $ref: '#/components/parameters/IdPath' }]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema: { type: object, required: [user_id], properties: { user_id: { type: string } } }
 *     responses:
 *       200: { description: Done, content: { application/json: { schema: { $ref: '#/components/schemas/Ok' } } } }
 *       400: { $ref: '#/components/responses/BadRequest' }
 *       401: { $ref: '#/components/responses/Unauthorized' }
 *       404: { $ref: '#/components/responses/NotFound' }
 * /api/groups/{id}/members/me:
 *   delete:
 *     summary: Leave a group (not available for a Channel's Gist Room — unfollow the channel instead)
 *     tags: [Groups]
 *     parameters: [{ $ref: '#/components/parameters/IdPath' }]
 *     responses:
 *       200: { description: Done, content: { application/json: { schema: { $ref: '#/components/schemas/Ok' } } } }
 *       400: { $ref: '#/components/responses/BadRequest' }
 *       401: { $ref: '#/components/responses/Unauthorized' }
 *       404: { $ref: '#/components/responses/NotFound' }
 * /api/groups/{id}/messages:
 *   get:
 *     summary: Messages in a group (latest 300, oldest first)
 *     tags: [Groups]
 *     parameters: [{ $ref: '#/components/parameters/IdPath' }]
 *     responses:
 *       200:
 *         description: Messages
 *         content:
 *           application/json:
 *             schema: { type: array, items: { $ref: '#/components/schemas/GroupMessage' } }
 *       401: { $ref: '#/components/responses/Unauthorized' }
 *       404: { $ref: '#/components/responses/NotFound' }
 *   post:
 *     summary: Send a message (posted anonymously if the group's Anonymous Mode is currently active)
 *     tags: [Groups]
 *     parameters: [{ $ref: '#/components/parameters/IdPath' }]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               type: { type: string, enum: [text, image, video, voice, file], default: text }
 *               body: { type: string, maxLength: 4000 }
 *               media_url: { type: string }
 *               duration_secs: { type: integer }
 *     responses:
 *       201:
 *         description: The saved message (also pushed live to every member)
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/GroupMessage' }
 *       400: { $ref: '#/components/responses/BadRequest' }
 *       401: { $ref: '#/components/responses/Unauthorized' }
 *       404: { $ref: '#/components/responses/NotFound' }
 * /api/groups/{id}/messages/{messageId}/report:
 *   post:
 *     summary: Report a message — works even while Anonymous Mode is on, since the real sender is always kept server-side
 *     tags: [Groups]
 *     parameters:
 *       - $ref: '#/components/parameters/IdPath'
 *       - { name: messageId, in: path, required: true, schema: { type: string } }
 *     requestBody:
 *       content:
 *         application/json:
 *           schema: { type: object, properties: { reason: { type: string, maxLength: 300 } } }
 *     responses:
 *       200: { description: Done, content: { application/json: { schema: { $ref: '#/components/schemas/Ok' } } } }
 *       401: { $ref: '#/components/responses/Unauthorized' }
 *       404: { $ref: '#/components/responses/NotFound' }
 * /api/groups/{id}/anonymous/propose:
 *   post:
 *     summary: Start a vote to turn on Anonymous Mode (24-hour notice — the group needs a full day to decide)
 *     tags: [Groups]
 *     parameters: [{ $ref: '#/components/parameters/IdPath' }]
 *     responses:
 *       200: { description: Vote started, content: { application/json: { schema: { $ref: '#/components/schemas/Group' } } } }
 *       400:
 *         description: ALREADY_ON or VOTE_IN_PROGRESS
 *         content: { application/json: { schema: { $ref: '#/components/schemas/Error' } } }
 *       401: { $ref: '#/components/responses/Unauthorized' }
 *       404: { $ref: '#/components/responses/NotFound' }
 * /api/groups/{id}/anonymous/vote:
 *   post:
 *     summary: Cast your vote (the window always stays open the full 24 hours; highest count wins when it closes)
 *     tags: [Groups]
 *     parameters: [{ $ref: '#/components/parameters/IdPath' }]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema: { type: object, required: [choice], properties: { choice: { type: string, enum: [yes, no] } } }
 *     responses:
 *       200: { description: Updated group, content: { application/json: { schema: { $ref: '#/components/schemas/Group' } } } }
 *       400:
 *         description: NO_VOTE, VOTE_CLOSED or INVALID_CHOICE
 *         content: { application/json: { schema: { $ref: '#/components/schemas/Error' } } }
 *       401: { $ref: '#/components/responses/Unauthorized' }
 *       404: { $ref: '#/components/responses/NotFound' }
 * /api/groups/{id}/anonymous/off:
 *   post:
 *     summary: Turn Anonymous Mode off early (group owner or an admin only; otherwise it expires by itself after 24 hours)
 *     tags: [Groups]
 *     parameters: [{ $ref: '#/components/parameters/IdPath' }]
 *     responses:
 *       200: { description: Updated group, content: { application/json: { schema: { $ref: '#/components/schemas/Group' } } } }
 *       401: { $ref: '#/components/responses/Unauthorized' }
 *       403:
 *         description: Only the owner or an admin can do this
 *         content: { application/json: { schema: { $ref: '#/components/schemas/Error' } } }
 *       404: { $ref: '#/components/responses/NotFound' }
 */

/**
 * @openapi
 * components:
 *   schemas:
 *     WatchSession:
 *       type: object
 *       nullable: true
 *       properties:
 *         platform: { type: string, enum: [tiktok, youtube] }
 *         video_id: { type: string }
 *         url: { type: string }
 *         queued_by: { type: string }
 *         playing: { type: boolean }
 *         position_secs: { type: number, description: Playhead position as of updated_at — estimate forward from here if playing }
 *         updated_at: { type: string, format: date-time }
 *     Listing:
 *       type: object
 *       properties:
 *         id: { type: string }
 *         conversation_id: { type: string }
 *         seller_id: { type: string }
 *         title: { type: string }
 *         description: { type: string }
 *         price: { type: string, description: Free text — "₦15,000", "$40", "swap for...", left as the seller wrote it }
 *         photo_url: { type: string, nullable: true }
 *         created_at: { type: string, format: date-time }
 */

/**
 * @openapi
 * /api/watch/{id}:
 *   get:
 *     summary: What's currently playing in this Group / Gist Room's Watch Together, if anything
 *     tags: [Watch Together]
 *     parameters: [{ $ref: '#/components/parameters/IdPath' }]
 *     responses:
 *       200:
 *         description: The current session, or null if nothing is queued
 *         content: { application/json: { schema: { $ref: '#/components/schemas/WatchSession' } } }
 *       401: { $ref: '#/components/responses/Unauthorized' }
 *       404: { $ref: '#/components/responses/NotFound' }
 *   post:
 *     summary: Queue a TikTok or YouTube video for the whole room to watch together
 *     description: Anyone in the room can queue a video — there is no single "host". Replaces whatever was playing before.
 *     tags: [Watch Together]
 *     parameters: [{ $ref: '#/components/parameters/IdPath' }]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [url]
 *             properties:
 *               url: { type: string, example: https://www.tiktok.com/@user/video/7312345678901234567 }
 *     responses:
 *       201:
 *         description: The new session (also pushed live to the room)
 *         content: { application/json: { schema: { $ref: '#/components/schemas/WatchSession' } } }
 *       400:
 *         description: UNSUPPORTED_LINK — only public TikTok video links and YouTube video/shorts links are accepted
 *         content: { application/json: { schema: { $ref: '#/components/schemas/Error' } } }
 *       401: { $ref: '#/components/responses/Unauthorized' }
 *       404: { $ref: '#/components/responses/NotFound' }
 *   delete:
 *     summary: Stop watching together — clears the room for everyone
 *     tags: [Watch Together]
 *     parameters: [{ $ref: '#/components/parameters/IdPath' }]
 *     responses:
 *       200: { description: Done, content: { application/json: { schema: { $ref: '#/components/schemas/Ok' } } } }
 *       401: { $ref: '#/components/responses/Unauthorized' }
 *       404: { $ref: '#/components/responses/NotFound' }
 * /api/watch/{id}/state:
 *   post:
 *     summary: Tell the room you played, paused, or skipped to a point in the video
 *     description: Broadcast live to everyone else in the room over Socket.IO (event `watch:state`); also saved so a late joiner can catch up near the right spot.
 *     tags: [Watch Together]
 *     parameters: [{ $ref: '#/components/parameters/IdPath' }]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [playing, position_secs]
 *             properties:
 *               playing: { type: boolean }
 *               position_secs: { type: number, minimum: 0 }
 *     responses:
 *       200: { description: Done, content: { application/json: { schema: { $ref: '#/components/schemas/Ok' } } } }
 *       400: { $ref: '#/components/responses/BadRequest' }
 *       401: { $ref: '#/components/responses/Unauthorized' }
 *       404:
 *         description: NOT_FOUND (no such room) or NOT_PLAYING (nothing queued yet)
 *         content: { application/json: { schema: { $ref: '#/components/schemas/Error' } } }
 */

/**
 * @openapi
 * /api/listings:
 *   get:
 *     summary: Everything for sale across every Group / Gist Room I'm in (the Marketplace tab)
 *     tags: [Marketplace]
 *     responses:
 *       200:
 *         description: Listings, newest first
 *         content: { application/json: { schema: { type: array, items: { $ref: '#/components/schemas/Listing' } } } }
 *       401: { $ref: '#/components/responses/Unauthorized' }
 * /api/listings/room/{id}:
 *   get:
 *     summary: Listings posted inside one specific Group / Gist Room
 *     tags: [Marketplace]
 *     parameters: [{ $ref: '#/components/parameters/IdPath' }]
 *     responses:
 *       200:
 *         description: Listings, newest first
 *         content: { application/json: { schema: { type: array, items: { $ref: '#/components/schemas/Listing' } } } }
 *       401: { $ref: '#/components/responses/Unauthorized' }
 *       404: { $ref: '#/components/responses/NotFound' }
 *   post:
 *     summary: List something for sale in this room
 *     tags: [Marketplace]
 *     parameters: [{ $ref: '#/components/parameters/IdPath' }]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [title]
 *             properties:
 *               title: { type: string, minLength: 2, maxLength: 80 }
 *               description: { type: string, maxLength: 500 }
 *               price: { type: string, maxLength: 40, example: "₦15,000" }
 *               photo_url: { type: string, description: A path returned by /api/upload }
 *     responses:
 *       201:
 *         description: Created
 *         content: { application/json: { schema: { $ref: '#/components/schemas/Listing' } } }
 *       400: { $ref: '#/components/responses/BadRequest' }
 *       401: { $ref: '#/components/responses/Unauthorized' }
 *       404: { $ref: '#/components/responses/NotFound' }
 * /api/listings/{id}:
 *   delete:
 *     summary: Remove my own listing
 *     tags: [Marketplace]
 *     parameters: [{ $ref: '#/components/parameters/IdPath' }]
 *     responses:
 *       200: { description: Done, content: { application/json: { schema: { $ref: '#/components/schemas/Ok' } } } }
 *       401: { $ref: '#/components/responses/Unauthorized' }
 * /api/listings/{id}/request:
 *   post:
 *     summary: Ask to buy — connects you to the seller directly. Chatimall never sees or holds any money.
 *     tags: [Marketplace]
 *     parameters: [{ $ref: '#/components/parameters/IdPath' }]
 *     responses:
 *       200:
 *         description: The direct chat with the seller, plus a suggested opening message
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 conversation_id: { type: string }
 *                 starter_message: { type: string, example: 'Hi! I''m interested in "Blue bicycle" — is it still available?' }
 *       400:
 *         description: SELF — you can't buy your own listing
 *         content: { application/json: { schema: { $ref: '#/components/schemas/Error' } } }
 *       401: { $ref: '#/components/responses/Unauthorized' }
 *       404: { $ref: '#/components/responses/NotFound' }
 */
