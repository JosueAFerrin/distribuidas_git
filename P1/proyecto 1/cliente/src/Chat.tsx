import React, { useEffect, useRef, useState } from 'react';
import { io, Socket } from 'socket.io-client';
import { Card } from 'primereact/card';
import { InputText } from 'primereact/inputtext';
import { Button } from 'primereact/button';
import { InputTextarea } from 'primereact/inputtextarea';

const SOCKET_SERVER_URL = process.env.REACT_APP_SOCKET_URL || 'http://10.40.32.147:3003';

interface Message {
  autor: string;
  message: string;
}

interface HostInfo {
  ip: string;
  hostname: string;
}

function getOrCreateDeviceId(): string {
  let id = localStorage.getItem('deviceId');
  if (!id) {
    id = crypto.randomUUID();
    localStorage.setItem('deviceId', id);
  }
  return id;
}

export const Chat: React.FC = () => {
  const [nickname, setNickname] = useState('');
  const [roomPIN, setRoomPIN] = useState<string | null>(localStorage.getItem('chatRoomPIN'));
  const [connected, setConnected] = useState(false);
  const [message, setMessage] = useState('');
  const [messages, setMessages] = useState<Message[]>([]);
  const [hostInfo, setHostInfo] = useState<HostInfo | null>(null);
  const [error, setError] = useState('');
  const [participants, setParticipants] = useState(0);
  const [limit, setLimit] = useState(5);
  const [joinPIN, setJoinPIN] = useState('');

  const socketRef = useRef<Socket | null>(null);

  useEffect(() => {
    if (!nickname) return;

    socketRef.current = io(SOCKET_SERVER_URL);

    socketRef.current.on('host_info', (data: HostInfo) => {
      setHostInfo(data);
      setConnected(true);
    });

    socketRef.current.on('receive_message', (msg: Message) => {
      setMessages((prev) => [...prev, msg]);
    });

    socketRef.current.on('room_update', ({ participants, limit }) => {
      setParticipants(participants);
      setLimit(limit);
    });

    socketRef.current.on('error_join', (msg) => {
      setError(msg);
      setRoomPIN(null);
      localStorage.removeItem('chatRoomPIN');
      setConnected(false);
      socketRef.current?.disconnect();
    });

    socketRef.current.on('joined_room', ({ pin }) => {
      setRoomPIN(pin);
      localStorage.setItem('chatRoomPIN', pin);
      setConnected(true);
    });

    socketRef.current.on('room_created', ({ pin }) => {
      setRoomPIN(pin);
      localStorage.setItem('chatRoomPIN', pin);
      setConnected(true);
    });

    return () => {
      socketRef.current?.disconnect();
    };
  }, [nickname]);

  const createRoom = () => {
    setError('');
    if (!nickname || limit < 2) {
      setError('Debes ingresar un nombre y un límite mayor a 1');
      return;
    }
    if (!socketRef.current) return;
    socketRef.current.emit('create_room', { nickname, limit });
  };

  const joinRoom = (pin: string) => {
    setError('');
    if (!nickname || pin.length !== 6) {
      setError('Debes ingresar un nombre y un PIN válido de 6 dígitos');
      return;
    }
    if (!socketRef.current) return;

    const deviceId = getOrCreateDeviceId();
    socketRef.current.emit('join_room', { pin, nickname, deviceId });
  };

  const sendMessage = () => {
    if (!message.trim() || !connected || !roomPIN) return;
    const msg: Message = {
      autor: nickname,
      message: message.trim(),
    };
    socketRef.current?.emit('send_message', { pin: roomPIN, ...msg });
    setMessage('');
  };

  const leaveRoom = () => {
    socketRef.current?.disconnect();
    localStorage.removeItem('chatRoomPIN');
    setRoomPIN(null);
    setMessages([]);
    setConnected(false);
  };

  if (!roomPIN || !connected) {
    return (
      <div className="app">
        <Card title="Unirse o crear sala">
          {error && <p style={{ color: 'red' }}>{error}</p>}
          <div className="p-field p-mb-3">
            <label>Tu nombre</label>
            <InputText value={nickname} onChange={(e) => setNickname(e.target.value)} />
          </div>

          <div className="p-field p-mb-3">
            <label>Crear sala (Límite participantes)</label>
            <InputText
              type="number"
              value={limit.toString()}
              onChange={(e) => setLimit(parseInt(e.target.value))}
              min={2}
            />
            <Button label="Crear sala" icon="pi pi-plus" onClick={createRoom} />
          </div>

          <div className="p-field p-mb-3">
            <label>Unirse a sala (PIN)</label>
            <InputText
              maxLength={6}
              value={joinPIN}
              onChange={(e) => setJoinPIN(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') joinRoom(joinPIN);
              }}
            />
            <Button label="Unirse" icon="pi pi-sign-in" onClick={() => joinRoom(joinPIN)} />
          </div>
        </Card>
      </div>
    );
  }

  return (
    <div className="app">
      <Card title={`Sala ${roomPIN} - Bienvenido ${nickname}`}>
        <div className="host-info">
          IP: <strong>{hostInfo?.hostname}</strong> ({hostInfo?.ip}) <br />
          Participantes: {participants} / {limit}
        </div>

        <div className="msg-container" style={{ maxHeight: '300px', overflowY: 'auto', marginTop: '1rem' }}>
          {messages.map((msg, index) => (
            <p
              key={index}
              className={`message ${msg.autor === nickname ? 'yo' : 'otro'}`}
              style={{ textAlign: msg.autor === nickname ? 'right' : 'left' }}
            >
              <strong>{msg.autor}:</strong> {msg.message}
            </p>
          ))}
        </div>

        <div className="input-area" style={{ marginTop: '1rem' }}>
          <InputTextarea
            rows={2}
            cols={30}
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                sendMessage();
              }
            }}
            placeholder="Escribe tu mensaje..."
          />
          <Button label="Enviar" icon="pi pi-send" onClick={sendMessage} />
          <Button label="Salir" icon="pi pi-sign-out" className="p-button-danger" onClick={leaveRoom} />
        </div>
      </Card>
    </div>
  );
};
