package api

import (
	"crypto/rand"
	"crypto/subtle"
	"encoding/base64"
	"net/http"
	"strings"

	"easyproxy/internal/service"
)

const clashSubscriptionTokenSetting = "clash_subscription_token"

func (s *Server) writeClashConfig(w http.ResponseWriter, attachment bool) {
	config, err := service.GenerateClashExport(s.st)
	if err != nil {
		writeErr(w, http.StatusInternalServerError, "生成 Clash 配置失败: "+err.Error())
		return
	}
	w.Header().Set("Content-Type", "application/x-yaml; charset=utf-8")
	w.Header().Set("Cache-Control", "no-store, no-cache, must-revalidate, private")
	if attachment {
		w.Header().Set("Content-Disposition", `attachment; filename="easyproxy-clash.yaml"`)
	}
	_, _ = w.Write([]byte(config.YAML))
}

func (s *Server) handleDownloadClashConfig(w http.ResponseWriter, r *http.Request) {
	s.writeClashConfig(w, true)
}

func (s *Server) handleGetClashConfigLink(w http.ResponseWriter, r *http.Request) {
	token, err := s.clashSubscriptionToken()
	if err != nil {
		writeErr(w, http.StatusInternalServerError, "创建配置订阅链接失败")
		return
	}
	writeJSON(w, http.StatusOK, map[string]string{
		"token": token,
		"path":  "/api/clash-config/subscription/" + token,
	})
}

func (s *Server) handleRotateClashConfigLink(w http.ResponseWriter, r *http.Request) {
	token, err := s.rotateClashSubscriptionToken()
	if err != nil {
		writeErr(w, http.StatusInternalServerError, "重新生成配置订阅链接失败")
		return
	}
	writeJSON(w, http.StatusOK, map[string]string{
		"token": token,
		"path":  "/api/clash-config/subscription/" + token,
	})
}

func (s *Server) handleClashConfigSubscription(w http.ResponseWriter, r *http.Request) {
	provided := strings.TrimSpace(r.PathValue("token"))
	expected := strings.TrimSpace(s.st.GetSetting(clashSubscriptionTokenSetting, ""))
	if provided == "" || expected == "" || subtle.ConstantTimeCompare([]byte(provided), []byte(expected)) != 1 {
		http.NotFound(w, r)
		return
	}
	s.writeClashConfig(w, false)
}

func (s *Server) clashSubscriptionToken() (string, error) {
	if token := strings.TrimSpace(s.st.GetSetting(clashSubscriptionTokenSetting, "")); token != "" {
		return token, nil
	}
	return s.rotateClashSubscriptionToken()
}

func (s *Server) rotateClashSubscriptionToken() (string, error) {
	bytes := make([]byte, 32)
	if _, err := rand.Read(bytes); err != nil {
		return "", err
	}
	token := base64.RawURLEncoding.EncodeToString(bytes)
	if err := s.st.SetSetting(clashSubscriptionTokenSetting, token); err != nil {
		return "", err
	}
	return token, nil
}
