const WebSocket = require('ws');
const http = require('http');

const PORT = process.env.PORT || 10000;

let rooms = [];
let nextClientId = 1;
let nextRoomNumber = 1;
let bannedIPs = {}; // Guarda las IPs baneadas

const server = http.createServer((req, res) => {
    res.setHeader('Access-Control-Allow-Origin', '*'); 
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return; }

    // ENDPOINT PARA BANEAR (Por Nombre de Usuario)
    if (req.method === 'POST' && req.url === '/api/ban') {
        let body = '';
        req.on('data', chunk => body += chunk.toString());
        req.on('end', () => {
            const data = JSON.parse(body);
            const playerNameToBan = data.playerName; 
            const reason = data.reason || "Violación de las reglas";

            let playerBanned = false;

            for (const room of rooms) {
                // Buscamos al jugador por su NOMBRE
                const playerIndex = room.players.findIndex(p => p.name === playerNameToBan);
                
                if (playerIndex !== -1) {
                    const player = room.players[playerIndex];
                    const playerIP = player.ws._socket.remoteAddress; // Tomamos su IP
                    
                    bannedIPs[playerIP] = reason; // Baneamos la IP

                    if (player.ws.readyState === WebSocket.OPEN) {
                        player.ws.send(JSON.stringify({ type: 'banned', reason: reason }));
                        player.ws.close(); 
                    }
                    playerBanned = true;
                    break;
                }
            }

            if (playerBanned) {
                console.log(`[BAN] Jugador ${playerNameToBan} baneado permanentemente por IP.`);
                res.writeHead(200, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ message: "Baneado permanentemente" }));
            } else {
                res.writeHead(404, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ message: "No se encontró a ese jugador conectado" }));
            }
        });
        return;
    }

    res.writeHead(200, { 'Content-Type': 'text/plain' });
    res.end('Servidor activo\n');
});

const wss = new WebSocket.Server({ server });

function findOrCreateRoom() {
    let room = rooms.find(r => r.players.length < 2);
    if (!room) {
        room = { id: `room_${nextRoomNumber++}`, players: [], round: 1, scores: {} };
        rooms.push(room);
    }
    return room;
}

function broadcastToRoom(room, messageObj, excludeClientId = null) {
    const msg = JSON.stringify(messageObj);
    for (const player of room.players) {
        if (player.id !== excludeClientId && player.ws.readyState === WebSocket.OPEN) {
            player.ws.send(msg);
        }
    }
}

wss.on('connection', (ws, req) => {
    // Verificar IP al instante
    const clientIP = req.socket.remoteAddress;
    if (bannedIPs[clientIP]) {
        ws.send(JSON.stringify({ type: 'banned', reason: bannedIPs[clientIP] }));
        ws.close();
        return;
    }

    const clientId = nextClientId++;
    ws.clientId = clientId;
    ws.isLoggedIn = false;

    ws.on('message', (message) => {
        try {
            const data = JSON.parse(message);

            // Registrar al jugador con su nombre
            if (data.type === "join_game" || data.type === "register_name") {
                ws.isLoggedIn = true;
                const playerName = data.name || `Jugador${clientId}`;
                
                const room = findOrCreateRoom();
                if (room.players.length >= 2) {
                    ws.send(JSON.stringify({ type: 'room_full' }));
                    ws.close();
                    return;
                }

                const usedSpawns = room.players.map(p => p.spawnIndex);
                const spawnIndex = usedSpawns.includes(0) ? 1 : 0;

                // AQUI GUARDAMOS EL NOMBRE EN EL SERVIDOR
                room.players.push({ id: clientId, name: playerName, ws, spawnIndex });
                room.scores[clientId] = 0; 
                ws.roomId = room.id;

                ws.send(JSON.stringify({ type: 'welcome', id: clientId, room: room.id, spawn_index: spawnIndex }));
                broadcastToRoom(room, { type: 'player_joined', id: clientId, name: playerName, spawn_index: spawnIndex }, clientId);
                return;
            }

            if (!ws.isLoggedIn) return; // Ignorar si no ha enviado su nombre

            const currentRoom = rooms.find(r => r.id === ws.roomId);
            if (!currentRoom) return;

            data.id = clientId;
            broadcastToRoom(currentRoom, data, clientId);

        } catch (error) { console.error(error); }
    });

    ws.on('close', () => {
        const currentRoom = rooms.find(r => r.id === ws.roomId);
        if (!currentRoom) return;
        currentRoom.players = currentRoom.players.filter(p => p.id !== clientId);
        broadcastToRoom(currentRoom, { type: 'player_left', id: clientId });
        if (currentRoom.players.length === 0) rooms = rooms.filter(r => r.id !== currentRoom.id);
    });
});

server.listen(PORT, () => console.log(`Servidor en puerto ${PORT}`));
