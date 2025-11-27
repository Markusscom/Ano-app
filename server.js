const express = require("express");
const http = require("http");
const WebSocket = require("ws");
const path = require("path");
const { randomUUID } = require("crypto");

const app = express();

app.use(express.static(path.join(__dirname, "public")));

const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

const PORT = process.env.PORT || 10000;

const rooms = new Map();

function send(ws, obj) {
  try { ws.send(JSON.stringify(obj)); } catch (e) {}
}

function broadcast(room, obj) {
  const clients = rooms.get(room);
  if (!clients) return;
  const msg = JSON.stringify(obj);
  for (const c of clients) {
    try { c.send(msg); } catch (e) {}
  }
}

function broadcastUsers(room) {
  const clients = rooms.get(room);
  if (!clients) return;
  const users = Array.from(clients).map(c => ({
    id: c.id,
    username: c.username || null
  }));
  broadcast(room, { type: "users", room, users });
}

function broadcastEvent(room, event, data = {}) {
  broadcast(room, { type: "event", room, event, ...data });
}

wss.on("connection", (ws) => {
  ws.id = randomUUID();
  ws.username = null;
  ws._rooms = new Set();
  ws.creatorRooms = new Set();
  ws.isAlive = true;

  send(ws, { type: "hello", id: ws.id });

  ws.on("pong", () => {
    ws.isAlive = true;
  });

  ws.on("message", (raw) => {
    let d;
    try { d = JSON.parse(raw); } catch (e) { return; }
    const { type, room } = d;

    if (type === "create") {
      if (!room) return send(ws, { type: "error", message: "Missing room" });
      if (rooms.has(room)) return send(ws, { type: "error", message: "Room exists" });

      const set = new Set();
      set.add(ws);
      rooms.set(room, set);

      ws._rooms.add(room);
      ws.creatorRooms.add(room);
      ws.username = d.username || null;

      send(ws, { type: "created", room });
      broadcastUsers(room);
      broadcastEvent(room, "join", { username: ws.username || null });
      return;
    }

    if (type === "join") {
      if (!room) return send(ws, { type: "error", message: "Missing room" });
      if (!rooms.has(room)) return send(ws, { type: "no-room", message: "Room not found" });

      const clients = rooms.get(room);
      clients.add(ws);
      ws._rooms.add(room);
      ws.username = d.username || null;

      send(ws, { type: "joined", room });
      broadcastUsers(room);
      broadcastEvent(room, "join", { username: ws.username || null });
      return;
    }

    if (type === "leave") {
      if (!room || !rooms.has(room)) return;
      const clients = rooms.get(room);
      if (clients.has(ws)) {
        clients.delete(ws);
        ws._rooms.delete(room);
        broadcastEvent(room, "leave", { username: ws.username || null });
        if (clients.size === 0) {
          rooms.delete(room);
        } else {
          broadcastUsers(room);
        }
      }
      return;
    }

    if (type === "message") {
      if (!room || !rooms.has(room)) return;
      const clients = rooms.get(room);
      for (const c of clients) {
        if (c === ws) continue;
        send(c, {
          type: "message",
          room,
          username: d.username || null,
          iv: d.iv,
          ciphertext: d.ciphertext,
          meta: d.meta || {}
        });
      }
      return;
    }

    if (type === "exists") {
      return send(ws, { type: "exists", room, exists: rooms.has(room) });
    }

    if (type === "kick") {
      if (!room || !rooms.has(room)) return;
      if (!ws.creatorRooms.has(room)) {
        return send(ws, { type: "error", message: "Not authorized" });
      }
      const targetId = d.targetId;
      if (!targetId) return;

      const clients = rooms.get(room);
      let target = null;
      for (const c of clients) {
        if (c.id === targetId) { target = c; break; }
      }
      if (!target) return;

      send(target, { type: "kicked", room });
      target.close(4000, "kicked");
      clients.delete(target);
      target._rooms.delete(room);

      broadcastEvent(room, "kick", { username: target.username || null });
      if (clients.size === 0) {
        rooms.delete(room);
      } else {
        broadcastUsers(room);
      }
      return;
    }
  });

  ws.on("close", () => {
    for (const room of ws._rooms) {
      const clients = rooms.get(room);
      if (!clients) continue;
      if (clients.has(ws)) {
        clients.delete(ws);
        broadcastEvent(room, "leave", { username: ws.username || null });
        if (clients.size === 0) {
          rooms.delete(room);
        } else {
          broadcastUsers(room);
        }
      }
    }
  });
});

setInterval(() => {
  wss.clients.forEach((ws) => {
    if (!ws.isAlive) return ws.terminate();
    ws.isAlive = false;
    ws.ping();
  });
}, 30000);

app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "client.html"));
});

server.listen(PORT, () => {
  console.log(`Server listening on port ${PORT}`);
});
