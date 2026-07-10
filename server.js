const WebSocket = require('ws');

const PORT = process.env.PORT || 8080;
const wss = new WebSocket.Server({ port: PORT });

let players = {}; // { id: { ws, x, y, z, rot } }
let nextId = 1;

console.log(`🚀 Servidor corriendo en puerto ${PORT}`);

wss.on('connection', (ws) => {
    const playerId = nextId++;
    players[playerId] = { ws, x: 0, y: 1, z: 0, rot: 0 };

    console.log(`✅ Jugador ${playerId} conectado. Total: ${Object.keys(players).length}`);

    // ── 1. Enviar ID al nuevo jugador
    send(ws, {
        type: "welcome",
        id: playerId
    });

    // ── 2. Enviar lista de jugadores existentes al nuevo
    Object.keys(players).forEach((id) => {
        const pid = parseInt(id);
        if (pid !== playerId) {
            send(ws, {
                type: "player_joined",
                id: pid,
                x: players[pid].x,
                y: players[pid].y,
                z: players[pid].z,
                rot: players[pid].rot
            });
        }
    });

    // ── 3. Notificar a todos que llegó un jugador nuevo
    broadcast({
        type: "player_joined",
        id: playerId,
        x: 0, y: 1, z: 0, rot: 0
    }, playerId);

    // ── 4. Recibir mensajes del jugador
    ws.on('message', (data) => {
        try {
            const msg = JSON.parse(data);

            if (msg.type === "move") {
                players[playerId].x   = msg.x;
                players[playerId].y   = msg.y;
                players[playerId].z   = msg.z;
                players[playerId].rot = msg.rot;

                // Reenviar posición a todos los demás
                broadcast({
                    type: "player_moved",
                    id: playerId,
                    x: msg.x,
                    y: msg.y,
                    z: msg.z,
                    rot: msg.rot
                }, playerId);
            }

        } catch (e) {
            console.error("Error al parsear mensaje:", e.message);
        }
    });

    // ── 5. Jugador desconectado
    ws.on('close', () => {
        delete players[playerId];
        console.log(`❌ Jugador ${playerId} desconectado. Total: ${Object.keys(players).length}`);
        broadcast({ type: "player_left", id: playerId });
    });

    ws.on('error', (err) => {
        console.error(`Error jugador ${playerId}:`, err.message);
    });
});

// ── Helpers
function send(ws, obj) {
    if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify(obj));
    }
}

function broadcast(obj, excludeId = null) {
    const msg = JSON.stringify(obj);
    Object.keys(players).forEach((id) => {
        const pid = parseInt(id);
        if (pid !== excludeId) {
            const ws = players[pid].ws;
            if (ws.readyState === WebSocket.OPEN) {
                ws.send(msg);
            }
        }
    });
                                 }
