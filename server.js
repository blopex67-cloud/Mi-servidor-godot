const express = require('express');
const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const cors = require('cors');
const WebSocket = require('ws');
const http = require('http');
const nodemailer = require('nodemailer'); // <--- NUEVA LIBRERÍA PARA CORREOS

// --- 1. CONFIGURACIÓN DEL SERVIDOR ---
const PORT = process.env.PORT || 10000;
const JWT_SECRET = process.env.JWT_SECRET || "mi_clave_super_secreta_para_el_juego";
const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://localhost:27017/mi_juego_db';

// VARIABLES PARA EL CORREO (Se configuran en Render)
const EMAIL_USER = process.env.EMAIL_USER || 'tu_correo@gmail.com'; 
const EMAIL_PASS = process.env.EMAIL_PASS || 'tu_contraseña_de_aplicacion'; 

const app = express();
app.use(express.json());
app.use(cors());

const server = http.createServer(app);

// Configuración del servicio de correos
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
        res
    
