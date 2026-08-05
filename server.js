const WebSocket = require('ws');
const http = require('http');

const PORT = process.env.PORT || 10000;

// Servidor HTTP básico para health check en Render
const server = http.createServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/plain' });
    res.end('Servidor PvP Godot activo\n');
});

// WebSocket sobre el servidor HTTP
const wss = new WebSocket.Server({ server });

// Estructura de salas:
// [
//   {
//     id: "room_1",
//     players: [
//       { id: 1, ws: ..., spawnIndex: 0 },
//       { id: 2, ws: ..., spawnIndex: 1 }
//     ]
//   }
// ]
let rooms = [];
let nextClientId = 1;
let nextRoomNumber = 1;

// Buscar una sala con espacio o crear una nueva
function findOrCreateRoom() {
    let room = rooms.find(r => r.players.length < 2);

    if (!room) {
        room = {
            id: `room_${nextRoomNumber++}`,
            players: []
        };
        rooms.push(room);
        console.log(`[ROOM] Creada nueva sala: ${room.id}`);
    }

    return room;
}

// Enviar a todos en una sala, excepto opcionalmente uno
function broadcastToRoom(room, messageObj, excludeClientId = null) {
    const messageString = JSON.stringify(messageObj);

    for (const player of room.players) {
        if (player.id !== excludeClientId && player.ws.readyState === WebSocket.OPEN) {
            player.ws.send(messageString);
        }
    }
}

// Buscar jugador dentro de una sala
function getPlayerInRoom(room, clientId) {
    return room.players.find(p => p.id === clientId);
}

// Cuando conecta un cliente
wss.on('connection', (ws) => {
    const clientId = nextClientId++;
    const room = findOrCreateRoom();

    // Seguridad extra, aunque findOrCreateRoom ya lo evita
    if (room.players.length >= 2) {
        ws.send(JSON.stringify({
            type: 'room_full'
        }));
        ws.close();
        return;
    }

    const spawnIndex = room.players.length; // 0 para el primero, 1 para el segundo

    const playerData = {
        id: clientId,
        ws,
        spawnIndex
    };

    room.players.push(playerData);

    // Guardamos referencias en la conexión
    ws.clientId = clientId;
    ws.roomId = room.id;

    console.log(`[+] Jugador conectado. ID: ${clientId} | Sala: ${room.id} | Spawn: ${spawnIndex}`);

    // 1) Bienvenida al jugador nuevo
    ws.send(JSON.stringify({
        type: 'welcome',
        id: clientId,
        room: room.id,
        spawn_index: spawnIndex
    }));

    // 2) Enviarle al nuevo los jugadores que ya estaban en la sala
    for (const p of room.players) {
        if (p.id !== clientId) {
            ws.send(JSON.stringify({
                type: 'player_joined',
                id: p.id,
                spawn_index: p.spawnIndex
            }));
        }
    }

    // 3) Avisar al otro jugador de la sala que entró este nuevo
    broadcastToRoom(room, {
        type: 'player_joined',
        id: clientId,
        spawn_index: spawnIndex
    }, clientId);

    // Escuchar mensajes del cliente
    ws.on('message', (message) => {
        try {
            const data = JSON.parse(message);

            // Buscar la sala real del cliente
            const currentRoom = rooms.find(r => r.id === ws.roomId);
            if (!currentRoom) return;

            const sender = getPlayerInRoom(currentRoom, clientId);
            if (!sender) return;

            // Forzar el ID del remitente real
            data.id = clientId;

            // Reenviar SOLO a la misma sala
            broadcastToRoom(currentRoom, data, clientId);

        } catch (error) {
            console.error(`Error al procesar mensaje del cliente ${clientId}:`, error);
        }
    });

    // Desconexión
    ws.on('close', () => {
        const currentRoom = rooms.find(r => r.id === ws.roomId);
        if (!currentRoom) return;

        console.log(`[-] Jugador desconectado. ID: ${clientId} | Sala: ${currentRoom.id}`);

        // Eliminar al jugador de la sala
        currentRoom.players = currentRoom.players.filter(p => p.id !== clientId);

        // Avisar al otro jugador de la sala
        broadcastToRoom(currentRoom, {
            type: 'player_left',
            id: clientId
        });

        // Si la sala quedó vacía, eliminarla
        if (currentRoom.players.length === 0) {
            rooms = rooms.filter(r => r.id !== currentRoom.id);
            console.log(`[ROOM] Sala eliminada por quedar vacía: ${currentRoom.id}`);
        }
    });
});

// Iniciar servidor
server.listen(PORT, () => {
    console.log(`Servidor WebSocket escuchando en el puerto ${PORT}`);
});
        
