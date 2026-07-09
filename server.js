const WebSocket = require('ws');

const PORT = process.env.PORT || 3000;
const wss = new WebSocket.Server({ port: PORT });

// Almacena jugadores conectados
const players = new Map();
let nextId = 1;

console.log(`🎮 Servidor Godot escuchando en puerto ${PORT}`);

wss.on('connection', (ws) => {
  const playerId = nextId++;
  players.set(playerId, { ws, position: { x: 0, y: 0, z: 0 } });

  console.log(`✅ Jugador ${playerId} conectado. Total: ${players.size}`);

  // Notificar al jugador su ID
  ws.send(JSON.stringify({
    type: "welcome",
    id: playerId
  }));

  // Notificar a todos los demás del nuevo jugador
  broadcast({
    type: "player_joined",
    id: playerId
  }, playerId);

  // Recibir mensajes del cliente Godot
  ws.on('message', (data) => {
    try {
      const msg = JSON.parse(data);

      if (msg.type === "position") {
        // Actualizar posición del jugador
        const player = players.get(playerId);
        if (player) player.position = msg.position;

        // Reenviar a todos los demás
        broadcast({
          type: "player_moved",
          id: playerId,
          position: msg.position,
          rotation: msg.rotation
        }, playerId);
      }

      if (msg.type === "action") {
        broadcast({
          type: "player_action",
          id: playerId,
          action: msg.action
        }, playerId);
      }

    } catch (e) {
      console.error("Error parseando mensaje:", e);
    }
  });

  // Desconexión
  ws.on('close', () => {
    players.delete(playerId);
    console.log(`❌ Jugador ${playerId} desconectado. Total: ${players.size}`);

    broadcast({
      type: "player_left",
      id: playerId
    });
  });
});

// Función para enviar a todos (excepto el que envió)
function broadcast(message, excludeId = null) {
  const data = JSON.stringify(message);
  players.forEach((player, id) => {
    if (id !== excludeId && player.ws.readyState === WebSocket.OPEN) {
      player.ws.send(data);
    }
  });
}
