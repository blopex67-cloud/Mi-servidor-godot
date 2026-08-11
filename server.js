const WebSocket = require('ws');
const http = require('http');
const mongoose = require('mongoose');

const PORT = process.env.PORT || 10000;

// <--- CONEXIÓN A MONGODB ATLAS --->
const mongoURI = "mongodb+srv://blopex67_db_user:PBrsW7s4rxSjAMHb@cluster0.hhjrdwk.mongodb.net/?appName=Cluster0"; 

mongoose.connect(mongoURI, { useNewUrlParser: true, useUnifiedTopology: true })
    .then(() => console.log('Conectado a la base de datos MongoDB'))
    .catch(err => console.error('Error al conectar a MongoDB:', err));

const jugadorSchema = new mongoose.Schema({
    nombre: { type: String, required: true, unique: true },
    es_creador: { type: Boolean, default: false }
});
const Jugador = mongoose.model('Jugador', jugadorSchema);

// <--- EL HTML DE TU PANEL WEB --->
const panelHTML = `
<!DOCTYPE html>
<html lang="es">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Panel de Administración</title>
    <style>
        body { font-family: sans-serif; background-color: #121212; color: white; display: flex; justify-content: center; align-items: center; height: 100vh; margin: 0; }
        .panel { background-color: #1e1e1e; padding: 30px; border-radius: 10px; text-align: center; width: 300px; }
        h2 { color: #00bfff; margin-top: 0; }
        input { width: 90%; padding: 10px; margin: 15px 0; border: none; border-radius: 5px; background: #2a2a2a; color: white; text-align: center; }
        button { width: 100%; padding: 10px; margin: 5px 0; border: none; border-radius: 5px; cursor: pointer; font-weight: bold; }
        .btn-verificar { background: #00bfff; color: #000; }
        .btn-quitar { background: #ff4c4c; color: white; }
        #mensaje { margin-top: 15px; font-weight: bold; }
    </style>
</head>
<body>
    <div class="panel">
        <h2>Panel de Creadores ✔️</h2>
        <p>Ingresa el ID del jugador:</p>
        <input type="text" id="jugadorId" placeholder="Ej: 58102">
        <button class="btn-verificar" onclick="actualizar(true)">Dar Verificado</button>
        <button class="btn-quitar" onclick="actualizar(false)">Quitar Verificado</button>
        <p id="mensaje"></p>
    </div>
    <script>
        async function actualizar(estado) {
            const id = document.getElementById("jugadorId").value;
            const msj = document.getElementById("mensaje");
            if (!id) return msj.innerText = "Ingresa un ID", msj.style.color = "#ff4c4c";
            msj.innerText = "Procesando..."; msj.style.color = "white";
            
            try {
                const res = await fetch("/api/verificar", {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ nombre: id, es_creador: estado })
                });
                const data = await res.json();
                msj.innerText = data.mensaje;
                msj.style.color = res.ok ? "#00bfff" : "#ff4c4c";
            } catch (e) {
                msj.innerText = "Error al conectar."; msj.style.color = "#ff4c4c";
            }
        }
    </script>
</body>
</html>
`;

// <--- SERVIDOR WEB --->
const server = http.createServer((req, res) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'POST, GET, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    if (req.method === 'OPTIONS') {
        res.writeHead(200);
        return res.end();
    }

    // Si entras a la página principal, te muestra el panel de control
    if (req.method === 'GET' && req.url === '/') {
        res.writeHead(200, { 'Content-Type': 'text/html' });
        return res.end(panelHTML);
    }

    if (req.method === 'POST' && req.url === '/api/verificar') {
        let body = '';
        req.on('data', chunk => body += chunk.toString());
        req.on('end', async () => {
            try {
                const { nombre, es_creador } = JSON.parse(body);
                const jugador = await Jugador.findOneAndUpdate(
                    { nombre: nombre }, 
                    { es_creador: es_creador }, 
                    { upsert: true, new: true } 
                );
                
                res.writeHead(200, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ mensaje: `¡ID ${nombre} actualizado!` }));
            } catch (error) {
                res.writeHead(500);
                res.end(JSON.stringify({ mensaje: 'Error en base de datos.' }));
            }
        });
        return;
    }

    res.writeHead(404);
    res.end('Ruta no encontrada');
});

// <--- TU SISTEMA MULTIJUGADOR INTACTO --->
const wss = new WebSocket.Server({ server });
let rooms = [];
let nextClientId = 1;
let nextRoomNumber = 1;

function findOrCreateRoom() {
    let room = rooms.find(r => r.players.length < 2);
    if (!room) {
        room = { id: `room_${nextRoomNumber++}`, players: [], round: 1, scores: {} };
        rooms.push(room);
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

    room.players.push({ id: clientId, ws, spawnIndex });
    room.scores[clientId] = 0; 

    ws.clientId = clientId;
    ws.roomId = room.id;

    ws.send(JSON.stringify({
        type: 'welcome', id: clientId, room: room.id, spawn_index: spawnIndex, round: room.round
    }));

    for (const p of room.players) {
        if (p.id !== clientId) {
            ws.send(JSON.stringify({ type: 'player_joined', id: p.id, spawn_index: p.spawnIndex }));
        }
    }
    broadcastToRoom(room, { type: 'player_joined', id: clientId, spawn_index: spawnIndex }, clientId);

    ws.on('message', async (message) => {
        try {
            const data = JSON.parse(message);

            if (data.type === "login") {
                let nombreBuscado = data.nombre || `JUGADOR_${clientId}`;
                let jugadorDB = await Jugador.findOne({ nombre: nombreBuscado });
                
                if (!jugadorDB) {
                    jugadorDB = new Jugador({ nombre: nombreBuscado, es_creador: false });
                    await jugadorDB.save();
                }

                ws.send(JSON.stringify({
                    type: 'datos_perfil',
                    nombre: jugadorDB.nombre,
                    es_creador: jugadorDB.es_creador
                }));
                return; 
            }

            const currentRoom = rooms.find(r => r.id === ws.roomId);
            if (!currentRoom) return;

            if (data.type === "player_died") {
                const killerId = data.killer;
                if (currentRoom.scores[killerId] !== undefined) {
                    currentRoom.scores[killerId] += 1;
                }
                
                let kingId = null;
                let maxScore = -1;
                for (let pid in currentRoom.scores) {
                    if (currentRoom.scores[pid] > maxScore) {
                        maxScore = currentRoom.scores[pid];
                        kingId = pid;
                    } else if (currentRoom.scores[pid] === maxScore) {
                        kingId = null; 
                    }
                }

                currentRoom.round += 1; 
                broadcastToRoom(currentRoom, {
                    type: 'round_ended',
                    round: currentRoom.round,
                    king_id: kingId,
                    scores: currentRoom.scores
                });
                return;
            }

            data.id = clientId;
            broadcastToRoom(currentRoom, data, clientId);

        } catch (error) {
            console.error(error);
        }
    });

    ws.on('close', () => {
        const currentRoom = rooms.find(r => r.id === ws.roomId);
        if (!currentRoom) return;
        currentRoom.players = currentRoom.players.filter(p => p.id !== clientId);
        delete currentRoom.scores[clientId];
        broadcastToRoom(currentRoom, { type: 'player_left', id: clientId });
        if (currentRoom.players.length === 0) {
            rooms = rooms.filter(r => r.id !== currentRoom.id);
        }
    });
});

server.listen(PORT, () => {
    console.log(`Servidor escuchando en puerto ${PORT}`);
});
