//fix 1.0.6
const express = require("express");
const http = require("http");
const WebSocket = require("ws");
const path = require("path");

const app = express();

app.use(express.static(path.join(__dirname, "public")));

const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

const PORT = process.env.PORT || 10000;

const rooms = new Map();

function send(ws, obj) {
  try { ws.send(JSON.stringify(obj)); }
  catch (e) { /* ignore */ }
}

wss.on("connection", (ws) => {
  ws._rooms = new Set();

  ws.on("message", (raw) => {
    let d;
    try { d = JSON.parse(raw); } catch (e) { return; }
    const { type, room } = d;

    if (type === "create") {
      if (!room) return send(ws, { type: "error", message: "Missing room" });
      if (rooms.has(room)) return send(ws, { type: "error", message: "Room exists" });
      rooms.set(room, new Set([ws]));
      ws._rooms.add(room);
      return send(ws, { type: "created", room });
    }

    if (type === "join") {
      if (!room) return send(ws, { type: "error", message: "Missing room" });
      if (!rooms.has(room)) return send(ws, { type: "no-room", message: "Room not found" });
      const clients = rooms.get(room);
      clients.add(ws);
      ws._rooms.add(room);
      return send(ws, { type: "joined", room });
    }

    if (type === "leave") {
      if (!room) return;
      if (!rooms.has(room)) return;
      const clients = rooms.get(room);
      clients.delete(ws);
      ws._rooms.delete(room);
      if (clients.size === 0) rooms.delete(room);
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
          meta: d.meta || {},
        });
      }
      return;
    }

    if (type === "exists") {
      return send(ws, { type: "exists", room, exists: rooms.has(room) });
    }
  });

  ws.on("close", () => {
    for (const room of ws._rooms) {
      if (!rooms.has(room)) continue;
      const clients = rooms.get(room);
      clients.delete(ws);
      if (clients.size === 0) rooms.delete(room);
    }
  });

  ws.isAlive = true;
  ws.on('pong', () => ws.isAlive = true);
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
