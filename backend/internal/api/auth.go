package api

import (
	"crypto/rand"
	"fmt"
	"math/big"
	"net/http"
	"sync"
	"time"

	"golang.org/x/crypto/bcrypt"
)

const sessionCookie = "ezproxy_session"

type SessionManager struct {
	mu       sync.Mutex
	sessions map[string]time.Time
}

func NewSessionManager() *SessionManager {
	return &SessionManager{sessions: map[string]time.Time{}}
}

func (m *SessionManager) Create() string {
	b := make([]byte, 24)
	_, _ = rand.Read(b)
	token := fmt.Sprintf("%x", b)
	m.mu.Lock()
	m.sessions[token] = time.Now().Add(7 * 24 * time.Hour)
	m.mu.Unlock()
	return token
}

func (m *SessionManager) Valid(r *http.Request) bool {
	c, err := r.Cookie(sessionCookie)
	if err != nil || c.Value == "" {
		return false
	}
	m.mu.Lock()
	defer m.mu.Unlock()
	exp, ok := m.sessions[c.Value]
	if !ok {
		return false
	}
	if time.Now().After(exp) {
		delete(m.sessions, c.Value)
		return false
	}
	return true
}

func (m *SessionManager) Revoke(r *http.Request) {
	c, err := r.Cookie(sessionCookie)
	if err != nil {
		return
	}
	m.mu.Lock()
	delete(m.sessions, c.Value)
	m.mu.Unlock()
}

func randPassword(n int) string {
	const charset = "abcdefghjkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789"
	out := make([]byte, n)
	for i := range out {
		idx, _ := rand.Int(rand.Reader, big.NewInt(int64(len(charset))))
		out[i] = charset[idx.Int64()]
	}
	return string(out)
}

// InitPassword 首次启动生成随机密码并打印到控制台
func (s *Server) InitPassword() {
	if s.st.GetSetting("password_hash", "") != "" {
		return
	}
	pw := randPassword(12)
	hash, err := bcrypt.GenerateFromPassword([]byte(pw), bcrypt.DefaultCost)
	if err != nil {
		return
	}
	_ = s.st.SetSetting("password_hash", string(hash))
	_ = s.st.SetSetting("must_change_password", "1")
	fmt.Println()
	fmt.Println("==========================================================")
	fmt.Println("  首次启动：已生成初始管理员密码")
	fmt.Printf("  初始密码: %s\n", pw)
	fmt.Println("  请使用该密码登录面板，首次登录后将强制要求修改。")
	fmt.Println("  （此密码仅显示一次，可在 docker logs 中回看本次输出）")
	fmt.Println("==========================================================")
	fmt.Println()
}

func (s *Server) handleLogin(w http.ResponseWriter, r *http.Request) {
	var req struct {
		Password string `json:"password"`
	}
	if err := readJSON(r, &req); err != nil {
		writeErr(w, http.StatusBadRequest, "请求格式错误")
		return
	}
	hash := s.st.GetSetting("password_hash", "")
	if hash == "" {
		writeErr(w, http.StatusInternalServerError, "密码未初始化")
		return
	}
	if bcrypt.CompareHashAndPassword([]byte(hash), []byte(req.Password)) != nil {
		time.Sleep(500 * time.Millisecond)
		writeErr(w, http.StatusUnauthorized, "密码错误")
		return
	}
	token := s.sessions.Create()
	http.SetCookie(w, &http.Cookie{
		Name:     sessionCookie,
		Value:    token,
		Path:     "/",
		HttpOnly: true,
		SameSite: http.SameSiteLaxMode,
		MaxAge:   7 * 24 * 3600,
	})
	writeJSON(w, http.StatusOK, map[string]any{
		"ok":                   true,
		"must_change_password": s.st.GetSettingBool("must_change_password", false),
	})
}

func (s *Server) handleLogout(w http.ResponseWriter, r *http.Request) {
	s.sessions.Revoke(r)
	http.SetCookie(w, &http.Cookie{Name: sessionCookie, Value: "", Path: "/", MaxAge: -1})
	writeJSON(w, http.StatusOK, map[string]any{"ok": true})
}

func (s *Server) handleMe(w http.ResponseWriter, r *http.Request) {
	writeJSON(w, http.StatusOK, map[string]any{
		"authenticated":        true,
		"must_change_password": s.st.GetSettingBool("must_change_password", false),
	})
}

func (s *Server) handleChangePassword(w http.ResponseWriter, r *http.Request) {
	var req struct {
		OldPassword string `json:"old_password"`
		NewPassword string `json:"new_password"`
	}
	if err := readJSON(r, &req); err != nil {
		writeErr(w, http.StatusBadRequest, "请求格式错误")
		return
	}
	hash := s.st.GetSetting("password_hash", "")
	if bcrypt.CompareHashAndPassword([]byte(hash), []byte(req.OldPassword)) != nil {
		writeErr(w, http.StatusBadRequest, "旧密码错误")
		return
	}
	if len(req.NewPassword) < 8 {
		writeErr(w, http.StatusBadRequest, "新密码至少 8 位")
		return
	}
	newHash, err := bcrypt.GenerateFromPassword([]byte(req.NewPassword), bcrypt.DefaultCost)
	if err != nil {
		writeErr(w, http.StatusInternalServerError, "密码加密失败")
		return
	}
	_ = s.st.SetSetting("password_hash", string(newHash))
	_ = s.st.SetSetting("must_change_password", "0")
	writeJSON(w, http.StatusOK, map[string]any{"ok": true})
}
