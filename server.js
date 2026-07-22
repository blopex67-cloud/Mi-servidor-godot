extends Node3D

# ─────────────────────────────────────────────────────────────
#  CONFIGURACIÓN
# ─────────────────────────────────────────────────────────────
const SERVER_URL = "wss://mi-servidor-godot-production.up.railway.app"

# ─── WebSocket ───────────────────────────────────────────────
var socket          := WebSocketPeer.new()
var my_id           := -1
var connected       := false
var send_timer      := 0.0
const SEND_INTERVAL := 0.05

# ─── Jugadores ───────────────────────────────────────────────
var remote_players := {}
var my_player       = null

# ─── HUD ─────────────────────────────────────────────────────
var canvas        : CanvasLayer
var start_panel   : PanelContainer
var hud_label     : Label
var players_label : Label

# ─── Colores ─────────────────────────────────────────────────
const COL_GREEN  := Color(0.0,  1.0,  0.25, 1.0)
const COL_ORANGE := Color(1.0,  0.4,  0.0,  1.0)
const COL_DARK   := Color(0.0,  0.0,  0.0,  0.75)
const COL_WHITE  := Color(1.0,  1.0,  1.0,  1.0)

@onready var players_node = $players


# ─────────────────────────────────────────────────────────────
func _ready() -> void:
	_build_ui()
	_try_fallback_camera()


# ─── Cámara de respaldo si no hay player aún ─────────────────
func _try_fallback_camera() -> void:
	var cams = get_tree().get_nodes_in_group("cameras")
	if cams.size() > 0:
		cams[0].make_current()
		return
	var all_cams = get_tree().root.find_children("*", "Camera3D", true)
	if all_cams.size() > 0:
		all_cams[0].make_current()


# ═════════════════════════════════════════════════════════════
#  BUILD UI
# ═════════════════════════════════════════════════════════════
func _build_ui() -> void:
	canvas = CanvasLayer.new()
	add_child(canvas)
	_build_start_panel()
	_build_hud()

# ─── PANTALLA DE INICIO ───────────────────────────────────────
func _build_start_panel() -> void:
	var bg = ColorRect.new()
	bg.color = Color(0, 0, 0, 1.0)
	bg.set_anchors_preset(Control.PRESET_FULL_RECT)
	canvas.add_child(bg)

	start_panel = PanelContainer.new()
	start_panel.set_anchors_preset(Control.PRESET_CENTER)
	start_panel.custom_minimum_size = Vector2(440, 300)

	var style = StyleBoxFlat.new()
	style.bg_color     = Color(0.03, 0.03, 0.03, 0.97)
	style.border_color = COL_GREEN
	style.set_border_width_all(2)
	style.set_corner_radius_all(2)
	start_panel.add_theme_stylebox_override("panel", style)
	canvas.add_child(start_panel)

	var vbox = VBoxContainer.new()
	vbox.alignment = BoxContainer.ALIGNMENT_CENTER
	vbox.add_theme_constant_override("separation", 14)
	start_panel.add_child(vbox)

	var skull = Label.new()
	skull.text = "☠"
	skull.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	skull.add_theme_font_size_override("font_size", 42)
	skull.add_theme_color_override("font_color", COL_GREEN)
	vbox.add_child(skull)

	var title = Label.new()
	title.text = "BATTLE ZONE"
	title.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	title.add_theme_font_size_override("font_size", 32)
	title.add_theme_color_override("font_color", COL_WHITE)
	title.add_theme_color_override("font_shadow_color", Color(0.0, 1.0, 0.25, 0.6))
	vbox.add_child(title)

	var sep = HSeparator.new()
	var sep_style = StyleBoxFlat.new()
	sep_style.bg_color = Color(0.0, 1.0, 0.25, 0.8)
	sep_style.content_margin_top = 1
	sep.add_theme_stylebox_override("separator", sep_style)
	vbox.add_child(sep)

	var url_label = Label.new()
	url_label.text = "// " + SERVER_URL.replace("wss://", "").to_upper()
	url_label.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	url_label.add_theme_font_size_override("font_size", 11)
	url_label.add_theme_color_override("font_color", Color(0.0, 1.0, 0.25, 0.9))
	vbox.add_child(url_label)

	var btn = Button.new()
	btn.text = "[ DEPLOY ]"
	btn.custom_minimum_size = Vector2(380, 62)
	btn.add_theme_font_size_override("font_size", 24)
	btn.add_theme_color_override("font_color", Color.BLACK)

	var btn_normal = StyleBoxFlat.new()
	btn_normal.bg_color = COL_GREEN
	btn.add_theme_stylebox_override("normal", btn_normal)

	var btn_hover = StyleBoxFlat.new()
	btn_hover.bg_color = Color(0.0, 0.8, 0.2, 1.0)
	btn.add_theme_stylebox_override("hover", btn_hover)

	var btn_press = StyleBoxFlat.new()
	btn_press.bg_color = COL_ORANGE
	btn.add_theme_stylebox_override("pressed", btn_press)

	btn.pressed.connect(_on_start_pressed)
	vbox.add_child(btn)

	var sub = Label.new()
	sub.text = "PRESS TO ENTER COMBAT ZONE"
	sub.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	sub.add_theme_font_size_override("font_size", 10)
	sub.add_theme_color_override("font_color", Color(0.5, 0.5, 0.5, 0.8))
	vbox.add_child(sub)

	_add_corner_brackets()

func _add_corner_brackets() -> void:
	var green = Color(0.0, 1.0, 0.25, 0.9)
	var size  = 18.0
	var thick = 2.0
	var pad   = 8.0
	var vp    = get_viewport().get_visible_rect().size

	var corners = [
		[Vector2(pad,         pad),          Vector2( 1,  1)],
		[Vector2(vp.x - pad,  pad),          Vector2(-1,  1)],
		[Vector2(pad,         vp.y - pad),   Vector2( 1, -1)],
		[Vector2(vp.x - pad,  vp.y - pad),  Vector2(-1, -1)],
	]

	for corner in corners:
		var pos : Vector2 = corner[0]
		var dir : Vector2 = corner[1]
		var h       = ColorRect.new()
		h.color     = green
		h.size      = Vector2(size, thick)
		h.position  = pos if dir.x > 0 else pos - Vector2(size, 0)
		canvas.add_child(h)
		var v       = ColorRect.new()
		v.color     = green
		v.size      = Vector2(thick, size)
		v.position  = pos if dir.y > 0 else pos - Vector2(0, size)
		canvas.add_child(v)

# ─── HUD EN JUEGO ─────────────────────────────────────────────
func _build_hud() -> void:
	var top_left = PanelContainer.new()
	top_left.position = Vector2(12, 12)
	top_left.custom_minimum_size = Vector2(220, 44)
	var tl_style = StyleBoxFlat.new()
	tl_style.bg_color = COL_DARK
	tl_style.border_color = COL_GREEN
	tl_style.border_width_left = 3
	tl_style.border_width_bottom = 1
	top_left.add_theme_stylebox_override("panel", tl_style)
	top_left.visible = false
	canvas.add_child(top_left)

	var tl_hbox = HBoxContainer.new()
	top_left.add_child(tl_hbox)

	var skull_icon = Label.new()
	skull_icon.text = "☠ "
	skull_icon.add_theme_color_override("font_color", COL_GREEN)
	tl_hbox.add_child(skull_icon)

	hud_label = Label.new()
	hud_label.text = "// CONECTANDO..."
	hud_label.add_theme_color_override("font_color", COL_WHITE)
	tl_hbox.add_child(hud_label)
	hud_label.set_meta("panel", top_left)

	var top_right = PanelContainer.new()
	top_right.anchor_left = 1.0
	top_right.anchor_right = 1.0
	top_right.offset_left = -220.0
	top_right.offset_top = 12.0
	top_right.custom_minimum_size = Vector2(200, 44)
	var tr_style = StyleBoxFlat.new()
	tr_style.bg_color = COL_DARK
	tr_style.border_color = COL_ORANGE
	tr_style.border_width_right = 3
	tr_style.border_width_bottom = 1
	top_right.add_theme_stylebox_override("panel", tr_style)
	top_right.visible = false
	canvas.add_child(top_right)

	var tr_hbox = HBoxContainer.new()
	tr_hbox.alignment = BoxContainer.ALIGNMENT_END
	top_right.add_child(tr_hbox)

	players_label = Label.new()
	players_label.text = "OPERADORES: 0 "
	players_label.add_theme_color_override("font_color", COL_ORANGE)
	tr_hbox.add_child(players_label)
	players_label.set_meta("panel", top_right)

func _show_hud(show: bool) -> void:
	hud_label.get_meta("panel").visible = show
	players_label.get_meta("panel").visible = show


# ─── Botón DEPLOY ────────────────────────────────────────────
func _on_start_pressed() -> void:
	start_panel.get_node("VBoxContainer/Button").disabled = true
	_connect_to_server(SERVER_URL)

func _connect_to_server(url: String) -> void:
	var err = socket.connect_to_url(url)
	if err != OK:
		hud_label.text = "// ERROR DE CONEXIÓN"
		_show_hud(true)
		start_panel.get_node("VBoxContainer/Button").disabled = false
		return

	start_panel.get_node("VBoxContainer/Button").text = "[ CONECTANDO... ]"
	hud_label.text = "// CONECTANDO..."
	players_label.text = "OPERADORES: 0"
	_show_hud(true)


# ─── Loop principal ───────────────────────────────────────────
func _process(delta: float) -> void:
	if not hud_label.get_meta("panel").visible:
		return

	socket.poll()

	match socket.get_ready_state():
		WebSocketPeer.STATE_OPEN:
			if not connected:
				connected = true

			while socket.get_available_packet_count() > 0:
				var text = socket.get_packet().get_string_from_utf8()
				_handle_message(text)

			if my_player != null:
				send_timer += delta
				if send_timer >= SEND_INTERVAL:
					send_timer = 0.0
					_send_my_position()

		WebSocketPeer.STATE_CLOSED:
			if connected:
				connected = false
				hud_label.text = "// DESCONECTADO"


# ─── Mensajes del servidor ────────────────────────────────────
func _handle_message(text: String) -> void:
	var data = JSON.parse_string(text)
	if data == null:
		return

	match data["type"]:
		
		# ✅ El servidor de Node.js envía "id_assignment"
		"id_assignment":
			my_id = int(data["id"])
			hud_label.text = "// OPERADOR #%d" % my_id
			# Forzamos un spawn inicial (puedes ajustar la coordenada en Y)
			_spawn_my_player(Vector3(0, 5, 0))

		"player_joined":
			var pid = int(data["id"])
			if pid != my_id:
				_spawn_remote_player(pid, data)

		# ✅ El servidor de Node.js envía "sync_ped" en vez de "player_moved"
		"sync_ped":
			var pid = int(data["id"])
			if remote_players.has(pid):
				var node = remote_players[pid]
				var target = Vector3(data.get("x", 0), data.get("y", 0), data.get("z", 0))
				var moving = target.distance_to(node.position) > 0.05
				
				# Pasamos el "heading" y "is_shooting" del server
				node.apply_remote_state(
					data.get("x", 0.0),
					data.get("y", 0.0),
					data.get("z", 0.0),
					float(data.get("heading", 0.0)),
					moving,
					bool(data.get("is_shooting", false))
				)

		"player_left", "player_wasted":
			_remove_remote_player(int(data["id"]))

	_update_player_count()


# ─── Spawn jugador LOCAL ──────────────────────────────────────
func _spawn_my_player(spawn_pos: Vector3 = Vector3(0, 1, 0)) -> void:
	# Ocultamos la pantalla de inicio al spawnear
	canvas.get_child(0).visible = false
	start_panel.visible = false

	my_player = preload("res://scenes/character.tscn").instantiate()
	my_player.name = "MyPlayer"
	my_player.is_local = true
	players_node.add_child(my_player)
	my_player.position = spawn_pos
	
	await get_tree().process_frame
	await get_tree().process_frame
	_activate_player_camera()


# ─── Activar cámara del jugador ───────────────────────────────
func _activate_player_camera() -> void:
	if my_player == null:
		return
	var direct_cam = my_player.find_child("Camera3D", true, false)
	if direct_cam != null:
		direct_cam.make_current()
		return
	var cameras = my_player.find_children("*", "Camera3D", true, false)
	if cameras.size() > 0:
		cameras[0].make_current()


# ─── Spawn jugador REMOTO ─────────────────────────────────────
func _spawn_remote_player(pid: int, data: Dictionary) -> void:
	if remote_players.has(pid):
		return
	var p = preload("res://scenes/character.tscn").instantiate()
	p.name = "Player_%d" % pid
	p.is_local = false
	players_node.add_child(p)

	var spawn_pos = Vector3(data.get("x", 0.0), data.get("y", 0.0), data.get("z", 0.0))
	p.position = spawn_pos
	p.remote_target_pos = spawn_pos
	p.remote_target_rot = float(data.get("heading", 0.0))

	remote_players[pid] = p

func _remove_remote_player(pid: int) -> void:
	if remote_players.has(pid):
		remote_players[pid].queue_free()
		remote_players.erase(pid)


# ─── Enviar posición ──────────────────────────────────────────
func _send_my_position() -> void:
	if my_player == null:
		return
	if socket.get_ready_state() != WebSocketPeer.STATE_OPEN:
		return
	var pos = my_player.position
	
	# ✅ Enviamos "sync_ped", "heading" y "is_shooting"
	socket.send_text(JSON.stringify({
		"type":        "sync_ped",
		"x":           pos.x,
		"y":           pos.y,
		"z":           pos.z,
		"heading":     my_player.body.rotation.y,
		"is_shooting": my_player.is_firing
	}))


# ─── Contador jugadores ───────────────────────────────────────
func _update_player_count() -> void:
	var total = remote_players.size() + (1 if my_player != null else 0)
	players_label.text = "OPERADORES: %d" % total
