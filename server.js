const WebSocket = require('ws');
const http = require('http');
const mongoose = require('mongoose'); // Librería de base de datos

const PORT = process.env.PORT || 10000;

// <--- CONEXIÓN A MONGODB ATLAS --->
// Ya tiene tu usuario y contraseña correctos
const mongoURI = "mongodb+srv://blopex67_db_user:PBrsW7s4rxSjAMHb@cluster0.hhjrdwk.mongodb.net/?appName=Cluster0"; 

mongoose.connect(mongoURI, { useNewUrlParser: true, useUnifiedTopology: true })
    .then(() => console.log('Conectado a la base de datos MongoDB'))
    .catch(err => console.error('Error al conectar a MongoDB:', err));

// <--- MODELO DE JUGADOR EN LA BASE DE DATOS --->
const jugadorSchema = new mongoose.Schema({
    nombre: { type: String, required: true, unique: true },
    es_creador: { type: Boolean, default: false } // Por defecto nadie es creador
});
const Jugador = mongoose.model('Jugador', jugadorSchema);

// <--- CONFIGURACIÓN DEL SERVIDOR WEB --->
const server = http.createServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/plain' });
    res.end('Servidor PvP Godot activo con Base de Datos\n');
});

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

            // <--- NUEVO: SISTEMA DE LOGIN / PERFIL --->
            if (data.type === "login") {
                let nombreBuscado = data.nombre || `JUGADOR_${clientId}`;
                
                // Busca al jugador en la base de datos
                let jugadorDB = await Jugador.findOne({ nombre: nombreBuscado });
                
                // Si no existe, lo crea
                if (!jugadorDB) {
                    jugadorDB = new Jugador({ nombre: nombreBuscado, es_creador: false });
                    await jugadorDB.save();
                    console.log(`Nuevo jugador registrado: ${nombreBuscado}`);
                }

                // Le envía los datos de vuelta a Godot
                ws.send(JSON.stringify({
                    type: 'datos_perfil',
                    nombre: jugadorDB.nombre,
                    es_creador: jugadorDB.es_creador
                }));
                return; // Evita que este mensaje vaya a la sala de combate
            }

            // <--- LÓGICA DE COMBATE ORIGINAL --->
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
                        
