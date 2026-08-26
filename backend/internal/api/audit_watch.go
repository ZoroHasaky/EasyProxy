package api

import (
	"context"
	"fmt"
	"strings"
	"time"

	"easyproxy/internal/core"
)

func (s *Server) startAuditWatchers(ctx context.Context) {
	go s.watchConnectionTraces(ctx)
	go s.watchCoreOutput(ctx)
	go s.pruneAuditLogs(ctx)
}

func (s *Server) watchConnectionTraces(ctx context.Context) {
	s.client.WatchConnections(ctx, func(snapshot core.ConnectionsSnapshot) {
		for _, connection := range snapshot.Connections {
			s.recordConnectionTrace(connection)
		}
	})
}

func (s *Server) recordConnectionTrace(connection core.Connection) {
	if connection.ID == "" {
		return
	}
	target := strings.TrimSpace(connection.Metadata.Host)
	if target == "" {
		target = strings.TrimSpace(connection.Metadata.DestinationIP)
	}
	if target == "" {
		return
	}
	chains := make([]string, 0, len(connection.Chains))
	for _, chain := range connection.Chains {
		if chain = strings.TrimSpace(chain); chain != "" {
			chains = append(chains, chain)
		}
	}
	summary := fmt.Sprintf("访问 %s", target)
	if port := strings.TrimSpace(connection.Metadata.DestinationPort); port != "" {
		summary += ":" + port
	}
	if len(chains) > 0 {
		summary += " → " + chains[len(chains)-1]
	}
	s.auditOnce("traffic", "traffic.match", "info", summary, "connection:"+connection.ID, map[string]any{
		"target":       target,
		"port":         connection.Metadata.DestinationPort,
		"network":      connection.Metadata.Network,
		"type":         connection.Metadata.Type,
		"rule":         connection.Rule,
		"rule_payload": connection.RulePayload,
		"chains":       chains,
	})
}

func (s *Server) watchCoreOutput(ctx context.Context) {
	lines, cancel := s.mgr.SubscribeLogs()
	defer cancel()
	for {
		select {
		case <-ctx.Done():
			return
		case line, ok := <-lines:
			if !ok {
				return
			}
			// 原始输出也进入持久化内核日志，日志页不再维护一套仅浏览器可见的输出框。
			s.recordCoreOutput(line)
		}
	}
}

func (s *Server) pruneAuditLogs(ctx context.Context) {
	ticker := time.NewTicker(24 * time.Hour)
	defer ticker.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
			_ = s.st.PruneAuditLogs(time.Now().Add(-30 * 24 * time.Hour))
		}
	}
}
