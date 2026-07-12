const WebSocket = require('ws');

const PORT = process.env.PORT || 8080;
const wss  = new WebSocket.Server({ port: PORT });

let players = {};
let nextId  = 1;

console.log(`🚀 Servidor corriendo en puerto ${PORT}`);

wss.on('connection', (ws) => {
    const playerId = nextId++;

    // ✅ Posición de spawn aleatoria
    const spawnX = (Math.random() - 0.5) * 10;
    const spawnZ = (Math.random() - 0.5) * 10;

    // 🔫 ACTUALIZADO: Incluir estado del arma
    players[playerId] = { 
        ws, 
        x: spawnX, 
        y: 1, 
        z: spawnZ, 
        rot: 0, 
        firing: false,
        weapon_drawn: false,      // 🔫 NUEVO
        transitioning: false      // 🔫 NUEVO
    };

    console.log(`✅ Jugador ${playerId} conectado. Total: ${Object.keys(players).length}`);

    // ── 1. Enviar ID + posición spawn al nuevo jugador
    send(ws, {
        type:   "welcome",
        id:     playerId,
        x:      spawnX,
        y:      1,
        z:      spawnZ
    });

    // ── 2. Enviar lista de jugadores ya conectados al nuevo
    Object.keys(players).forEach((id) => {
        const pid = parseInt(id);
        if (pid !== playerId) {
            send(ws, {
                type:           "player_joined",
                id:             pid,
                x:              players[pid].x,
                y:              players[pid].y,
                z:              players[pid].z,
                rot:            players[pid].rot,
                firing:         players[pid].firing,
                weapon_drawn:   players[pid].weapon_drawn,      // 🔫 NUEVO
                transitioning:  players[pid].transitioning      // 🔫 NUEVO
            });
        }
    });

    // ── 3. Notificar a todos que llegó jugador nuevo
    broadcast({
        type:           "player_joined",
        id:             playerId,
        x:              spawnX,
        y:              1,
        z:              spawnZ,
        rot:            0,
        firing:         false,
        weapon_drawn:   false,      // 🔫 NUEVO
        transitioning:  false       // 🔫 NUEVO
    }, playerId);

    // ── 4. Recibir mensajes del jugador
    ws.on('message', (data) => {
        try {
            const msg = JSON.parse(data);

            if (msg.type === "move") {
                // 🔫 ACTUALIZADO: Guardar estado del arma
                players[playerId].x             = msg.x;
                players[playerId].y             = msg.y;
                players[playerId].z             = msg.z;
                players[playerId].rot           = msg.rot;
                players[playerId].firing        = msg.firing ?? false;
                players[playerId].weapon_drawn  = msg.weapon_drawn ?? false;      // 🔫 NUEVO
                players[playerId].transitioning = msg.transitioning ?? false;     // 🔫 NUEVO

                // 🔫 ACTUALIZADO: Transmitir estado del arma
                broadcast({
                    type:           "player_moved",
                    id:             playerId,
                    x:              msg.x,
                    y:              msg.y,
                    z:              msg.z,
                    rot:            msg.rot,
                    firing:         msg.firing ?? false,
                    weapon_drawn:   msg.weapon_drawn ?? false,      // 🔫 NUEVO
                    transitioning:  msg.transitioning ?? false      // 🔫 NUEVO
                }, playerId);
            }

        } catch (e) {
            console.error(`Error mensaje jugador ${playerId}:`, e.message);
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
        delete players[playerId];
        broadcast({ type: "player_left", id: playerId });
    });
});

// ── Helpers ──────────────────────────────────────────────────
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
            send(players[pid].ws, obj);
        }
    });
}
