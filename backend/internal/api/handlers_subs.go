package api

import (
	"fmt"
	"net/http"
	"strconv"

	"easyproxy/internal/core"
	"easyproxy/internal/model"
	"easyproxy/internal/parser"
	"easyproxy/internal/service"
)

// ---------- 订阅 ----------

func (s *Server) handleListSubs(w http.ResponseWriter, r *http.Request) {
	subs, err := s.st.ListSubscriptions()
	if err != nil {
		writeErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, subs)
}

func (s *Server) handleCreateSub(w http.ResponseWriter, r *http.Request) {
	var sub model.Subscription
	if err := readJSON(r, &sub); err != nil {
		writeErr(w, http.StatusBadRequest, "请求格式错误")
		return
	}
	if sub.Name == "" || sub.URL == "" {
		writeErr(w, http.StatusBadRequest, "名称和 URL 必填")
		return
	}
	sub.Enabled = true
	// 先抓取验证再落库；内核运行中提供代理地址，抓取失败自动换路径重试
	proxy := ""
	if s.mgr.Status().State == core.StateRunning {
		proxy = fmt.Sprintf("127.0.0.1:%d", s.st.GetSettingInt("mixed_port", 7890))
	}
	added, removed, err := func() (int, int, error) {
		if err := s.st.CreateSubscription(&sub); err != nil {
			return 0, 0, err
		}
		a, rm, err := service.SyncSubscription(s.st, &sub, proxy)
		if err != nil {
			_ = s.st.DeleteSubscription(sub.ID)
			return 0, 0, err
		}
		return a, rm, nil
	}()
	if err != nil {
		writeErr(w, http.StatusBadRequest, "订阅抓取失败: "+err.Error())
		return
	}
	s.dirty.Store(true)
	fresh, _ := s.st.GetSubscription(sub.ID)
	writeJSON(w, http.StatusOK, map[string]any{"subscription": fresh, "added": added, "removed": removed})
}

func (s *Server) handleUpdateSub(w http.ResponseWriter, r *http.Request) {
	id, _ := strconv.ParseInt(r.PathValue("id"), 10, 64)
	sub, err := s.st.GetSubscription(id)
	if err != nil {
		writeErr(w, http.StatusNotFound, "订阅不存在")
		return
	}
	var req model.Subscription
	if err := readJSON(r, &req); err != nil {
		writeErr(w, http.StatusBadRequest, "请求格式错误")
		return
	}
	sub.Name = req.Name
	sub.URL = req.URL
	sub.UserAgent = req.UserAgent
	sub.UpdateInterval, sub.ViaProxy, sub.Enabled = req.UpdateInterval, req.ViaProxy, req.Enabled
	if err := s.st.UpdateSubscription(sub); err != nil {
		writeErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	s.dirty.Store(true)
	writeJSON(w, http.StatusOK, sub)
}

func (s *Server) handleDeleteSub(w http.ResponseWriter, r *http.Request) {
	id, _ := strconv.ParseInt(r.PathValue("id"), 10, 64)
	if err := s.st.DeleteSubscription(id); err != nil {
		writeErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	s.dirty.Store(true)
	writeJSON(w, http.StatusOK, map[string]any{"ok": true})
}

func (s *Server) handleUpdateSubNow(w http.ResponseWriter, r *http.Request) {
	id, _ := strconv.ParseInt(r.PathValue("id"), 10, 64)
	sub, err := s.st.GetSubscription(id)
	if err != nil {
		writeErr(w, http.StatusNotFound, "订阅不存在")
		return
	}
	proxy := ""
	if s.mgr.Status().State == core.StateRunning {
		proxy = fmt.Sprintf("127.0.0.1:%d", s.st.GetSettingInt("mixed_port", 7890))
	}
	added, removed, err := service.SyncSubscription(s.st, sub, proxy)
	if err != nil {
		writeErr(w, http.StatusBadGateway, "更新失败: "+err.Error())
		return
	}
	s.dirty.Store(true)
	fresh, _ := s.st.GetSubscription(sub.ID)
	writeJSON(w, http.StatusOK, map[string]any{"subscription": fresh, "added": added, "removed": removed})
}

// ---------- 节点 ----------

func (s *Server) handleListNodes(w http.ResponseWriter, r *http.Request) {
	q := r.URL.Query()
	f := model.NodeFilter{
		Region:   q.Get("region"),
		Source:   q.Get("source"),
		Q:        q.Get("q"),
		Enabled:  q.Get("enabled"),
		SourceID: 0,
	}
	nodes, err := s.st.ListNodes(f)
	if err != nil {
		writeErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, nodes)
}

func (s *Server) handleNodeRegions(w http.ResponseWriter, r *http.Request) {
	nodes, err := s.st.ListNodes(model.NodeFilter{})
	if err != nil {
		writeErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	counts := map[string]int{}
	for _, n := range nodes {
		counts[n.Region]++
	}
	out := []map[string]any{}
	for code, cnt := range counts {
		out = append(out, map[string]any{
			"code": code, "flag": parser.RegionFlag(code), "cn": parser.RegionCN(code), "count": cnt,
		})
	}
	writeJSON(w, http.StatusOK, out)
}

func (s *Server) handleImportNodes(w http.ResponseWriter, r *http.Request) {
	var req struct {
		Content string `json:"content"`
	}
	if err := readJSON(r, &req); err != nil || req.Content == "" {
		writeErr(w, http.StatusBadRequest, "请粘贴节点内容")
		return
	}
	added, dup, err := service.ImportNodes(s.st, req.Content)
	if err != nil {
		writeErr(w, http.StatusBadRequest, err.Error())
		return
	}
	s.dirty.Store(true)
	writeJSON(w, http.StatusOK, map[string]any{"added": added, "duplicated": dup})
}

func (s *Server) handlePatchNode(w http.ResponseWriter, r *http.Request) {
	id, _ := strconv.ParseInt(r.PathValue("id"), 10, 64)
	node, err := s.st.GetNode(id)
	if err != nil {
		writeErr(w, http.StatusNotFound, "节点不存在")
		return
	}
	var req struct {
		Name    *string `json:"name"`
		Region  *string `json:"region"`
		Enabled *bool   `json:"enabled"`
	}
	if err := readJSON(r, &req); err != nil {
		writeErr(w, http.StatusBadRequest, "请求格式错误")
		return
	}
	if req.Name != nil && *req.Name != "" && *req.Name != node.Name {
		if exists, _ := s.st.NodeNameExists(*req.Name, node.ID); exists {
			writeErr(w, http.StatusBadRequest, "节点名已存在")
			return
		}
		node.Name = *req.Name
		node.RawConfig["name"] = node.Name
		if node.Region == "" || node.Region == "OTHER" {
			node.Region = parser.ParseRegion(node.Name)
		}
	}
	if req.Region != nil {
		node.Region = *req.Region
	}
	if req.Enabled != nil {
		node.Enabled = *req.Enabled
	}
	if err := s.st.UpdateNode(node); err != nil {
		writeErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	s.dirty.Store(true)
	writeJSON(w, http.StatusOK, node)
}

func (s *Server) handleDeleteNode(w http.ResponseWriter, r *http.Request) {
	id, _ := strconv.ParseInt(r.PathValue("id"), 10, 64)
	if err := s.st.DeleteNode(id); err != nil {
		writeErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	s.dirty.Store(true)
	writeJSON(w, http.StatusOK, map[string]any{"ok": true})
}

func (s *Server) handleCheckNodes(w http.ResponseWriter, r *http.Request) {
	if s.dirty.Load() {
		if _, err := s.applyConfig(); err != nil {
			writeErr(w, http.StatusBadGateway, "应用配置失败: "+err.Error())
			return
		}
		s.dirty.Store(false)
	}
	n, err := service.CheckLatencies(s.st, s.client)
	if err != nil {
		writeErr(w, http.StatusBadGateway, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"tested": n})
}
