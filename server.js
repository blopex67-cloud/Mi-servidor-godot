const WebSocket = require("ws");
const server = new WebSocket.Server({ port: process.env.PORT || 8080 });

// Sistema de salas (Rooms)
const rooms = {
    battle_royale: { players: {} }
};
let duelRoomCounter = 1;

function getAvailableDuelRoom() {
    for (const roomId in rooms) {
        if (roomId.startsWith("squad_duel_")) {
            const playerCount = Object.keys(rooms[roomId].players).length;
            if (playerCount < 8) return roomId; // Max 4v4 (8 jugadores por sala)
        }
    }
    const newRoomId = "squad_duel_" + duelRoomCounter++;
    rooms[newRoomId] = { players: {} };
    return newRoomId;
}

function broadcast(message, roomId, excludeId = null) {
    const data = JSON.stringify(message);
    server.clients.forEach((client) => {
        if (client.readyState === WebSocket.OPEN && client.roomId === roomId) {
            if (client.playerId !== excludeId) {
                client.send(data);
            }
        }
    });
}

server.on("connection", (ws, req) => {
    const playerId = Date.now();
    ws.playerId = playerId;

    // Leer url ej: wss://midominio.com/?mode=squad_duel
    const queryParts = req.url.split('?');
    let gameMode = "battle_royale";
    if (queryParts.length > 1) {
        const params = new URLSearchParams(queryParts[1]);
        gameMode = params.get("mode") || "battle_royale";
    }
    
    let roomId;
    let team = 0;

    // Asignar Sala y Equipo
    if (gameMode === "squad_duel") {
        roomId = getAvailableDuelRoom();
        
        let team1Count = 0;
        let team2Count = 0;
        for (const pid in rooms[roomId].players) {
            if (rooms[roomId].players[pid].team === 1) team1Count++;
            else if (rooms[roomId].players[pid].team === 2) team2Count++;
        }
        // Asignar al equipo con menos jugadores
        team = (team1Count <= team2Count) ? 1 : 2;
    } else {
        roomId = "battle_royale";
        if (!rooms[roomId]) rooms[roomId] = { players: {} };
    }

    ws.roomId = roomId;

    rooms[roomId].players[playerId] = {
        x: 0, y: 0, z: 0, rot: 0,
        firing: false, weapon_drawn: false, transitioning: false, transition_anim: "",
        health: 100, is_dead: false,
        is_sliding: false, is_sliding_out: false, is_skydiving: false,
        skin: "default",
        team: team
    };

    console.log(`✅ Jugador ${playerId} conectado a sala [${roomId}](Equipo: ${team})`);

    ws.send(JSON.stringify({
        type: "id_assignment",
        id: playerId,
        team: team
    }));

    for (const [id, data] of Object.entries(rooms[roomId].players)) {
        if (parseInt(id) !== playerId) {
            ws.send(JSON.stringify({
                type: "player_joined",
                id: parseInt(id),
                x: data.x, y: data.y, z: data.z, rot: data.rot,
                firing: data.firing, weapon_drawn: data.weapon_drawn,
                transitioning: data.transitioning, transition_anim: data.transition_anim,
                health: data.health, is_dead: data.is_dead,
                is_sliding: data.is_sliding, is_sliding_out: data.is_sliding_out, is_skydiving: data.is_skydiving,
                skin: data.skin,
                team: data.team
            }));
        }
    }

    broadcast({
        type: "player_joined",
        id: playerId,
        x: 0, y: 0, z: 0, rot: 0,
        firing: false, weapon_drawn: false, transitioning: false, transition_anim: "",
        health: 100, is_dead: false,
        is_sliding: false, is_sliding_out: false, is_skydiving: false,
        skin: "default",
        team: team
    }, roomId, playerId);

    ws.on("message", (message) => {
        try {
            const msg = JSON.parse(message);
            const myRoom = rooms[roomId]; 
            if (!myRoom || !myRoom.players[playerId]) return;

            if (msg.type === "change_skin") {
                myRoom.players[playerId].skin = msg.skin;
                broadcast({ type: "skin_updated", id: playerId, skin: msg.skin }, roomId);
            }

            if (msg.type === "move") {
                const p = myRoom.players[playerId];
                p.x = msg.x; p.y = msg.y; p.z = msg.z; p.rot = msg.rot;
                p.firing = msg.firing ?? false;
                p.weapon_drawn = msg.weapon_drawn ?? false;
                p.transitioning = msg.transitioning ?? false;
                p.transition_anim = msg.transition_anim ?? "";
                p.health = msg.health ?? 100;
                p.is_dead = msg.is_dead ?? false;
                p.is_sliding = msg.is_sliding ?? false;
                p.is_sliding_out = msg.is_sliding_out ?? false;
                p.is_skydiving = msg.is_skydiving ?? false;
                
                if (msg.skin) p.skin = msg.skin;

                broadcast({
                    type: "player_moved",
                    id: playerId,
                    x: msg.x, y: msg.y, z: msg.z, rot: msg.rot,
                    firing: p.firing, weapon_drawn: p.weapon_drawn,
                    transitioning: p.transitioning, transition_anim: p.transition_anim,
                    health: p.health, is_dead: p.is_dead,
                    is_sliding: p.is_sliding, is_sliding_out: p.is_sliding_out, is_skydiving: p.is_skydiving,
                    skin: p.skin 
                }, roomId, playerId);
            }

            if (msg.type === "hit") {
                broadcast({
                    type: "hit",
                    attacker_id: playerId,
                    target: msg.target,
                    damage: msg.damage
                }, roomId);
            }

            if (msg.type === "death") {
                myRoom.players[playerId].is_dead = true;
                myRoom.players[playerId].health = 0;
                broadcast({ type: "death", id: playerId, killer_id: msg.killer_id ?? -1 }, roomId);
            }

            if (msg.type === "respawn") {
                myRoom.players[playerId].is_dead = false;
                myRoom.players[playerId].health = 100;
                broadcast({ type: "respawn", id: playerId }, roomId);
            }

        } catch (error) {
            console.error("❌ Error procesando mensaje:", error);
        }
    });

    ws.on("close", () => {
        console.log(`❌ Jugador ${playerId} desconectado de sala [${roomId}]`);
        if (rooms[roomId] && rooms[roomId].players[playerId]) {
            delete rooms[roomId].players[playerId];
            broadcast({ type: "player_left", id: playerId }, roomId);
            
            if (roomId !== "battle_royale" && Object.keys(rooms[roomId].players).length === 0) {
                delete rooms[roomId];
                console.log(`🧹 Sala [${roomId}] eliminada por estar vacía`);
            }
        }
    });

    ws.on("error", (error) => {
        console.error(`⚠️ Error en conexión del jugador ${playerId}:`, error);
    });
});

console.log("🚀 Servidor WebSocket corriendo correctamente");
