<!DOCTYPE html>
<html lang="es">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Juego Multiplayer</title>
    <style>
        /* Estilos básicos para que ocupe toda la pantalla */
        body {
            margin: 0;
            overflow: hidden;
            background-color: #2c3e50;
            color: white;
            font-family: Arial, sans-serif;
        }

        /* Pantalla de desconexión (Oculta por defecto) */
        #no-wifi-message {
            display: none; 
            position: absolute; 
            top: 0; 
            left: 0; 
            width: 100vw; 
            height: 100vh; 
            background: rgba(0, 0, 0, 0.9); 
            color: #e74c3c; 
            flex-direction: column;
            justify-content: center; 
            align-items: center; 
            z-index: 9999;
        }

        #game-ui {
            padding: 20px;
        }
    </style>
</head>
<body>

    <!-- Pantalla de falta de conexión -->
    <div id="no-wifi-message">
        <h1>⚠️ Sin Conexión</h1>
        <p>No hay internet o el servidor está apagado. Intentando reconectar...</p>
    </div>

    <!-- Interfaz de tu juego -->
    <div id="game-ui">
        <h1>El juego ha iniciado 🚀</h1>
        <p>Tu ID de jugador: <strong id="mi-id">Conectando...</strong></p>
        <p>Otros jugadores en la partida: <strong id="contador-jugadores">0</strong></p>
    </div>

    <script>
        const noWifiScreen = document.getElementById("no-wifi-message");
        const miIdElemento = document.getElementById("mi-id");
        
        let ws;
        let miId = null;
        let otrosJugadores = {};

        // 1. Detectar si el usuario apaga el WiFi en su PC/Móvil
        window.addEventListener("offline", () => {
            noWifiScreen.style.display = "flex";
        });

        window.addEventListener("online", () => {
            noWifiScreen.style.display = "none";
            conectarServidor(); // Reconectar rápido al volver el internet
        });

        // 2. Función principal para conectar al servidor (Inicia al instante)
        function conectarServidor() {
            // Evitar múltiples conexiones si ya está conectando
            if (ws && (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING)) {
                return;
            }

            console.log("Intentando conectar al servidor...");
            ws = new WebSocket("ws://localhost:8080"); // La IP de tu servidor

            // Cuando la conexión es exitosa (Juego inicia)
            ws.onopen = () => {
                console.log("✅ Conectado al servidor");
                noWifiScreen.style.display = "none"; // Ocultar mensaje de error
                iniciarJuego();
            };

            // Recibir mensajes de tu servidor Node.js
            ws.onmessage = (evento) => {
                const msg = JSON.parse(evento.data);

                if (msg.type === "id_assignment") {
                    miId = msg.id;
                    miIdElemento.innerText = miId;
                }

                if (msg.type === "player_joined") {
                    otrosJugadores[msg.id] = msg;
                    actualizarUI();
                }

                if (msg.type === "player_left") {
                    delete otrosJugadores[msg.id];
                    actualizarUI();
                }
            };

            // Si el servidor se apaga o se pierde la conexión
            ws.onclose = () => {
                console.log("❌ Desconectado del servidor");
                noWifiScreen.style.display = "flex"; // Mostrar pantalla de error
                
                // Intentar reconectar cada 2 segundos automáticamente
                setTimeout(conectarServidor, 2000); 
            };

            ws.onerror = (error) => {
                console.error("⚠️ Error en WebSocket");
                ws.close(); // Forzar el cierre para que onclose intente reconectar
            };
        }

        // Función donde pones la lógica de tu juego (Three.js, Canvas, etc.)
        function iniciarJuego() {
            // Aquí va el código de tu juego real.
            // Por ejemplo, enviar tu posición inicial:
            if(ws.readyState === WebSocket.OPEN) {
                ws.send(JSON.stringify({
                    type: "move",
                    x: 0, y: 0, z: 0,
                    rot: 0, health: 100
                }));
            }
        }

        // Actualizar datos visuales simples
        function actualizarUI() {
            document.getElementById("contador-jugadores").innerText = Object.keys(otrosJugadores).length;
        }

        // 3. INICIAR INSTANTÁNEAMENTE AL CARGAR LA PÁGINA
        conectarServidor();

    </script>
</body>
</html>
