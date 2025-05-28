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
  connectionStateRecovery: {
    // Enable reconnection with state recovery
    maxDisconnectionDuration: 2 * 60 * 1000, // 2 minutes
    skipMiddlewares: true,
  },
});

// In-memory storage for rooms and device mappings
const rooms = new Map(); // Map<pin, roomData>
const deviceRoomMap = new Map(); // Map<deviceId, pin>
const socketToDeviceMap = new Map(); // Map<socketId, deviceId>

/**
 * Generates a unique 6-digit PIN that's not already in use
 * @returns {string} A 6-digit PIN
 */
function generateUniquePIN() {
  let pin;
  do {
    pin = Math.floor(100000 + Math.random() * 900000).toString();
  } while (rooms.has(pin));
  return pin;
}

/**
 * Gets host information (IP and hostname)
 * @returns {Object} Host information
 */

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

// Handle socket connection events
io.on('connection', (socket) => {
  console.log('New socket connected:', socket.id);

  // Handle room creation
  socket.on('create_room', ({ nickname, limit }, callback) => {
    try {
      if (!nickname || !limit || limit < 2) {
        return callback({ error: 'Se requiere un nombre y un límite válido (mínimo 2 participantes)' });
      }

      const pin = generateUniquePIN();
      const roomData = {
        hostSocketId: socket.id,
        limit: parseInt(limit, 10),
        users: [],
        createdAt: new Date(),
      };

      rooms.set(pin, roomData);
      socket.join(pin);
      
      console.log(`Room ${pin} created by ${nickname} (${socket.id})`);
      
      // Send success response
      callback({ 
        success: true, 
        pin,
        participants: 1,
        limit: roomData.limit 
      });
      
      // Send host information
      socket.emit('host_info', getHostInfo());
      
    } catch (error) {
      console.error('Error creating room:', error);
      callback({ error: 'Error al crear la sala. Por favor, inténtalo de nuevo.' });
    }
  });

  // Handle joining a room
  socket.on('join_room', ({ pin, nickname, deviceId }, callback) => {
    try {
      if (!pin || !nickname || !deviceId) {
        return callback({ error: 'Datos de conexión incompletos' });
      }

      const room = rooms.get(pin);

      if (!room) {
        return callback({ error: 'PIN inválido. La sala no existe.' });
      }

      if (room.users.length >= room.limit) {
        return callback({ error: `La sala está llena (${room.limit}/${room.limit} participantes).` });
      }

      // Check if device is already in another room
      if (deviceRoomMap.has(deviceId) && deviceRoomMap.get(deviceId) !== pin) {
        return callback({ error: 'Este dispositivo ya está en otra sala.' });
      }

      // Check if device is already in this room
      const userExists = room.users.some(user => user.deviceId === deviceId);
      if (userExists) {
        return callback({ error: 'Ya estás en esta sala desde este dispositivo.' });
      }

      // Add user to room
      const user = { socketId: socket.id, nickname, deviceId, joinedAt: new Date() };
      room.users.push(user);
      deviceRoomMap.set(deviceId, pin);
      socketToDeviceMap.set(socket.id, deviceId);

      // Join the room
      socket.join(pin);

      // Send success response
      callback({ 
        success: true,
        pin,
        participants: room.users.length,
        limit: room.limit
      });

      // Notify room about new participant
      io.to(pin).emit('room_update', {
        participants: room.users.length,
        limit: room.limit,
        userJoined: nickname
      });

      console.log(`${nickname} (${deviceId}) joined room ${pin}`);
      
      // Send host information to the new user
      socket.emit('host_info', getHostInfo());
      
    } catch (error) {
      console.error('Error joining room:', error);
      callback({ error: 'Error al unirse a la sala. Por favor, inténtalo de nuevo.' });
    }
  });

  // Handle sending messages
  socket.on('send_message', ({ pin, autor, message }) => {
    try {
      if (!pin || !autor || !message) return;
      
      const room = rooms.get(pin);
      if (!room) return;
      
      // Broadcast message to room
      io.to(pin).emit('receive_message', { 
        autor, 
        message: message.trim(),
        timestamp: new Date().toISOString()
      });
      
    } catch (error) {
      console.error('Error sending message:', error);
    }
  });

  // Handle disconnection
  socket.on('disconnect', () => {
    const deviceId = socketToDeviceMap.get(socket.id);
    
    if (deviceId) {
      const pin = deviceRoomMap.get(deviceId);
      
      if (pin) {
        const room = rooms.get(pin);
        
        if (room) {
          const userIndex = room.users.findIndex(u => u.socketId === socket.id);
          
          if (userIndex !== -1) {
            const user = room.users[userIndex];
            console.log(`${user.nickname} (${deviceId}) left room ${pin}`);
            
            // Remove user from room
            room.users.splice(userIndex, 1);
            
            // Clean up mappings
            deviceRoomMap.delete(deviceId);
            socketToDeviceMap.delete(socket.id);
            
            // Notify room about user leaving
            io.to(pin).emit('room_update', {
              participants: room.users.length,
              limit: room.limit,
              userLeft: user.nickname
            });
            
            // If room is empty, schedule for cleanup
            if (room.users.length === 0) {
              console.log(`Room ${pin} is empty, scheduling for cleanup`);
              setTimeout(() => {
                if (rooms.has(pin) && rooms.get(pin).users.length === 0) {
                  rooms.delete(pin);
                  console.log(`Room ${pin} has been removed`);
                }
              }, 300000); // 5 minutes before removing empty room
            }
          }
        }
      }
    }
    
    console.log('Socket disconnected:', socket.id);
  });
});

// Add health check endpoint
app.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    rooms: rooms.size,
    connectedDevices: deviceRoomMap.size,
    activeSockets: socketToDeviceMap.size,
    memoryUsage: process.memoryUsage(),
    uptime: process.uptime()
  });
});

// Add endpoint to get room info (for debugging)
app.get('/room/:pin', (req, res) => {
  const { pin } = req.params;
  const room = rooms.get(pin);
  
  if (!room) {
    return res.status(404).json({ error: 'Sala no encontrada' });
  }
  
  res.json({
    pin,
    createdAt: room.createdAt,
    limit: room.limit,
    participantCount: room.users.length,
    participants: room.users.map(u => ({
      nickname: u.nickname,
      deviceId: u.deviceId,
      joinedAt: u.joinedAt,
      connected: io.sockets.sockets.get(u.socketId) ? true : false
    }))
  });
});

// Start the server
const PORT = process.env.PORT || 3003;
server.listen(PORT, '0.0.0.0', () => {
  console.log(`🚀 Servidor Socket.IO escuchando en puerto ${PORT}`);
  console.log(`📡 WebSocket disponible en ws://localhost:${PORT}`);
  console.log(`🌐 Health check disponible en http://localhost:${PORT}/health`);
  console.log(`🔍 Para ver el estado de una sala: http://localhost:${PORT}/room/:pin`);
});

// Handle graceful shutdown
process.on('SIGTERM', () => {
  console.log('Recibida señal SIGTERM. Cerrando servidor...');
  io.close(() => {
    console.log('Servidor Socket.IO cerrado');
    process.exit(0);
  });
  
  // Force close after 5 seconds
  setTimeout(() => {
    console.error('Forzando cierre del servidor...');
    process.exit(1);
  }, 5000);
});
