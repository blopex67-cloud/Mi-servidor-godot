const express = require('express');
const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const cors = require('cors');
const WebSocket = require('ws');
const http = require('http');
const nodemailer = require('nodemailer');

// --- 1. CONFIGURACIÓN DEL SERVIDOR ---
const PORT = process.env.PORT || 10000;
const JWT_SECRET = process.env.JWT_SECRET || "mi_clave_super_secreta_para_el_juego";
const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://localhost:27017/mi_juego_db';

const EMAIL_USER = process.env.EMAIL_USER || 'tu_correo@gmail.com'; 
const EMAIL_PASS = process.env.EMAIL_PASS || 'tu_contrasena_de_aplicacion'; 

const app = express();
app.use(express.json());
app.use(cors());

const server = http.createServer(app);

const transporter = nodemailer.createTransport({
    service: 'gmail',
    auth: {
        user: EMAIL_USER,
        pass: EMAIL_PASS
    }
});

// --- 2. CONEXIÓN A MONGODB ---
mongoose.connect(MONGODB_URI)
    .then(() => console.log("MongoDB conectado exitosamente"))
    .catch(err => console.error("Error conectando a MongoDB:", err));

const userSchema = new mongoose.Schema({
    email: { type: String, required: true, unique: true },
    password: { type: String, required: true }
});
const User = mongoose.model('User', userSchema);

// --- 3. RUTAS HTTP (SISTEMA DE CUENTAS) ---
app.get('/', (req, res) => {
    res.send('Servidor PvP y Cuentas Godot activo y funcionando\n');
});

app.post('/register', async (req, res) => {
    try {
        const { email, password } = req.body;
        const hashedPassword = await bcrypt.hash(password, 10);
        const newUser = new User({ email, password: hashedPassword });
        await newUser.save();
        
        const token = jwt.sign({ id: newUser._id }, JWT_SECRET, { expiresIn: '30d' });
        res.status(201).json({ message: "Cuenta creada", token: token });
    } catch (error) {
        res.status(400).json({ error: "El correo ya está en uso o datos inválidos" });
    }
});

app.post('/login', async (req, res) => {
    try {
        const { email, password } = req.body;
        const user = await User.findOne({ email });
        
        if (!user) return res.status(404).json({ error: "Correo no encontrado" });
        
        const isMatch = await bcrypt.compare(password, user.password);
        if (!isMatch) return res.status(401).json({ error: "Contraseña incorrecta" });

        const token = jwt.sign({ id: user._id }, JWT_SECRET, { expiresIn: '30d' });
        res.status(200).json({ message: "Login exitoso", token: token });
    } catch (error) {
        res.status(500).json({ error: "Error en el servidor" });
    }
});

app.post('/verify_token', async (req, res) => {
    const { token } = req.body;
    if (!token) return res.status(401).json({ error: "No hay token" });

    try {
        const decoded = jwt.verify(token, JWT_SECRET);
        const user = await User.findById(decoded.id);
        if (!user) return res.status(404).json({ error: "Usuario no existe" });

        res.status(200).json({ message: "Token válido", email: user.email });
    } catch (error) {
        res.status(401).json({ error: "Token inválido o expirado" });
    }
});

app.post('/forgot-password', async (req, res) => {
    try {
        const { email } = req.body;
        const user = await User.findOne({ email });

        if (!user) {
            return res.status(404).json({ error: "No hay ninguna cuenta con este correo." });
        }

        const tempPassword = Math.random().toString(36).slice(-6);
        const hashedPassword = await bcrypt.hash(tempPassword, 10);
        user.password = hashedPassword;
        await user.save();

        const mailOptions = {
            from: EMAIL_USER,
            to: email,
            subject: 'Recuperación de contraseña - Tu Juego PvP',
            text: `Hola!\n\nHemos restablecido tu contraseña.\n\nTu nueva contraseña temporal es: ${tempPassword}\n\nPor favor, usa esta contraseña para iniciar sesión y cambiarla más adelante.`
        };

        transporter.sendMail(mailOptions, (error, info) => {
            if (error) {
                console.error("Error enviando correo:", error);
                return res.status(500).json({ error: "Error al enviar el correo." });
            } else {
                return res.status(200).json({ message: "Correo enviado con éxito." });
            }
        });

    } catch (error) {
        res.status(500).json({ error: "Error en el servidor al recuperar contraseña." });
    }
});

// --- 4. SERVIDOR WEBSOCKET (SISTEMA PVP) ---
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

    ws.on('message', (message) => {
        try {
            const data = JSON.parse(message);
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
            console.error("Error procesando mensaje WS:", error);
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

// --- 5. INICIAR EL SERVIDOR COMPLETO ---
server.listen(PORT, () => {
    console.log(`Servidor maestro (HTTP + WebSocket) escuchando en puerto ${PORT}`);
});
// FIN DEL SCRIPT (Asegúrate de copiar hasta esta línea)
