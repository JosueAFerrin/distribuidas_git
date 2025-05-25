const express = require('express');
const http = require('http');
const cors = require('cors');
const { Server } = require('socket.io');
const os = require('os');

const app = express();
app.use(cors());

const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: '*',
    methods: ['GET', 'POST'],
  },
});

const rooms = {}; // { pin: { hostSocketId, limit, users: [{ socketId, nickname, deviceId }] } }
const deviceRoomMap = {}; // deviceId -> pin

function generatePIN() {
  return Math.floor(100000 + Math.random() * 900000).toString(); // 6-digit PIN
}

function getHostInfo() {
  const interfaces = os.networkInterfaces();
  for (const iface in interfaces) {
    for (const ifaceData of interfaces[iface]) {
      if (ifaceData.family === 'IPv4' && !ifaceData.internal) {
        return {
          ip: ifaceData.address,
          hostname: os.hostname(),
        };
      }
    }
  }
  return { ip: 'unknown', hostname: os.hostname() };
}

io.on('connection', (socket) => {
  console.log('Nuevo socket conectado:', socket.id);

  socket.on('create_room', ({ nickname, limit }) => {
    const pin = generatePIN();
    rooms[pin] = {
      hostSocketId: socket.id,
      limit,
      users: [],
    };
    socket.join(pin);
    console.log(`Sala ${pin} creada por ${nickname}`);
    socket.emit('room_created', { pin });
    socket.emit('host_info', getHostInfo());
  });

  socket.on('join_room', ({ pin, nickname, deviceId }) => {
    const room = rooms[pin];

    if (!room) {
      socket.emit('error_join', 'PIN inválido. La sala no existe.');
      return;
    }

    if (room.users.length >= room.limit) {
      socket.emit('error_join', 'La sala está llena.');
      return;
    }

    // Verificar si el dispositivo ya está en otra sala distinta
    if (deviceRoomMap[deviceId] && deviceRoomMap[deviceId] !== pin) {
      socket.emit('error_join', 'Este dispositivo ya está en otra sala.');
      return;
    }

    // Verificar si ya está en esta misma sala
    const alreadyInRoom = room.users.some((user) => user.deviceId === deviceId);
    if (alreadyInRoom) {
      socket.emit('error_join', 'Este dispositivo ya está en esta sala.');
      return;
    }

    room.users.push({ socketId: socket.id, nickname, deviceId });
    deviceRoomMap[deviceId] = pin;

    socket.join(pin);

    socket.emit('joined_room', { pin });
    io.to(pin).emit('room_update', {
      participants: room.users.length,
      limit: room.limit,
    });

    console.log(`${nickname} se unió a la sala ${pin} desde dispositivo ${deviceId}`);

    socket.emit('host_info', getHostInfo());
  });

  socket.on('send_message', ({ pin, autor, message }) => {
    io.to(pin).emit('receive_message', { autor, message });
  });

  socket.on('disconnect', () => {
    console.log('Socket desconectado:', socket.id);
    for (const pin in rooms) {
      const room = rooms[pin];
      const userIndex = room.users.findIndex((u) => u.socketId === socket.id);
      if (userIndex !== -1) {
        const removed = room.users.splice(userIndex, 1)[0];
        console.log(`${removed.nickname} salió de la sala ${pin}`);

        // Limpiar deviceRoomMap
        if (removed.deviceId && deviceRoomMap[removed.deviceId]) {
          delete deviceRoomMap[removed.deviceId];
        }

        io.to(pin).emit('room_update', {
          participants: room.users.length,
          limit: room.limit,
        });

        if (room.users.length === 0) {
          console.log(`Eliminando sala vacía ${pin}`);
          delete rooms[pin];
        }
        break;
      }
    }
  });
});

server.listen(3003, () => {
  console.log('Servidor Socket.IO escuchando en puerto 3003');
});
