const WebSocket = require("ws");
const server = new WebSocket.Server({ port: 8080 });

const players = {};

function broadcast(message, excludeId = null) {
    const data = JSON.stringify(message);
    server.clients.forEach((client) => {
        if (client.readyState === WebSocket.OPEN) {
            const playerId = client.playerId;
            if (playerId !== excludeId) {
                client.send(data);
            }
        }
    });
}

server.on("connection", (ws) => {
    const playerId = Date.now();
    ws.playerId = playerId;

    // 1. AÑADIDO: Guardamos la 'skin' en el estado inicial del jugador
    players[playerId] = {
        x: 0,
        y: 0,
        z: 0,
        rot: 0,
        firing: false,
        weapon_drawn: false,
        transitioning: false,
        transition_anim: "",
        health: 100,
        is_dead: false,
        skin: "default" // <-- Skin por defecto
    };

    console.log(`✅ Jugador ${playerId} conectado`);

    // Enviar ID al nuevo jugador
    ws.send(JSON.stringify({
        type: "id_assignment",
        id: playerId
    }));

    // Enviar lista de jugadores existentes al nuevo jugador
    for (const [id, data] of Object.entries(players)) {
        if (parseInt(id) !== playerId) {
            ws.send(JSON.stringify({
                type: "player_joined",
                id: parseInt(id),
                x: data.x,
                y: data.y,
                z: data.z,
                rot: data.rot,
                firing: data.firing,
                weapon_drawn: data.weapon_drawn,
                transitioning: data.transitioning,
                transition_anim: data.transition_anim,
                health: data.health,
                is_dead: data.is_dead,
                skin: data.skin // <-- AÑADIDO: Enviar la skin de los que ya están en la sala
            }));
        }
    }

    // Notificar a otros jugadores sobre el nuevo jugador
    broadcast({
        type: "player_joined",
        id: playerId,
        x: 0,
        y: 0,
        z: 0,
        rot: 0,
        firing: false,
        weapon_drawn: false,
        transitioning: false,
        transition_anim: "",
        health: 100,
        is_dead: false,
        skin: "default" // <-- AÑADIDO
    }, playerId);

    ws.on("message", (message) => {
        try {
            const msg = JSON.parse(message);

            // ─────────────────────────────────────────────────────
            //  SISTEMA DE SKINS (NUEVO)
            // ─────────────────────────────────────────────────────
            // Recibir un aviso exclusivo de que el jugador cambió su skin
            if (msg.type === "change_skin") {
                console.log(`👕 Jugador ${playerId} cambió su skin a: ${msg.skin}`);
                players[playerId].skin = msg.skin;

                broadcast({
                    type: "skin_updated",
                    id: playerId,
                    skin: msg.skin
                });
            }

            // ─────────────────────────────────────────────────────
            //  MOVIMIENTO Y ESTADO
            // ─────────────────────────────────────────────────────
            if (msg.type === "move") {
                players[playerId].x = msg.x;
                players[playerId].y = msg.y;
                players[playerId].z = msg.z;
                players[playerId].rot = msg.rot;
                players[playerId].firing = msg.firing ?? false;
                players[playerId].weapon_drawn = msg.weapon_drawn ?? false;
                players[playerId].transitioning = msg.transitioning ?? false;
                players[playerId].transition_anim = msg.transition_anim ?? "";
                players[playerId].health = msg.health ?? 100;
                players[playerId].is_dead = msg.is_dead ?? false;
                
                // Si el cliente envía la skin junto con el movimiento, la actualizamos
                if (msg.skin) {
                    players[playerId].skin = msg.skin;
                }

                broadcast({
                    type: "player_moved",
                    id: playerId,
                    x: msg.x,
                    y: msg.y,
                    z: msg.z,
                    rot: msg.rot,
                    firing: msg.firing ?? false,
                    weapon_drawn: msg.weapon_drawn ?? false,
                    transitioning: msg.transitioning ?? false,
                    transition_anim: msg.transition_anim ?? "",
                    health: msg.health ?? 100,
                    is_dead: msg.is_dead ?? false,
                    skin: players[playerId].skin // <-- AÑADIDO: Mantener la skin sincronizada
                }, playerId);
            }

            // ─────────────────────────────────────────────────────
            //  💀 SISTEMA DE COMBATE
            // ─────────────────────────────────────────────────────
            if (msg.type === "hit") {
                console.log(`💥 Jugador ${playerId} golpeó a ${msg.target} (${msg.damage} daño)`);
                broadcast({
                    type: "hit",
                    attacker_id: playerId,
                    target: msg.target,
                    damage: msg.damage
                });
            }

            if (msg.type === "death") {
                console.log(`💀 Jugador ${playerId} murió`);
                players[playerId].is_dead = true;
                players[playerId].health = 0;
                broadcast({
                    type: "death",
                    id: playerId,
                    killer_id: msg.killer_id ?? -1
                });
            }

            if (msg.type === "respawn") {
                console.log(`✨ Jugador ${playerId} respawneó`);
                players[playerId].is_dead = false;
                players[playerId].health = 100;
                broadcast({
                    type: "respawn",
                    id: playerId
                });
            }

        } catch (error) {
            console.error("❌ Error procesando mensaje:", error);
        }
    });

    ws.on("close", () => {
        console.log(`❌ Jugador ${playerId} desconectado`);
        delete players[playerId];
        broadcast({ type: "player_left", id: playerId });
    });

    ws.on("error", (error) => {
        console.error(`⚠️ Error en conexión del jugador ${playerId}:`, error);
    });
});

console.log("🚀 Servidor WebSocket corriendo en ws://localhost:8080");
