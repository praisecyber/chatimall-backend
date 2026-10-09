import path from 'node:path';
import { fileURLToPath } from 'node:url';
import swaggerJsdoc from 'swagger-jsdoc';
import swaggerUi from 'swagger-ui-express';

const here = path.dirname(fileURLToPath(import.meta.url)).replace(/\\/g, '/');
const port = process.env.PORT || 4000;

// On Render, RENDER_EXTERNAL_URL is set automatically. You can also set PUBLIC_URL yourself.
const publicUrl = (process.env.PUBLIC_URL || process.env.RENDER_EXTERNAL_URL || '').replace(/\/$/, '');
const servers = [
  ...(publicUrl ? [{ url: publicUrl, description: 'Live server' }] : []),
  { url: `http://localhost:${port}`, description: 'Local development server' },
];

const description = `
REST + realtime API for the Chatimall app. The frontend talks to the backend **only** through this API.

### How to try it
1. Call **POST /api/auth/otp/request** with a phone number, then **POST /api/auth/otp/verify** with the code.
   In development, test numbers from \`TEST_PHONES\` (for example \`+15550001111\`, code \`123456\`) work without SMS.
2. Copy the \`token\` from the verify response, click **Authorize** (top right) and paste it.
3. Every other endpoint is now usable with **Try it out**.

### Realtime (Socket.IO)
Not shown below because OpenAPI cannot describe WebSocket events. Connect with
\`io(BASE_URL, { auth: { token } })\`.

| Server → app | Payload |
|---|---|
| \`message:new\` | Message |
| \`chat:read\` | \`{ conversation_id, user_id, at }\` |
| \`typing\` | \`{ conversation_id, user_id }\` |
| \`channel:post\` | ChannelPost (after \`channel:join\`) |
| \`call:incoming\` | \`{ call_id, type, caller }\` |
| \`call:accepted\` | \`{ call_id }\` |
| \`call:signal\` | \`{ call_id, data: { kind: offer\\|answer\\|ice, payload } }\` |
| \`call:ended\` | \`{ call_id, status, by }\` |
| \`call:log\` | \`{}\` (call history changed) |

| App → server | Payload |
|---|---|
| \`typing\` | \`{ conversation_id }\` |
| \`channel:join\` / \`channel:leave\` | channel id |
| \`call:invite\` | \`{ callee_id, type }\`, ack \`{ call_id }\` or \`{ error }\` |
| \`call:accept\` | \`{ call_id }\` |
| \`call:end\` | \`{ call_id, status }\` |
| \`call:signal\` | \`{ call_id, data }\` |
`;

const options = {
  definition: {
    openapi: '3.0.0',
    info: { title: 'Chatimall API', version: '1.0.0', description },
    servers,
    tags: [
      { name: 'System' },
      { name: 'Auth' },
      { name: 'Profile' },
      { name: 'Files' },
      { name: 'Chats' },
      { name: 'Groups' },
      { name: 'Watch Together' },
      { name: 'Marketplace' },
      { name: 'Status' },
      { name: 'Channels' },
      { name: 'Calls' },
      { name: 'Devices' },
    ],
    components: {
      securitySchemes: {
        bearerAuth: { type: 'http', scheme: 'bearer', bearerFormat: 'JWT' },
      },
    },
    security: [{ bearerAuth: [] }],
  },
  apis: [`${here}/routes/*.js`, `${here}/docs/*.js`],
};

export const swaggerSpec = swaggerJsdoc(options);

export function swaggerDocs(app) {
  if (process.env.DISABLE_DOCS === 'true') return;
  app.use(
    '/api/docs',
    swaggerUi.serve,
    swaggerUi.setup(swaggerSpec, {
      customSiteTitle: 'Chatimall API Docs',
      explorer: true,
      swaggerOptions: { persistAuthorization: true },
    })
  );
  app.get('/api/docs.json', (_req, res) => {
    res.setHeader('Content-Type', 'application/json');
    res.send(swaggerSpec);
  });
}
