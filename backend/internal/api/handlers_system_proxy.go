package api

import (
	"net/http"
	"time"

	"easyproxy/internal/service"
)

func (s *Server) handleDesktopSystemProxyStatus(w http.ResponseWriter, r *http.Request) {
	if !s.validDesktopToken(r) {
		writeErr(w, http.StatusUnauthorized, "桌面控制令牌无效")
		return
	}
	s.handleSystemProxyStatus(w, r)
}

func (s *Server) handleDesktopSystemProxyUpdate(w http.ResponseWriter, r *http.Request) {
	if !s.validDesktopToken(r) {
		writeErr(w, http.StatusUnauthorized, "桌面控制令牌无效")
		return
	}
	s.handleSystemProxyUpdate(w, r)
}

func (s *Server) validDesktopToken(r *http.Request) bool {
	return s.desktopMode && s.controlToken != "" && r.Header.Get("X-EasyProxy-Desktop-Token") == s.controlToken
}

func (s *Server) handleDesktopShutdown(w http.ResponseWriter, r *http.Request) {
	if !s.validDesktopToken(r) {
		writeErr(w, http.StatusUnauthorized, "桌面控制令牌无效")
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"ok": true})
	go func() {
		time.Sleep(25 * time.Millisecond)
		s.requestShutdown()
	}()
}

func (s *Server) handleSystemProxyStatus(w http.ResponseWriter, _ *http.Request) {
	status := s.systemProxy.Status()
	if !status.Supported {
		writeJSON(w, http.StatusOK, status)
		return
	}
	if status.Port == 0 {
		status.Port = s.defaultProxyPort()
	}
	writeJSON(w, http.StatusOK, status)
}

func (s *Server) handleSystemProxyUpdate(w http.ResponseWriter, r *http.Request) {
	var req struct {
		Enabled bool `json:"enabled"`
	}
	if err := readJSON(r, &req); err != nil {
		writeErr(w, http.StatusBadRequest, "请求格式错误")
		return
	}
	var err error
	if req.Enabled {
		err = s.systemProxy.Enable(s.defaultProxyPort())
	} else {
		err = s.systemProxy.Disable()
	}
	if err != nil {
		if err == service.ErrSystemProxyUnsupported {
			writeErr(w, http.StatusNotImplemented, err.Error())
			return
		}
		writeErr(w, http.StatusBadRequest, err.Error())
		return
	}
	s.audit("operation", "system_proxy.update", "success", "系统代理设置已更新", map[string]any{"enabled": req.Enabled})
	s.handleSystemProxyStatus(w, r)
}

func (s *Server) defaultProxyPort() int {
	ports, err := s.st.ListProxyPorts()
	if err == nil {
		for _, port := range ports {
			if port.IsDefault {
				return port.Port
			}
		}
	}
	port := s.st.GetSettingInt("mixed_port", 7890)
	if port < 1 || port > 65535 {
		return 7890
	}
	return port
}
