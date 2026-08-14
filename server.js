const http = require('http');
const WebSocket = require('ws');

const PORT = process.env.PORT || 10000;

let clientIdCounter = 1;
let rooms = []; 
let bannedNames = {}; 
let playerActivity = {}; 
let pendingDiamonds = {}; // <-- NUEVO: Buzón para diamantes de jugadores offline

const server = http.createServer((req, res) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    if (req.method === 'OPTIONS') {
        res.writeHead(200);
        res.end();
        return;
    }

    // ENDPOINT: VER TODOS LOS JUGADORES
    if (req.method === 'GET' && req.url === '/api/all_players') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify(playerActivity));
    }

    // ENDPOINT: VER ESTADO DE UN JUGADOR
    if (req.method === 'GET' && req.url.startsWith('/api/status')) {
        const urlParams = new URLSearchParams(req.url.split('?')[1]);
        const playerName = urlParams.get('playerName');

        res.writeHead(200, { 'Content-Type': 'application/json' });
        
        if (!playerName) return res.end(JSON.stringify({ message: "Falta el nombre." }));

        const activity = playerActivity[playerName];
        if (!activity) return res.end(JSON.stringify({ message: `No hay registros de ${playerName}.` }));

        if (activity.online) {
            return res.end(JSON.stringify({ message: `🟢 ${playerName} está JUGANDO AHORA MISMO.` }));
        } else {
            return res.end(JSON.stringify({ message: `🔴 ${playerName} está desconectado. Última vez visto: ${activity.lastSeen}` }));
        }
    }

    // ENDPOINT PARA BANEAR
    if (req.method === 'POST' && req.url === '/api/ban') {
        let body = '';
        req.on('data', chunk => body += chunk.toString());
        req.on('end', () => {
            try {
                const data = JSON.parse(body);
                const playerNameToBan = data.playerName; 
                const reason = data.reason || "Violación de las reglas";

                if (!playerNameToBan) return res.end(JSON.stringify({ message: "Falta el nombre." }));

                bannedNames[playerNameToBan] = reason; 
                let estabaConectado = false;

                for (const room of rooms) {
                    const playerIndex = room.players.findIndex(p => p.name === playerNameToBan);
                    if (playerIndex !== -1) {
                        const player = room.players[playerIndex];
                        if (player.ws.readyState === WebSocket.OPEN) {
                            player.ws.send(JSON.stringify({ type: 'banned', reason: reason }));
                            player.ws.close(); 
                        }
                        estabaConectado = true;
                        break; 
                    }
                }

                res.writeHead(200, { 'Content-Type': 'application/json' });
                if (estabaConectado) {
                    res.end(JSON.stringify({ message: `¡BAM! ${playerNameToBan} estaba jugando y fue expulsado y baneado.` }));
                } else {
                    res.end(JSON.stringify({ message: `${playerNameToBan} añadido a la lista negra.` }));
                }
            } catch (error) {
                res.writeHead(500);
                res.end(JSON.stringify({ message: "Error del servidor." }));
            }
        });
        return;
    }

    // ENDPOINT PARA DESBANEAR
    if (req.method === 'POST' && req.url === '/api/unban') {
        let body = '';
        req.on('data', chunk => body += chunk.toString());
        req.on('end', () => {
            try {
                const data = JSON.parse(body);
                const playerNameToUnban = data.playerName; 

                if (bannedNames[playerNameToUnban]) {
                    delete bannedNames[playerNameToUnban];
                    res.writeHead(200, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({ message: `Jugador ${playerNameToUnban} desbaneado.` }));
                } else {
                    res.writeHead(404, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({ message: `El jugador no estaba baneado.` }));
                }
            } catch (error) {
                res.writeHead(500);
                res.end(JSON.stringify({ message: "Error del servidor." }));
            }
        });
        return;
    }

    // ENDPOINT PARA ENVIAR DIAMANTES (ONLINE U OFFLINE)
    if (req.method === 'POST' && req.url === '/api/diamantes') {
        let body = '';
        req.on('data', chunk => body += chunk.toString());
        req.on('end', () => {
            try {
                const data = JSON.parse(body);
                const targetName = data.playerName;
                const amount = parseInt(data.amount);

                if (!targetName || !amount) {
                    return res.end(JSON.stringify({ message: "Falta el nombre o la cantidad." }));
                }

                let enviadoOnline = false;

                // Buscamos si está online para mandárselos de inmediato
                for (const room of rooms) {
                    const player = room.players.find(p => p.name === targetName);
                    if (player && player.ws.readyState === WebSocket.OPEN) {
                        player.ws.send(JSON.stringify({ type: 'add_diamantes', amount: amount }));
                        enviadoOnline = true;
                        break;
                    }
                }

                // Si no estaba online, los guardamos en su buzón de pendientes
                if (!enviadoOnline) {
                    if (!pendingDiamonds[targetName]) {
                        pendingDiamonds[targetName] = 0;
                    }
                    pendingDiamonds[targetName] += amount;
                }

                res.writeHead(200, { 'Content-Type': 'application/json' });
                if (enviadoOnline) {
                    res.end(JSON.stringify({ message: `¡Se enviaron ${amount} diamantes EN VIVO a ${targetName}!` }));
                } else {
                    res.end(JSON.stringify({ message: `${targetName} está offline. Se le guardaron ${amount} diamantes para cuando inicie sesión.` }));
                }
            } catch (error) {
                res.writeHead(500);
                res.end(JSON.stringify({ message: "Error del servidor." }));
            }
        });
        return;
    }

    res.writeHead(404);
    res.end();
});

const wss = new WebSocket.Server({ server });

wss.on('connection', (ws) => {
    const clientId = clientIdCounter++;
    let currentRoom = null;
    let playerName = "";

    ws.on('message', (message) => {
        try {
            const data = JSON.parse(message);

            if (data.type === "register_name") {
                playerName = data.name || `Jugador${clientId}`;

                // Verificar ban
                if (bannedNames[playerName]) {
                    ws.send(JSON.stringify({ type: 'banned', reason: bannedNames[playerName] }));
                    ws.close();
                    return;
                }

                playerActivity[playerName] = { online: true, lastSeen: "Ahora mismo" };

                // ========================================================
                // NUEVO: Revisar si tiene diamantes pendientes (offline)
                // ========================================================
                if (pendingDiamonds[playerName] && pendingDiamonds[playerName] > 0) {
                    ws.send(JSON.stringify({ type: 'add_diamantes', amount: pendingDiamonds[playerName] }));
                    pendingDiamonds[playerName] = 0; // Vaciamos el buzón porque ya se los entregamos
                }

                currentRoom = rooms.find(r => r.players.length < 2);
                if (!currentRoom) {
                    currentRoom = { id: `room_${Date.now()}`, players: [], round: 1 };
                    rooms.push(currentRoom);
                }

                const spawnIndex = currentRoom.players.length; 
                const newPlayer = { id: clientId, ws: ws, name: playerName, spawn_index: spawnIndex };
                currentRoom.players.push(newPlayer);

                ws.send(JSON.stringify({
                    type: 'welcome',
                    id: clientId,
                    room: currentRoom.id,
                    spawn_index: spawnIndex,
                    round: currentRoom.round
                }));

                const otherPlayer = currentRoom.players.find(p => p.id !== clientId);
                if (otherPlayer) {
                    otherPlayer.ws.send(JSON.stringify({ type: 'player_joined', id: clientId, spawn_index: spawnIndex }));
                    ws.send(JSON.stringify({ type: 'player_joined', id: otherPlayer.id, spawn_index: otherPlayer.spawn_index }));
                }
                return;
            }

            if (currentRoom) {
                const otherPlayer = currentRoom.players.find(p => p.id !== clientId);
                if (otherPlayer && otherPlayer.ws.readyState === WebSocket.OPEN) {
                    if (["move", "shoot", "stop_shoot", "reload", "damage"].includes(data.type)) {
                        data.id = clientId; 
                        otherPlayer.ws.send(JSON.stringify(data));
                    } else if (data.type === "round_ended") {
                        currentRoom.round = parseInt(data.round) + 1;
                        otherPlayer.ws.send(JSON.stringify(data));
                    }
                }
            }
        } catch (error) {
            console.error(error);
        }
    });

    ws.on('close', () => {
        if (playerName) {
            const fecha = new Date();
            const fechaLegible = fecha.toLocaleString('es-ES', { timeZone: 'America/Mexico_City' });
            playerActivity[playerName] = { online: false, lastSeen: fechaLegible };
        }

        if (currentRoom) {
            currentRoom.players = currentRoom.players.filter(p => p.id !== clientId);
            const otherPlayer = currentRoom.players.find(p => p.id !== clientId);
            if (otherPlayer && otherPlayer.ws.readyState === WebSocket.OPEN) {
                otherPlayer.ws.send(JSON.stringify({ type: 'player_left', id: clientId }));
            }
            if (currentRoom.players.length === 0) {
                rooms = rooms.filter(r => r.id !== currentRoom.id);
            }
        }
    });
});

server.listen(PORT, () => {
    console.log(`Servidor de juego y panel Admin escuchando en el puerto ${PORT}`);
});
