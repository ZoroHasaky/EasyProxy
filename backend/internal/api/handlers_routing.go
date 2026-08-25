package api

import (
	"net/http"

	"easyproxy/internal/model"
)

func (s *Server) handleGetRecognitionRules(w http.ResponseWriter, r *http.Request) {
	rules, err := s.st.ListRecognitionRules()
	if err != nil {
		writeErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, rules)
}

func (s *Server) handlePutRecognitionRules(w http.ResponseWriter, r *http.Request) {
	var rules []model.RecognitionRule
	if err := readJSON(r, &rules); err != nil {
		writeErr(w, http.StatusBadRequest, "请求格式错误")
		return
	}
	if err := s.st.ReplaceRecognitionRules(rules); err != nil {
		writeErr(w, http.StatusBadRequest, err.Error())
		return
	}
	result, applyError := s.applyChangedConfig("recognition_rules", []string{"识别规则"})
	writeJSON(w, http.StatusOK, map[string]any{"ok": true, "count": len(rules), "apply_result": result, "apply_error": applyError})
}

func (s *Server) handleGetOutboundRules(w http.ResponseWriter, r *http.Request) {
	rules, err := s.st.ListOutboundRules()
	if err != nil {
		writeErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, rules)
}

func (s *Server) handlePutOutboundRules(w http.ResponseWriter, r *http.Request) {
	var rules []model.OutboundRule
	if err := readJSON(r, &rules); err != nil {
		writeErr(w, http.StatusBadRequest, "请求格式错误")
		return
	}
	if err := s.st.ReplaceOutboundRules(rules); err != nil {
		writeErr(w, http.StatusBadRequest, err.Error())
		return
	}
	result, applyError := s.applyChangedConfig("outbound_rules", []string{"出站映射"})
	writeJSON(w, http.StatusOK, map[string]any{"ok": true, "count": len(rules), "apply_result": result, "apply_error": applyError})
}
