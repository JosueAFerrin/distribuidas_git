import React, { useState, useEffect, useRef, useCallback, FC } from 'react';
import { io, Socket } from 'socket.io-client';
import { Card } from 'primereact/card';
import { InputText } from 'primereact/inputtext';
import { Button } from 'primereact/button';
import { InputTextarea } from 'primereact/inputtextarea';
import { Toast } from 'primereact/toast';
import { ProgressSpinner } from 'primereact/progressspinner';
import { Message } from 'primereact/message';
import { Divider } from 'primereact/divider';

// Extend the Window interface to include the crypto object
declare global {
  interface Window {
    crypto: {
      randomUUID: () => string;
    };
  }
}

// Helper function to get or create a unique device ID
function getOrCreateDeviceId(): string {
  let id = localStorage.getItem('deviceId');
  if (!id) {
    // Use the crypto API if available, otherwise generate a simple random string
    id = window.crypto?.randomUUID() || 
          Math.random().toString(36).substring(2, 15) + 
          Math.random().toString(36).substring(2, 15);
    localStorage.setItem('deviceId', id);
  }
  return id;
}

// Constants
const SOCKET_SERVER_URL = process.env.REACT_APP_SOCKET_URL || 'http://localhost:3003';
const MAX_MESSAGE_LENGTH = 1000;
const MAX_NICKNAME_LENGTH = 20;

// Types
interface ChatMessage {
  autor: string;
  message: string;
  type: 'user' | 'system';
  timestamp: string;
}

interface HostInfo {
  hostname: string;
  ip: string;
}

interface RoomUpdate {
  participants: number;
  limit: number | string;
  hostname?: string;
  ip?: string;
  userJoined?: string;
  userLeft?: string;
}

const Chat: FC = () => {
  // Refs
  const socketRef = useRef<Socket | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const toast = useRef<Toast>(null);
  
  // State
  const [isConnecting, setIsConnecting] = useState<boolean>(false);
  const [connected, setConnected] = useState<boolean>(false);
  const [roomPIN, setRoomPIN] = useState<string>('');
  const [nickname, setNickname] = useState<string>('');
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [hostInfo, setHostInfo] = useState<HostInfo | null>(null);
  const [participants, setParticipants] = useState<number>(0);
  const [limit, setLimit] = useState<number>(5);
  const [joinPIN, setJoinPIN] = useState<string>('');
  const [lastActivity, setLastActivity] = useState<Date | null>(null);
  const [message, setMessage] = useState<string>('');

  // Helper functions
  const showError = useCallback((summary: string, detail: string) => {
    toast.current?.show({
      severity: 'error',
      summary,
      detail,
      life: 5000
    });
  }, []);

  const showSuccess = useCallback((summary: string, detail: string) => {
    toast.current?.show({
      severity: 'success',
      summary,
      detail,
      life: 3000
    });
    addSystemMessage(detail);
  }, []);

  const addSystemMessage = useCallback((text: string) => {
    const systemMessage: ChatMessage = {
      autor: 'Sistema',
      message: text,
      type: 'system',
      timestamp: new Date().toISOString()
    };
    console.log('Mensaje del sistema:', systemMessage);
    setMessages(prev => [...prev, systemMessage]);
    // Hacer scroll al final de los mensajes
    setTimeout(() => {
      messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }, 100);
  }, []);

  // Initialize socket connection when component mounts
  useEffect(() => {
    console.log('Initializing socket connection to:', SOCKET_SERVER_URL);
    setIsConnecting(true);

    // Helper function to emit socket events with type safety
    const emitEvent = (event: string, data: Record<string, unknown>): void => {
      if (socketRef.current) {
        console.log('Emitting event:', event, data);
        socketRef.current.emit(event, data);
      }
    };

    // Helper function to listen to socket events with type safety
    const onEvent = <T = unknown>(
      event: string,
      callback: (data: T) => void
    ): (() => void) => {
      if (socketRef.current) {
        console.log('Setting up listener for event:', event);
        const handler = (data: T) => callback(data);
        socketRef.current.on(event, handler);
        return () => {
          if (socketRef.current) {
            socketRef.current.off(event, handler);
          }
        };
      }
      return () => {};
    };

    let socket: Socket;
    try {
      // Initialize socket connection
      socket = io(SOCKET_SERVER_URL, {
        reconnectionAttempts: 5,
        reconnectionDelay: 1000,
        timeout: 10000,
        transports: ['websocket', 'polling'],
        autoConnect: true,
        withCredentials: true,
        extraHeaders: {
          'Access-Control-Allow-Origin': '*',
        },
      });

      // Store the socket in the ref
      socketRef.current = socket;
      console.log('Socket instance created, waiting for connection...');

      // Connection established
      const onConnect = () => {
        if (!socket.connected) return;
        
        console.log('Connected to server with ID:', socket.id);
        setConnected(true);
        setIsConnecting(false);
        setLastActivity(new Date());
        showSuccess('Conectado', 'Conexión establecida con el servidor');
        
        // Request initial room info if we have a room PIN
        if (roomPIN) {
          console.log('Requesting room info for PIN:', roomPIN);
          emitEvent('get_room_info', { pin: roomPIN });
        }
      };

      // Set up event listeners with proper type annotations
      socket.on('connect', onConnect);

      // Connection error handler
      socket.on('connect_error', (error: Error) => {
        console.error('Connection error:', error);
        showError('Error de conexión', `No se pudo conectar al servidor: ${error.message}`);
        setIsConnecting(false);
        setConnected(false);
      });

      // Handle disconnection
      socket.on('disconnect', (reason: string) => {
        console.log('Disconnected from server. Reason:', reason);
        if (reason === 'io server disconnect') {
          console.log('Server disconnected. Attempting to reconnect...');
          socket.connect();
        }
        setConnected(false);
      });

      // Handle successful reconnection using the manager
      const manager = (socket as any).io;
      if (manager) {
        manager.on('reconnect', (attempt: number) => {
          console.log(`Reconnected after ${attempt} attempts`);
          setConnected(true);
          setIsConnecting(false);
          showSuccess('Reconectado', 'Conexión restablecida con el servidor');
        });
      }

      // Host information (if needed)
      onEvent<HostInfo>('host_info', (data) => {
        console.log('Received host info:', data);
        setHostInfo(data);
        setConnected(true);
        setIsConnecting(false);
      });

      // Room information (if available)
      onEvent<{ hostname?: string; ip?: string }>('room_info', (data) => {
        console.log('Received room info:', data);
        setHostInfo({
          hostname: data?.hostname || 'Desconocido',
          ip: data?.ip || 'Desconocido'
        });
        setConnected(true);
        setIsConnecting(false);
      });

      // New message received
      onEvent<ChatMessage>('receive_message', (msg) => {
        console.log('Mensaje recibido:', msg);
        setMessages((prev) => [...prev, msg]);
        setLastActivity(new Date());
        // Hacer scroll al final de los mensajes
        setTimeout(() => {
          messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
        }, 100);
      });

      // Room update (participants, limit, etc.)
      onEvent<RoomUpdate>('room_update', (data) => {
        setParticipants(data.participants);
        // Ensure limit is always a number
        const newLimit = typeof data.limit === 'string' ? parseInt(data.limit, 10) : data.limit;
        if (!isNaN(newLimit)) {
          setLimit(newLimit);
        }

        setHostInfo({
          hostname: data.hostname || 'Desconocido',
          ip: data.ip || 'Desconocido'
        });

        if (data.userJoined) {
          addSystemMessage(`${data.userJoined} se ha unido a la sala`);
        }

        if (data.userLeft) {
          addSystemMessage(`${data.userLeft} ha abandonado la sala`);
        }
      });

      // Error joining room
      onEvent<{ error: string }>('error_join', (error) => {
        showError('Error al unirse', error?.error || 'Error desconocido');
        handleDisconnect();
      });

      // Cleanup on unmount
      return () => {
        console.log('Cleaning up socket connection');
        if (socket.connected) {
          socket.disconnect();
        }
      };
    } catch (error) {
      console.error('Failed to create socket connection:', error);
      showError('Error de conexión', 'No se pudo inicializar la conexión con el servidor');
      setIsConnecting(false);
      return;
    }

    // Connection established
    const onConnect = () => {
      if (!socket.connected) return;
      
      console.log('Connected to server with ID:', socket.id);
      setConnected(true);
      setIsConnecting(false);
      setLastActivity(new Date());
      showSuccess('Conectado', 'Conexión establecida con el servidor');
      
      // Request initial room info if we have a room PIN
      if (roomPIN) {
        console.log('Requesting room info for PIN:', roomPIN);
        socket.emit('get_room_info', { pin: roomPIN });
      }
    };
    
    // Set up debug logging
    const setupDebugLogging = () => {
      if (!socket) return;
      
      // Log all emitted events
      const originalEmit = socket.emit.bind(socket) as Socket['emit'];
      (socket as any).emit = (event: string, ...args: any[]) => {
        console.log('Emitting event:', event, args);
        return originalEmit(event, ...args);
      };
      
      // Log all event listeners
      const originalOn = socket.on.bind(socket) as Socket['on'];
      (socket as any).on = (event: string, ...args: any[]) => {
        console.log('Setting up listener for event:', event);
        return (originalOn as any)(event, ...args);
      };
    };
    
    // Set up event listeners
    socket.on('connect', onConnect);
    setupDebugLogging();

    // Connection error
    socket.on('connect_error', (error) => {
      console.error('Connection error:', error);
      showError('Error de conexión', `No se pudo conectar al servidor: ${error.message}`);
      setIsConnecting(false);
      setConnected(false);
    });

    // Handle disconnection
    socket.on('disconnect', (reason) => {
      console.log('Disconnected from server. Reason:', reason);
      if (reason === 'io server disconnect') {
        // The disconnection was initiated by the server, you need to reconnect manually
        console.log('Server disconnected. Attempting to reconnect...');
        socket.connect();
      }
      setConnected(false);
    });

    // Handle successful reconnection
    socket.io.on('reconnect', (attempt) => {
      console.log(`Reconnected after ${attempt} attempts`);
      setConnected(true);
      setIsConnecting(false);
      showSuccess('Reconectado', 'Conexión restablecida con el servidor');
    });

    // Host information (if needed)
    socket.on('host_info', (data: HostInfo) => {
      console.log('Received host info:', data);
      setHostInfo(data);
      setConnected(true);
      setIsConnecting(false);
    });

    // Room information (if available)
    socket.on('room_info', (data: any) => {
      console.log('Received room info:', data);
      setHostInfo({
        hostname: data.hostname || 'Desconocido',
        ip: data.ip || 'Desconocido'
      });
      setConnected(true);
      setIsConnecting(false);
    });

    // New message received
    socket.on('receive_message', (msg: ChatMessage) => {
      setMessages((prev) => [...prev, { ...msg, type: 'user' }]);
      setLastActivity(new Date());
    });

    // Room update (participants, limit, etc.)
    socket.on('room_update', (data: RoomUpdate) => {
      setParticipants(data.participants);
      // Ensure limit is always a number
      const newLimit = typeof data.limit === 'string' ? parseInt(data.limit, 10) : data.limit;
      if (!isNaN(newLimit)) {
        setLimit(newLimit);
      }

      setHostInfo({
        hostname: data.hostname || 'Desconocido',
        ip: data.ip || 'Desconocido'
      });

      if (data.userJoined) {
        addSystemMessage(`${data.userJoined} se ha unido a la sala`);
      }

      if (data.userLeft) {
        addSystemMessage(`${data.userLeft} ha abandonado la sala`);
      }
    });

    // Error joining room
    socket.on('error_join', (error: { error: string }) => {
      showError('Error al unirse', error.error || 'Error desconocido');
      handleDisconnect();
    });

      // Cleanup on unmount
    return () => {
      console.log('Cleaning up socket connection');
      if (socket.connected) {
        socket.disconnect();
      }
    };
  }, []); // Remove nickname from dependencies to ensure connection is established on mount

  // Handle disconnect
  const handleDisconnect = useCallback(() => {
    setConnected(false);
    setIsConnecting(false);
    setRoomPIN('');
    socketRef.current?.disconnect();
  }, []);

  // Create a new room
  const createRoom = useCallback(() => {
    if (!nickname.trim()) {
      showError('Error', 'Por favor ingresa tu nombre');
      return;
    }
    
    if (!socketRef.current?.connected) {
      showError('Error', 'No hay conexión con el servidor');
      return;
    }

    const limitValue = typeof limit === 'string' ? parseInt(limit, 10) : limit;
    if (isNaN(limitValue) || limitValue < 2 || limitValue > 20) {
      showError('Error', 'El límite de participantes debe estar entre 2 y 20');
      return;
    }

    const socket = socketRef.current;
    if (!socket) {
      showError('Error', 'No hay conexión con el servidor');
      return;
    }

    setIsConnecting(true);

    // Emit create_room event with callback
    socket.emit('create_room',
      { nickname: nickname.trim(), limit: limit.toString() },
      (response: { success?: boolean; error?: string; pin?: string } & RoomUpdate) => {
        if (response.success && response.pin) {
          setRoomPIN(response.pin);
          setParticipants(response.participants || 1);
          setLimit(parseInt(response.limit?.toString() || limit.toString(), 10));
          addSystemMessage('Sala creada correctamente');
        } else {
          showError('Error al crear sala', response.error || 'Error desconocido');
          setIsConnecting(false);
        }
      }
    );
  }, [nickname, limit, addSystemMessage]);

  // Join an existing room
  const joinRoom = useCallback((pin: string) => {
    const trimmedPin = pin.trim();

    if (!nickname.trim()) {
      showError('Error', 'Por favor ingresa tu nombre');
      return;
    }

    if (nickname.length > MAX_NICKNAME_LENGTH) {
      showError('Error', `El nombre no puede tener más de ${MAX_NICKNAME_LENGTH} caracteres`);
      return;
    }

    if (!/^\d{6}$/.test(trimmedPin)) {
      showError('Error', 'El PIN debe tener exactamente 6 dígitos');
      return;
    }

    const socket = socketRef.current;
    if (!socket) {
      showError('Error', 'No hay conexión con el servidor');
      return;
    }

    setIsConnecting(true);

    // Emit join_room event with callback
    socket.emit('join_room',
      {
        pin: trimmedPin,
        nickname: nickname.trim(),
        deviceId: getOrCreateDeviceId()
      },
      (response: { success?: boolean; error?: string } & RoomUpdate) => {
        if (response.success) {
          setRoomPIN(trimmedPin);
          setParticipants(response.participants || 1);
          setLimit(parseInt(response.limit?.toString() || '5', 10));
          addSystemMessage(`Te has unido a la sala ${trimmedPin}`);
        } else {
          showError('Error al unirse', response.error || 'Error desconocido');
          setIsConnecting(false);
        }
      }
    );
  }, [nickname, addSystemMessage]);

  // Send a message to the current room
  const sendMessage = useCallback(() => {
    const trimmedMessage = message.trim();

    if (!trimmedMessage || !connected || !roomPIN) return;

    if (trimmedMessage.length > MAX_MESSAGE_LENGTH) {
      showError('Error', `El mensaje no puede tener más de ${MAX_MESSAGE_LENGTH} caracteres`);
      return;
    }

    const socket = socketRef.current;
    if (!socket) {
      showError('Error', 'No hay conexión con el servidor');
      return;
    }

    // Add message to local state immediately for better UX
    const newMessage: ChatMessage = {
      autor: nickname,
      message: trimmedMessage,
      type: 'user',
      timestamp: new Date().toISOString()
    };

    console.log('Enviando mensaje:', newMessage);
    setMessages(prev => [...prev, newMessage]);
    setMessage('');
    setLastActivity(new Date());

    // Emit the message to the server
    socket.emit('send_message', {
      pin: roomPIN,
      autor: nickname,
      message: trimmedMessage,
      type: 'user',
      timestamp: new Date().toISOString()
    });
  }, [message, connected, roomPIN, nickname, showError]);

  // Handle leaving the room
  const leaveRoom = useCallback(() => {
    addSystemMessage('Has abandonado la sala');
    handleDisconnect();
    setMessages([]);
  }, [handleDisconnect, addSystemMessage]);
  
  // Handle key press in message input
  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  };
  
  // Format timestamp for display
  const formatTime = (timestamp?: string) => {
    if (!timestamp) return '';
    return new Date(timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  };

  // Render loading state
  if (isConnecting) {
    return (
      <div className="flex align-items-center justify-content-center" style={{ minHeight: '100vh' }}>
        <Card>
          <div className="flex flex-column align-items-center p-4">
            <ProgressSpinner />
            <p className="mt-3">Conectando al servidor...</p>
          </div>
        </Card>
      </div>
    );
  }

  // Render room selection/creation
  if (!roomPIN || !connected) {
    return (
      <div className="app">
        <Toast ref={toast} position="top-center" />
        <Card 
          title={
            <div className="flex align-items-center">
              <i className="pi pi-comments mr-2"></i>
              <span>Chat en Tiempo Real</span>
            </div>
          }
          className="w-30rem mx-auto mt-8"
        >
          <div className="p-fluid">
            <div className="field">
              <label htmlFor="nickname">Tu nombre</label>
              <InputText
                id="nickname"
                value={nickname}
                onChange={(e) => setNickname(e.target.value)}
                placeholder="Ingresa tu nombre"
                className="w-full"
                maxLength={MAX_NICKNAME_LENGTH}
              />
              <small className="p-d-block p-mt-1 p-text-secondary">
                {nickname.length}/{MAX_NICKNAME_LENGTH} caracteres
              </small>
            </div>

            <Divider align="center">
              <span className="p-tag">O</span>
            </Divider>

            <div className="field">
              <label htmlFor="limit">Límite de participantes (2-20)</label>
              <InputText
                id="limit"
                type="number"
                value={limit.toString()}
                onChange={(e) => {
                  const value = Math.min(20, Math.max(2, parseInt(e.target.value, 10) || 2));
                  setLimit(value);
                }}
                min={2}
                max={20}
                className="w-full"
              />
              <Button 
                label="Crear sala" 
                icon="pi pi-plus" 
                onClick={createRoom}
                className="w-full mt-3"
                disabled={!nickname.trim()}
              />
            </div>

            <Divider align="center">
              <span className="p-tag">O</span>
            </Divider>

            <div className="field">
              <label htmlFor="pin">Unirse a sala existente</label>
              <div className="p-inputgroup">
                <InputText
                  id="pin"
                  maxLength={6}
                  value={joinPIN}
                  onChange={(e) => setJoinPIN(e.target.value.replace(/\D/g, ''))}
                  placeholder="Código de 6 dígitos"
                  className="w-full"
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') joinRoom(joinPIN);
                  }}
                />
                <Button 
                  label="Unirse" 
                  icon="pi pi-sign-in" 
                  onClick={() => joinRoom(joinPIN)}
                  disabled={!nickname.trim() || joinPIN.length !== 6}
                />
              </div>
            </div>
          </div>
        </Card>
      </div>
    );
  }

  // Render chat room
  return (
    <div className="app" style={{ height: '100vh', display: 'flex', flexDirection: 'column' }}>
      <Toast ref={toast} position="top-right" />
      <Card 
        title={
          <div className="flex justify-content-between align-items-center">
            <div>
              <i className="pi pi-comments mr-2"></i>
              <span>Sala: {roomPIN}</span>
              <span className="ml-3 text-sm">
                <i className="pi pi-users mr-1"></i>
                {participants}/{limit} participantes
              </span>
            </div>
            <div>
              <Button 
                label="Salir" 
                icon="pi pi-sign-out" 
                className="p-button-text p-button-sm p-button-danger" 
                onClick={leaveRoom} 
              />
            </div>
          </div>
        }
        style={{
          maxWidth: '800px',
          margin: '0 auto',
          display: 'flex',
          flexDirection: 'column',
          height: '100vh',
          borderRadius: '0',
          border: 'none',
          boxShadow: 'none'
        }}
      >
        <div style={{ 
          flex: '1 1 auto', 
          overflowY: 'auto',
          padding: '1rem',
          display: 'flex',
          flexDirection: 'column'
        }}>
          {messages.length === 0 ? (
            <div className="flex flex-column align-items-center justify-content-center" style={{ flex: 1 }}>
              <i className="pi pi-comments text-6xl text-400 mb-3"></i>
              <p className="text-600">No hay mensajes aún. ¡Envía el primero!</p>
            </div>
          ) : (
            <div style={{ flex: '1 1 auto', minHeight: 'min-content' }}>
              {messages.map((msg, index) => (
                <div 
                  key={index} 
                  className={`flex mb-3 ${msg.type === 'system' ? 'justify-content-center' : 
                    msg.autor === nickname ? 'justify-content-end' : 'justify-content-start'}`}
                >
                  {msg.type === 'system' ? (
                    <div className="text-center w-full">
                      <Message 
                        severity="info" 
                        text={msg.message} 
                        className="text-sm p-2 inline-block"
                      />
                    </div>
                  ) : (
                    <div 
                      className={`p-3 border-round-lg ${msg.autor === nickname ? 
                        'bg-primary' : 'bg-white border-1 border-300'}`}
                      style={{ 
                        maxWidth: '80%',
                        boxShadow: '0 1px 3px rgba(0,0,0,0.1)',
                        marginBottom: '0.75rem',
                        marginLeft: msg.autor === nickname ? 'auto' : '0',
                        marginRight: msg.autor === nickname ? '0' : 'auto',
                        color: msg.autor === nickname ? 'white' : '#2c3e50',
                        wordBreak: 'break-word'
                      }}
                    >
                      <div className="font-bold" style={{ 
                        color: msg.autor === nickname ? 'white' : 'var(--primary-color)',
                        fontSize: '0.9rem'
                      }}>
                        {msg.autor === nickname ? 'Tú' : msg.autor}
                      </div>
                      <div 
                        style={{ 
                          margin: '0.5rem 0',
                          fontSize: '1rem',
                          lineHeight: '1.5'
                        }}
                      >
                        {msg.message}
                      </div>
                      <div 
                        style={{ 
                          fontSize: '0.75rem',
                          opacity: 0.8,
                          textAlign: 'right'
                        }}
                      >
                        {formatTime(msg.timestamp)}
                      </div>
                    </div>
                  )}
                </div>
              ))}
              <div ref={messagesEndRef} />
            </div>
          )}
        </div>

        <div style={{
          borderTop: '1px solid var(--surface-border)',
          padding: '1rem',
          backgroundColor: 'white',
          position: 'sticky',
          bottom: 0
        }}>
          <div className="flex align-items-center">
            <InputTextarea
              ref={inputRef}
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="Escribe un mensaje..."
              rows={2}
              autoResize
              className="flex-grow-1 mr-2"
              disabled={!connected}
              style={{
                borderRadius: '20px',
                border: '1px solid var(--surface-border)'
              }}
            />
            <Button 
              icon="pi pi-send" 
              onClick={sendMessage}
              disabled={!message.trim() || !connected}
              className="p-button-rounded p-button-primary"
              aria-label="Enviar mensaje"
              style={{
                height: '48px',
                width: '48px',
                flexShrink: 0
              }}
            />
          </div>
          <div className="flex justify-content-between mt-2" style={{ fontSize: '0.75rem' }}>
            <span style={{ color: message.length > MAX_MESSAGE_LENGTH ? 'var(--red-500)' : 'var(--text-color-secondary)' }}>
              {message.length}/{MAX_MESSAGE_LENGTH} caracteres
            </span>
            {lastActivity && (
              <span style={{ color: 'var(--text-color-secondary)' }}>
                Última actividad: {formatTime(lastActivity.toISOString())}
              </span>
            )}
          </div>
        </div>
      </Card>
    </div>
  );
};

export default Chat;
