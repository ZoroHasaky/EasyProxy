package api

import (
	"fmt"
	"net/http"
	"strconv"
	"strings"

	"easyproxy/internal/model"
	"easyproxy/internal/store"
)

type proxyPortPayload struct {
	Name          string `json:"name"`
	Port          int    `json:"port"`
	Enabled       *bool  `json:"enabled"`
	DefaultTarget string `json:"default_target"`
}

type proxyPortRulesPayload struct {
	Rules []model.ProxyPortRule `json:"rules"`
}

func proxyPortID(r *http.Request) (int64, error) {
	raw := r.PathValue("id")
	// Handler unit tests and a few internal callers invoke the handler directly
	// instead of going through ServeMux, so PathValue may be empty there.
	if raw == "" {
		parts := strings.Split(strings.Trim(r.URL.Path, "/"), "/")
		for i, part := range parts {
			if part == "proxy-ports" && i+1 < len(parts) {
				raw = parts[i+1]
				break
			}
		}
	}
	id, err := strconv.ParseInt(raw, 10, 64)
	if err != nil || id <= 0 {
		return 0, fmt.Errorf("端口 ID 无效")
	}
	return id, nil
}

func (s *Server) handleGetProxyPorts(w http.ResponseWriter, r *http.Request) {
	ports, err := s.st.ListProxyPorts()
	if err != nil {
		writeErr(w, http.StatusInternalServerError, "读取代理端口失败: "+err.Error())
		return
	}
	if ports == nil {
		ports = []model.ProxyPort{}
	}
	writeJSON(w, http.StatusOK, map[string]any{"items": ports})
}

func (s *Server) handleCreateProxyPort(w http.ResponseWriter, r *http.Request) {
	var p proxyPortPayload
	if err := readJSON(r, &p); err != nil {
		writeErr(w, http.StatusBadRequest, "请求格式错误")
		return
	}
	enabled := true
	if p.Enabled != nil {
		enabled = *p.Enabled
	}
	port := &model.ProxyPort{
		Name: p.Name, Port: p.Port, Enabled: enabled, DefaultTarget: strings.TrimSpace(p.DefaultTarget),
	}
	if err := s.st.CreateProxyPort(port); err != nil {
		writeErr(w, http.StatusBadRequest, err.Error())
		return
	}
	writeProxyPortChange(w, s, map[string]any{"ok": true, "item": port}, "代理端口已创建")
}

func (s *Server) handleUpdateProxyPort(w http.ResponseWriter, r *http.Request) {
	id, err := proxyPortID(r)
	if err != nil {
		writeErr(w, http.StatusBadRequest, err.Error())
		return
	}
	var p proxyPortPayload
	if err := readJSON(r, &p); err != nil {
		writeErr(w, http.StatusBadRequest, "请求格式错误")
		return
	}
	current, err := s.st.GetProxyPort(id)
	if err != nil {
		writeErr(w, http.StatusNotFound, "代理端口不存在")
		return
	}
	if p.Enabled == nil {
		p.Enabled = &current.Enabled
	}
	defaultTarget := strings.TrimSpace(p.DefaultTarget)
	if defaultTarget == "" {
		defaultTarget = current.DefaultTarget
	}
	port := &model.ProxyPort{
		ID: id, Name: p.Name, Port: p.Port, Enabled: *p.Enabled,
		IsDefault: current.IsDefault, DefaultTarget: defaultTarget, Position: current.Position,
	}
	if err := s.st.UpdateProxyPort(port); err != nil {
		writeErr(w, http.StatusBadRequest, err.Error())
		return
	}
	updated, err := s.st.GetProxyPort(id)
	if err != nil {
		writeErr(w, http.StatusInternalServerError, "读取已保存的代理端口失败")
		return
	}
	writeProxyPortChange(w, s, map[string]any{"ok": true, "item": updated}, "代理端口已更新")
}

func (s *Server) handleDeleteProxyPort(w http.ResponseWriter, r *http.Request) {
	id, err := proxyPortID(r)
	if err != nil {
		writeErr(w, http.StatusBadRequest, err.Error())
		return
	}
	if err := s.st.DeleteProxyPort(id); err != nil {
		writeErr(w, http.StatusBadRequest, err.Error())
		return
	}
	writeProxyPortChange(w, s, map[string]any{"ok": true}, "代理端口已删除")
}

func (s *Server) handleGetProxyPortRules(w http.ResponseWriter, r *http.Request) {
	id, err := proxyPortID(r)
	if err != nil {
		writeErr(w, http.StatusBadRequest, err.Error())
		return
	}
	port, err := s.st.GetProxyPort(id)
	if err != nil {
		writeErr(w, http.StatusNotFound, "代理端口不存在")
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"items": port.Rules})
}

func (s *Server) handlePutProxyPortRules(w http.ResponseWriter, r *http.Request) {
	id, err := proxyPortID(r)
	if err != nil {
		writeErr(w, http.StatusBadRequest, err.Error())
		return
	}
	var p proxyPortRulesPayload
	if err := readJSON(r, &p); err != nil {
		writeErr(w, http.StatusBadRequest, "请求格式错误")
		return
	}
	if p.Rules == nil {
		p.Rules = []model.ProxyPortRule{}
	}
	if err := s.st.ReplaceProxyPortRules(id, p.Rules); err != nil {
		writeErr(w, http.StatusBadRequest, err.Error())
		return
	}
	port, err := s.st.GetProxyPort(id)
	if err != nil {
		writeErr(w, http.StatusInternalServerError, "读取端口规则失败")
		return
	}
	writeProxyPortChange(w, s, map[string]any{"ok": true, "items": port.Rules}, "端口分流规则已更新")
}

func writeProxyPortChange(w http.ResponseWriter, s *Server, payload map[string]any, message string) {
	if _, err := s.st.TouchProxyPortsRevision(); err != nil {
		writeErr(w, http.StatusInternalServerError, "记录代理端口变更失败: "+err.Error())
		return
	}
	result, applyError := s.applyChangedConfig(store.ConfigScopeKernelNetwork, []string{"proxy_ports"})
	payload["message"] = message
	payload["apply_result"] = result
	payload["apply_error"] = applyError
	writeJSON(w, http.StatusOK, payload)
}
