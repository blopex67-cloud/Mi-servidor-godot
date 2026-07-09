const WebSocket = require('ws');

const PORT = process.env.PORT || 3000;

// ✅ FIX Railway — usar http server
const http   = require('http');
const server = http.createServer((req, res) => {
  res.writeHead(200);
  res.end('Servidor online ✅');
});
const wss = new WebSocket.Server({ server });

server.listen(PORT, '0.0.0.0', () => {
  console.log(`🎮 Servidor escuchando en puerto ${PORT}`);
});

// ══════════════════════════════════════════════
//  ALMACENAMIENTO
// ══════════════════════════════════════════════
const salas   = new Map(); // codigo → { jugadores: Map(nombre → ws) }
const clientes = new Map(); // ws → { nombre, sala }

// ══════════════════════════════════════════════
//  GENERAR CÓDIGO DE SALA
// ══════════════════════════════════════════════
function generarCodigo() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code = '';
  for (let i = 0; i < 5; i++) {
    code += chars[Math.floor(Math.random() * chars.length)];
  }
  // Evitar duplicados
  if (salas.has(code)) return generarCodigo();
  return code;
}

// ══════════════════════════════════════════════
//  CONEXIÓN
// ══════════════════════════════════════════════
wss.on('connection', (ws) => {
  console.log('🔌 Cliente conectado');

  clientes.set(ws, { nombre: null, sala: null });

  // Bienvenida
  ws.send(JSON.stringify({ tipo: 'bienvenido' }));

  // ── Mensajes ─────────────────────────────────
  ws.on('message', (raw) => {
    try {
      const data = JSON.parse(raw);
      console.log('📨 Recibido:', data);

      switch (data.tipo) {

        // ── CREAR SALA ──────────────────────────
        case 'crear': {
          const nombre = data.nombre || 'Jugador';
          const codigo = generarCodigo();

          // Crear sala
          salas.set(codigo, { jugadores: new Map() });
          salas.get(codigo).jugadores.set(nombre, ws);

          // Registrar cliente
          clientes.set(ws, { nombre, sala: codigo });

          console.log(`🏠 Sala creada: ${codigo} por ${nombre}`);

          ws.send(JSON.stringify({
            tipo:   'sala_creada',
            codigo: codigo,
            nombre: nombre,
          }));
          break;
        }

        // ── UNIRSE A SALA ───────────────────────
        case 'unir': {
          const nombre = data.nombre || 'Jugador';
          const codigo = (data.sala || '').toUpperCase().trim();

          if (!salas.has(codigo)) {
            ws.send(JSON.stringify({
              tipo: 'error',
              msg:  'Sala no encontrada: ' + codigo,
            }));
            return;
          }

          const sala = salas.get(codigo);
          sala.jugadores.set(nombre, ws);
          clientes.set(ws, { nombre, sala: codigo });

          console.log(`👤 ${nombre} se unió a sala ${codigo}`);

          ws.send(JSON.stringify({
            tipo:   'sala_unida',
            sala:   codigo,
            nombre: nombre,
          }));

          // Avisar a los demás
          broadcastSala(codigo, {
            tipo:   'jugador_unido',
            nombre: nombre,
          }, ws);
          break;
        }

        // ── LISTO ───────────────────────────────
        case 'listo': {
          const info  = clientes.get(ws);
          if (!info || !info.sala) return;

          const sala  = salas.get(info.sala);
          if (!sala) return;

          const total = sala.jugadores.size;
          console.log(`✅ ${info.nombre} listo. Jugadores en sala: ${total}`);

          // Iniciar si hay 2+ jugadores
          if (total >= 2) {
            console.log(`🚀 Iniciando juego en sala ${info.sala}`);
            broadcastSala(info.sala, { tipo: 'inicio' });
          }
          break;
        }

        // ── POSICIÓN ────────────────────────────
        case 'pos': {
          const info = clientes.get(ws);
          if (!info || !info.sala) return;

          broadcastSala(info.sala, {
            tipo:   'pos',
            nombre: data.nombre,
            x:      data.x,
            y:      data.y,
            z:      data.z,
            rot:    data.rot,
          }, ws);
          break;
        }
      }

    } catch (e) {
      console.error('❌ Error parseando:', e);
    }
  });

  // ── Desconexión ───────────────────────────────
  ws.on('close', () => {
    const info = clientes.get(ws);
    if (info && info.sala) {
      const sala = salas.get(info.sala);
      if (sala) {
        sala.jugadores.delete(info.nombre);
        broadcastSala(info.sala, {
          tipo:   'jugador_salio',
          nombre: info.nombre,
        });
        // Eliminar sala vacía
        if (sala.jugadores.size === 0) {
          salas.delete(info.sala);
          console.log(`🗑 Sala ${info.sala} eliminada`);
        }
      }
    }
    clientes.delete(ws);
    console.log('🔴 Cliente desconectado');
  });
});

// ══════════════════════════════════════════════
function broadcastSala(codigo, mensaje, excluir = null) {
  const sala = salas.get(codigo);
  if (!sala) return;
  const data = JSON.stringify(mensaje);
  sala.jugadores.forEach((clienteWs) => {
    if (clienteWs !== excluir && clienteWs.readyState === WebSocket.OPEN) {
      clienteWs.send(data);
    }
  });
}
