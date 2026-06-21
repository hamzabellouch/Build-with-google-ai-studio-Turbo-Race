/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
*/

import express from "express";
import { createServer } from "http";
import { Server } from "socket.io";
import { createServer as createViteServer } from "vite";

async function startServer() {
  const app = express();
  const httpServer = createServer(app);
  const io = new Server(httpServer);
  const PORT = 3000;

  // Game State
  type Player = {
    id: string;
    x: number;
    y: number;
    angle: number;
    color: string;
    name: string;
    speed: number;
    laps: number;
    bestLapTime: number; // milliseconds, Infinity if none
    lastLapStart: number;
    nitro: number;
    drifting: boolean;
  };

  type Room = {
    id: string;
    players: Record<string, Player>;
    status: 'waiting' | 'racing';
    hostId: string;
  };

  const rooms: Record<string, Room> = {};
  const socketRoomMap: Record<string, string> = {};

  const TRACK_WIDTH = 1200;
  const TRACK_HEIGHT = 850;

  // Helper to generate room code
  const generateRoomCode = () => {
    return Math.random().toString(36).substring(2, 8).toUpperCase();
  };

  const COLORS = [
    { name: 'Red', value: 'hsl(0, 70%, 50%)' },
    { name: 'Blue', value: 'hsl(210, 70%, 50%)' },
    { name: 'Green', value: 'hsl(120, 70%, 50%)' },
    { name: 'Yellow', value: 'hsl(60, 70%, 50%)' },
    { name: 'Purple', value: 'hsl(280, 70%, 50%)' },
    { name: 'Orange', value: 'hsl(30, 70%, 50%)' },
    { name: 'Cyan', value: 'hsl(180, 70%, 50%)' },
    { name: 'Pink', value: 'hsl(330, 70%, 50%)' },
  ];

  const createPlayer = (id: string, colorInfo: { name: string, value: string }): Player => ({
    id,
    x: 650 + (Math.random() * 40 - 20),
    y: 750 + (Math.random() * 20 - 10),
    angle: Math.PI,
    color: colorInfo.value,
    name: colorInfo.name,
    speed: 0,
    laps: 0,
    bestLapTime: Infinity,
    lastLapStart: Date.now(),
    nitro: 100,
    drifting: false,
  });

  // Socket.io Logic
  io.on("connection", (socket) => {
    console.log(`Player connected: ${socket.id}`);

    // Room Management
    socket.on("createRoom", () => {
      const roomId = generateRoomCode();
      const colorInfo = COLORS[0];
      const newPlayer = createPlayer(socket.id, colorInfo);
      
      rooms[roomId] = {
        id: roomId,
        players: { [socket.id]: newPlayer },
        status: 'waiting',
        hostId: socket.id
      };
      
      socketRoomMap[socket.id] = roomId;
      socket.join(roomId);
      
      socket.emit("roomCreated", { roomId, players: rooms[roomId].players, isHost: true });
    });

    socket.on("joinRoom", ({ roomId }) => {
      if (rooms[roomId] && rooms[roomId].status === 'waiting') {
        const room = rooms[roomId];
        const usedColors = Object.values(room.players).map(p => p.name);
        const availableColor = COLORS.find(c => !usedColors.includes(c.name)) || COLORS[Math.floor(Math.random() * COLORS.length)];
        
        const newPlayer = createPlayer(socket.id, availableColor);
        
        room.players[socket.id] = newPlayer;
        socketRoomMap[socket.id] = roomId;
        socket.join(roomId);
        
        // Notify the joiner
        socket.emit("roomJoined", { roomId, players: room.players, isHost: false });
        
        // Notify others in the room
        socket.to(roomId).emit("playerJoinedRoom", newPlayer);
      } else {
        socket.emit("error", "Room not found or game already started");
      }
    });

    socket.on("startGame", () => {
      const roomId = socketRoomMap[socket.id];
      if (roomId && rooms[roomId] && rooms[roomId].hostId === socket.id) {
        rooms[roomId].status = 'racing';
        io.to(roomId).emit("gameStarted", rooms[roomId].players);
      }
    });

    // Game Events (Scoped to Room)
    socket.on("playerMovement", (movementData) => {
      const roomId = socketRoomMap[socket.id];
      if (roomId && rooms[roomId]) {
        const player = rooms[roomId].players[socket.id];
        if (player) {
          player.x = movementData.x;
          player.y = movementData.y;
          player.angle = movementData.angle;
          player.speed = movementData.speed;
          player.nitro = movementData.nitro;
          player.drifting = movementData.drifting;
          
          socket.to(roomId).emit("playerMoved", player);
        }
      }
    });

    socket.on("lapFinished", (lapTime) => {
      const roomId = socketRoomMap[socket.id];
      if (roomId && rooms[roomId]) {
        const player = rooms[roomId].players[socket.id];
        if (player) {
          player.laps += 1;
          if (lapTime < player.bestLapTime) {
            player.bestLapTime = lapTime;
          }
          player.lastLapStart = Date.now();
          io.to(roomId).emit("lapUpdate", { id: player.id, laps: player.laps, bestLapTime: player.bestLapTime });
        }
      }
    });

    socket.on("disconnect", () => {
      const roomId = socketRoomMap[socket.id];
      if (roomId && rooms[roomId]) {
        delete rooms[roomId].players[socket.id];
        delete socketRoomMap[socket.id];
        
        io.to(roomId).emit("playerDisconnected", socket.id);
        
        // If room is empty, delete it
        if (Object.keys(rooms[roomId].players).length === 0) {
          delete rooms[roomId];
        } else if (rooms[roomId].hostId === socket.id) {
            // Assign new host if host left
            const newHostId = Object.keys(rooms[roomId].players)[0];
            rooms[roomId].hostId = newHostId;
            io.to(roomId).emit("hostMigrated", newHostId);
        }
      }
    });
  });

  // Vite middleware for development
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    // Production static file serving (if needed later)
    app.use(express.static("dist"));
  }

  httpServer.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer();
