const WebSocket = require("ws")
const wss = new WebSocket.Server({ port: process.env.PORT || 9000 })

const salas = {}

function codigo() {
  return Math.random().toString(36).substring(2,7).toUpperCase()
}

function broadcast(sala, msg, excepto = null) {
  const s = salas[sala]
  if (!s) return
  for (const [ws, info] of Object.entries(s.jugadores)) {
    if (ws !== excepto && ws.readyState === 1)
      ws.send(JSON.stringify(msg))
  }
}

wss.on("connection", ws => {
  let miNombre = "", miSala = ""

  ws.send(JSON.stringify({ tipo: "bienvenido" }))

  ws.on("message", raw => {
    const msg = JSON.parse(raw)
    miNombre = msg.nombre || miNombre

    if (msg.tipo === "crear") {
      const cod = codigo()
      salas[cod] = { jugadores: { [ws]: { nombre: miNombre } }, listos: 0 }
      miSala = cod
      ws.send(JSON.stringify({ tipo: "sala_creada", codigo: cod }))
    }

    if (msg.tipo === "unir") {
      const s = salas[msg.sala]
      if (!s) return ws.send(JSON.stringify({ tipo: "error", msg: "No existe" }))
      s.jugadores[ws] = { nombre: miNombre }
      miSala = msg.sala
      const jugs = {}
      for (const [_, info] of Object.entries(s.jugadores)) jugs[info.nombre] = info.nombre
      ws.send(JSON.stringify({ tipo: "sala_unida", sala: miSala, jugadores: jugs }))
      broadcast(miSala, { tipo: "entro", id: miNombre, nombre: miNombre }, ws)
    }

    if (msg.tipo === "listo") {
      const s = salas[miSala]
      if (!s) return
      s.listos++
      if (s.listos >= Object.keys(s.jugadores).length) {
        const jugs = {}
        for (const [_, i] of Object.entries(s.jugadores)) jugs[i.nombre] = i.nombre
        broadcast(miSala, { tipo: "inicio", jugadores: jugs })
        ws.send(JSON.stringify({ tipo: "inicio", jugadores: jugs }))
      }
    }

    if (msg.tipo === "pos") {
      broadcast(miSala, { tipo: "pos", de: miNombre, x: msg.x, y: msg.y, z: msg.z }, ws)
    }
  })

  ws.on("close", () => {
    if (miSala && salas[miSala]) {
      delete salas[miSala].jugadores[ws]
      broadcast(miSala, { tipo: "salio", id: miNombre, nombre: miNombre })
    }
  })
})

console.log("Servidor corriendo!")
