const WebSocket = require("ws");
const server = new WebSocket.Server({ port: process.env.PORT || 8080 });

const MAX_PLAYERS_PER_SESSION = 32; // Estilo GTA Online

// Sistema de Sesiones (Mundo Abierto)
const sessions = {};
let sessionCounter = 1;

// Función para encontrar o crear una sesión disponible
function getAvailableSession() {
    for (const sessionId in sessions) {
        const playerCount = Object.keys(sessions[sessionId].players).length;
        if (playerCount < MAX_PLAYERS_PER_SESSION) {
            return sessionId;
        }
    }
    // Si no hay sesiones o todas están llenas, crear una nueva
    const newSessionId = "session_freeroam_" + sessionCounter++;
    sessions[newSessionId] = { 
        players: {},
        vehicles: {} // Aquí podrías guardar el estado persistente de los vehículos si lo deseas
    };
    console.log(`🌍 Nueva sesión de mundo abierto creada: ${newSessionId}`);
    return newSessionId;
}

// Enviar mensaje a todos en la sesión, excepto a un jugador opcional
function broadcast(message, sessionId, excludeId = null) {
    const data = JSON.stringify(message);
    server.clients.forEach((client) => {
        if (client.readyState === WebSocket.OPEN && client.sessionId === sessionId) {
            if (client.playerId !== excludeId) {
                client.send(data);
            }
        }
    });
}

server.on("connection", (ws, req) => {
    const playerId = Date.now();
    ws.playerId = playerId;

    // Asignar al jugador a una sesión de mundo abierto
    const sessionId = getAvailableSession();
    ws.sessionId = sessionId;

    // Estado inicial del jugador estilo GTA
    sessions[sessionId].players[playerId] = {
        x: 0, y: 0, z: 0, heading: 0, // Posición y rotación
        state: "on_foot", // "on_foot", "driving", "passenger"
        vehicle_id: null,
        current_weapon: "unarmed", // Arma actual
        is_aiming: false,
        is_shooting: false,
        health: 100,
        armor: 0, // Añadido chaleco antibalas
        is_dead: false,
        skin: "mp_m_freemode_01" // Skin por defecto (estilo GTA Online)
    };

    console.log(`✅ Jugador ${playerId} entró a la sesión [${sessionId}](${Object.keys(sessions[sessionId].players).length}/${MAX_PLAYERS_PER_SESSION})`);

    // 1. Enviarle su ID y sesión al jugador que se acaba de conectar
    ws.send(JSON.stringify({
        type: "id_assignment",
        id: playerId,
        sessionId: sessionId
    }));

    // 2. Enviarle al nuevo jugador los datos de todos los demás que ya están en la sesión
    for (const [id, data] of Object.entries(sessions[sessionId].players)) {
        if (parseInt(id) !== playerId) {
            ws.send(JSON.stringify({
                type: "player_joined",
                id: parseInt(id),
                ...data
            }));
        }
    }

    // 3. Avisar a los demás que este jugador ha entrado
    broadcast({
        type: "player_joined",
        id: playerId,
        ...sessions[sessionId].players[playerId]
    }, sessionId, playerId);

    // Escuchar mensajes del cliente
    ws.on("message", (message) => {
        try {
            const msg = JSON.parse(message);
            const mySession = sessions[sessionId]; 
            if (!mySession || !mySession.players[playerId]) return;

            const p = mySession.players[playerId];

            switch (msg.type) {
                // Sincronización de movimiento a pie
                case "sync_ped":
                    if (p.is_dead) return;
                    p.x = msg.x ?? p.x;
                    p.y = msg.y ?? p.y;
                    p.z = msg.z ?? p.z;
                    p.heading = msg.heading ?? p.heading;
                    p.state = "on_foot";
                    p.current_weapon = msg.current_weapon ?? p.current_weapon;
                    p.is_aiming = msg.is_aiming ?? false;
                    p.is_shooting = msg.is_shooting ?? false;

                    broadcast({
                        type: "sync_ped",
                        id: playerId,
                        x: p.x, y: p.y, z: p.z, heading: p.heading,
                        current_weapon: p.current_weapon,
                        is_aiming: p.is_aiming,
                        is_shooting: p.is_shooting
                    }, sessionId, playerId);
                    break;

                // Sincronización de vehículos (conduciendo)
                case "sync_vehicle":
                    p.state = msg.is_passenger ? "passenger" : "driving";
                    p.vehicle_id = msg.vehicle_id;

                    broadcast({
                        type: "sync_vehicle",
                        id: playerId,
                        vehicle_id: msg.vehicle_id,
                        x: msg.x, y: msg.y, z: msg.z, // Posición del coche
                        rot_x: msg.rot_x, rot_y: msg.rot_y, rot_z: msg.rot_z, // Rotación del coche
                        speed: msg.speed,
                        steering: msg.steering,
                        is_passenger: msg.is_passenger
                    }, sessionId, playerId);
                    break;

                // Sistema de daño genérico (disparos, atropellos, caídas)
                case "damage":
                    if (p.is_dead) return;
                    
                    // Lógica básica: el armor absorbe primero
                    if (p.armor > 0) {
                        p.armor -= msg.amount;
                        if (p.armor < 0) {
                            p.health += p.armor; // El daño sobrante pasa a la salud
                            p.armor = 0;
                        }
                    } else {
                        p.health -= msg.amount;
                    }

                    if (p.health <= 0) {
                        p.health = 0;
                        p.is_dead = true;
                        
                        broadcast({ 
                            type: "player_wasted", // Referencia a "Wasted" de GTA
                            id: playerId, 
                            killer_id: msg.attacker_id ?? null 
                        }, sessionId);
                    } else {
                        // Sincronizar la salud restante a todos (o solo al jugador)
                        broadcast({ type: "health_update", id: playerId, health: p.health, armor: p.armor }, sessionId);
                    }
                    break;

                // Reaparición (Saliendo del hospital)
                case "respawn":
                    p.is_dead = false;
                    p.health = 100;
                    p.armor = 0;
                    p.x = msg.x ?? 0; // Coordenadas del hospital pasadas por el cliente
                    p.y = msg.y ?? 0;
                    p.z = msg.z ?? 0;
                    
                    broadcast({ type: "respawn", id: playerId, x: p.x, y: p.y, z: p.z }, sessionId);
                    break;

                // Cambio de ropa/skin
                case "change_clothes":
                    p.skin = msg.skin;
                    broadcast({ type: "clothes_updated", id: playerId, skin: msg.skin }, sessionId);
                    break;

                // Chat local de la sesión
                case "chat":
                    broadcast({
                        type: "chat_message",
                        sender_id: playerId,
                        text: msg.text
                    }, sessionId);
                    break;
            }

        } catch (error) {
            console.error("❌ Error procesando mensaje:", error);
        }
    });

    ws.on("close", () => {
        console.log(`❌ Jugador ${playerId} desconectado de sesión [${sessionId}]`);
        if (sessions[sessionId] && sessions[sessionId].players[playerId]) {
            delete sessions[sessionId].players[playerId];
            broadcast({ type: "player_left", id: playerId }, sessionId);
            
            // Si la sesión se queda vacía, la eliminamos para liberar memoria
            if (Object.keys(sessions[sessionId].players).length === 0) {
                delete sessions[sessionId];
                console.log(`🧹 Sesión [${sessionId}] eliminada por estar vacía`);
            }
        }
    });

    ws.on("error", (error) => {
        console.error(`⚠️ Error en conexión del jugador ${playerId}:`, error);
    });
});

console.log("🚀 Servidor WebSocket (GTA Style) corriendo en puerto", process.env.PORT || 8080);
