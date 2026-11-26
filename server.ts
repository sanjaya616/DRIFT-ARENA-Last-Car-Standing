import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';
import { WebSocketServer, WebSocket } from 'ws';
import { getApp, getApps, initializeApp } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { RoomManager } from './server/RoomManager.ts';
import type { ServerToClientMessage } from './src/multiplayer/protocol.ts';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

function loadFirebaseProjectId(): string | null {
  try {
    const configPath = path.resolve(__dirname, 'firebase-applet-config.json');
    if (!fs.existsSync(configPath)) return null;
    const raw = JSON.parse(fs.readFileSync(configPath, 'utf8')) as { projectId?: unknown };
    return typeof raw.projectId === 'string' && raw.projectId.length > 0 ? raw.projectId : null;
  } catch {
    return null;
  }
}

const firebaseProjectId = loadFirebaseProjectId();
let firebaseAuthVerifier: ((idToken: string) => Promise<string | null>) | undefined;

if (firebaseProjectId) {
  try {
    const adminApp = getApps().length
      ? getApp()
      : initializeApp({ projectId: firebaseProjectId });
    const adminAuth = getAuth(adminApp);
    firebaseAuthVerifier = async (idToken: string): Promise<string | null> => {
      try {
        const decoded = await adminAuth.verifyIdToken(idToken);
        return decoded.uid || null;
      } catch {
        return null;
      }
    };
  } catch {
    firebaseAuthVerifier = undefined;
  }
}

async function startServer(): Promise<void> {
  const app = express();
  app.use(express.json({ limit: '64kb' }));

  const roomManager = new RoomManager(true);

  app.get('/api/health', (_req, res) => {
    res.json({
      ok: true,
      rooms: roomManager.rooms.size,
      sessions: roomManager.sessions.size,
      uptimeSec: Math.round(process.uptime()),
    });
  });

  app.get('/api/rooms', (_req, res) => {
    res.json({
      rooms: roomManager.listPublicLobbySummaries(),
    });
  });

  const server = http.createServer(app);
  const wss = new WebSocketServer({ noServer: true, maxPayload: 16 * 1024 });

  server.on('upgrade', (request, socket, head) => {
    try {
      const url = new URL(request.url || '/', `http://${request.headers.host || 'localhost'}`);
      if (url.pathname !== '/ws') {
        socket.destroy();
        return;
      }
      wss.handleUpgrade(request, socket, head, (ws) => {
        wss.emit('connection', ws, request);
      });
    } catch {
      socket.destroy();
    }
  });

  wss.on('connection', (ws: WebSocket) => {
    const send = (msg: ServerToClientMessage): void => {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify(msg));
      }
    };

    const session = roomManager.createSession(send);
    send({
      type: 'welcome',
      playerId: session.playerId,
      reconnectToken: session.reconnectToken,
      displayName: session.displayName,
      verifiedUid: session.verifiedUid,
    });

    ws.on('message', (data) => {
      try {
        const text = typeof data === 'string' ? data : data.toString('utf8');
        const parsed: unknown = JSON.parse(text);
        void roomManager.handleMessage(session, parsed, firebaseAuthVerifier);
      } catch {
        send({ type: 'error', code: 'BAD_JSON', message: 'Invalid WebSocket payload.' });
      }
    });

    ws.on('close', () => {
      roomManager.handleDisconnect(session.playerId);
    });

    ws.on('error', () => {
      roomManager.handleDisconnect(session.playerId);
    });
  });

  const isProd = process.env.NODE_ENV === 'production';
  if (!isProd) {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      root: __dirname,
      server: {
        middlewareMode: true,
        hmr: false,
      },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distDir = path.resolve(__dirname, 'dist');
    app.use(express.static(distDir));
    app.get('/{*splat}', (_req, res) => {
      res.sendFile(path.join(distDir, 'index.html'));
    });
  }

  const port = Number(process.env.PORT) || 3000;
  server.listen(port, '0.0.0.0', () => {
    console.log(`DRIFT ARENA server listening on http://0.0.0.0:${port}`);
  });

  const shutdown = () => {
    roomManager.dispose();
    wss.close();
    server.close(() => process.exit(0));
  };
  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);
}

startServer().catch((err) => {
  console.error('Failed to start DRIFT ARENA server:', err);
  process.exit(1);
});
