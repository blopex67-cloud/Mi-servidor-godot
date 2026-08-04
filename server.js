const WebSocket = require('ws');
const http = require('http');

// Render asigna un puerto en la variable de entorno PORT, si no, usa el 10000
const PORT = process.env.PORT || 10000;

// 1. Crear un servidor HTTP básico
// Esto es útil para que Render verifique que el servidor está "vivo" (Health Check)
const server = http.createServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/plain' });
    res.end('Servidor de Godot Multiplayer Activo\n');
});

// 2. Iniciar el servidor WebSocket montado sobre el servidor HTTP
const wss = new WebSocket.Server({ server });

// Mapa para guardar los jugadores conectados y sus conexiones
const clients = new Map();
let nextClientId = 1; // ID auto-incremental para cada jugador

// Función auxiliar para enviar un mensaje a todos MENOS al que lo envió
function broadcast(messageObj, excludeClientId = null) {
    const messageString = JSON.stringify(messageObj);
    for (const [id, ws] of clients.entries()) {
        if (id !== excludeClientId && ws.readyState === WebSocket.OPEN) {
            ws.send(messageString);
        }
    }
}

// 3. Lógica cuando un cliente (móvil) se conecta
wss.on('connection', (ws) => {
    const clientId = nextClientId++;
    clients.set(clientId, ws);
    
    console.log(`[+] Jugador conectado. ID asignado: ${clientId}`);

    // Enviar mensaje de bienvenida al propio jugador con su ID
    ws.send(JSON.stringify({
        type: 'welcome',
        id: clientId
    }));

    // Avisar a los demás jugadores que alguien nuevo entró
    broadcast({
        type: 'player_joined',
        id: clientId
    }, clientId);

    // 4. Escuchar los mensajes que envía este cliente
    ws.on('message', (message) => {
        try {
            // Transformar el mensaje que llega de Godot a un objeto de JavaScript
            const data = JSON.parse(message);
            
            // Le forzamos el ID del remitente real para evitar trampas (spoofing)
            data.id = clientId;

            // Retransmitir la acción (movimiento, disparo, etc.) a los demás jugadores
            broadcast(data, clientId);

        } catch (error) {
            console.error(`Error al procesar el mensaje del cliente ${clientId}:`, error);
        }
    });

    // 5. Lógica cuando el jugador se desconecta (cierra la app o pierde internet)
    ws.on('close', () => {
        console.log(`[-] Jugador desconectado. ID: ${clientId}`);
        clients.delete(clientId);

        // Avisar a los demás que este jugador se fue para que borren su personaje 3D
        broadcast({
            type: 'player_left',
            id: clientId
        });
    });
});

// 6. Iniciar el servidor
server.listen(PORT, () => {
    console.log(`Servidor WebSocket escuchando en el puerto ${PORT}`);
});
