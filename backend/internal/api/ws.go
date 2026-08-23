package api

import (
	"net/http"
	"strings"

	"github.com/gorilla/websocket"
)

var wsUpgrader = websocket.Upgrader{
	CheckOrigin: func(*http.Request) bool { return true },
}

// handleWS 将 /api/ws/{traffic|logs|connections} 中继到 mihomo 对应 WebSocket
func (s *Server) handleWS(w http.ResponseWriter, r *http.Request) {
	if !s.sessions.Valid(r) {
		writeErr(w, http.StatusUnauthorized, "未登录")
		return
	}
	stream := r.PathValue("stream")
	var target string
	switch stream {
	case "traffic":
		target = "/traffic"
	case "logs":
		target = "/logs"
		if r.URL.RawQuery != "" {
			target += "?" + r.URL.RawQuery
		}
	case "connections":
		target = "/connections"
	default:
		writeErr(w, http.StatusNotFound, "未知流")
		return
	}

	clientConn, err := wsUpgrader.Upgrade(w, r, nil)
	if err != nil {
		return
	}
	defer clientConn.Close()

	header := http.Header{}
	header.Set("Authorization", "Bearer "+s.st.GetSetting("controller_secret", ""))
	// gorilla Dial 只接受 ws:// 或 wss://，客户端基址是 http:// 需转换
	wsURL := strings.Replace(s.client.BaseURL()+target, "https://", "wss://", 1)
	wsURL = strings.Replace(wsURL, "http://", "ws://", 1)
	remote, _, err := websocket.DefaultDialer.Dial(wsURL, header)
	if err != nil {
		_ = clientConn.WriteJSON(map[string]any{"type": "error", "payload": "内核不可达: " + err.Error()})
		return
	}
	defer remote.Close()

	// 客户端侧只用于感知断开
	go func() {
		for {
			if _, _, err := clientConn.ReadMessage(); err != nil {
				remote.Close()
				return
			}
		}
	}()
	for {
		mt, data, err := remote.ReadMessage()
		if err != nil {
			return
		}
		if err := clientConn.WriteMessage(mt, data); err != nil {
			return
		}
	}
}
