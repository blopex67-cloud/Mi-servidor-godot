const WebSocket = require('ws');
const http = require('http');

const PORT = process.env.PORT || 10000;

const server = http.createServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/plain' });
    res.end('Servidor PvP Godot activo\n');
});

const wss = new WebSocket.Server({ server });

let rooms = [];
let nextClientId = 1;
let nextRoomNumber = 1;

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

function broadcastToRoom(room, messageObj, excludeClientId = null) {
    const messageString = JSON.stringify(messageObj);

    for (const player of room.players) {
        if (player.id !== excludeClientId && player.ws.readyState === WebSocket.OPEN) {
            player.ws.send(messageString);
        }
    }
}

function getPlayerInRoom(room, clientId) {
    return room.players.find(p => p.id === clientId);
}

wss.on('connection', (ws) => {
    const clientId = nextClientId++;
    const room = findOrCreateRoom();

    if (room.players.length >= 2) {
        ws.send(JSON.stringify({ type: 'room_full' }));
        ws.close();
        return;
    }

    const usedSpawns = room.players.map(p => p.spawnIndex);
    const spawnIndex = usedSpawns.includes(0) ? 1 : 0;

    const playerData = {
        id: clientId,
        ws,
        spawnIndex
    };

    room.players.push(playerData);

    ws.clientId = clientId;
    ws.roomId = room.id;

    console.log(`[+] Jugador conectado. ID: ${clientId} | Sala: ${room.id} | Spawn: ${spawnIndex}`);

    ws.send(JSON.stringify({
        type: 'welcome',
        id: clientId,
        room: room.id,
        spawn_index: spawnIndex
    }));

    for (const p of room.players) {
        if (p.id !== clientId) {
            ws.send(JSON.stringify({
                type: 'player_joined',
                id: p.id,
                spawn_index: p.spawnIndex
            }));
        }
    }

    broadcastToRoom(room, {
        type: 'player_joined',
        id: clientId,
        spawn_index: spawnIndex
    }, clientId);

    ws.on('message', (message) => {
        try {
            const data = JSON.parse(message);
            const currentRoom = rooms.find(r => r.id === ws.roomId);
            if (!currentRoom) return;

            const sender = getPlayerInRoom(currentRoom, clientId);
            if (!sender) return;

            data.id = clientId;
            broadcastToRoom(currentRoom, data, clientId);

        } catch (error) {
            console.error(`Error al procesar mensaje del cliente ${clientId}:`, error);
        }
    });

    ws.on('close', () => {
        const currentRoom = rooms.find(r => r.id === ws.roomId);
        if (!currentRoom) return;

        console.log(`[-] Jugador desconectado. ID: ${clientId} | Sala: ${currentRoom.id}`);

        currentRoom.players = currentRoom.players.filter(p => p.id !== clientId);

        broadcastToRoom(currentRoom, {
            type: 'player_left',
            id: clientId
        });

        if (currentRoom.players.length === 0) {
            rooms = rooms.filter(r => r.id !== currentRoom.id);
            console.log(`[ROOM] Sala eliminada por quedar vacía: ${currentRoom.id}`);
        }
    });
});

server.listen(PORT, () => {
    console.log(`Servidor WebSocket escuchando en el puerto ${PORT}`);
});
