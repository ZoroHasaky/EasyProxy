package core

import (
	"context"
	"net/http"
	"strings"
	"time"

	"github.com/gorilla/websocket"
)

// ConnectionMetadata 仅包含生成访问匹配记录所需的目标端信息。
type ConnectionMetadata struct {
	Network         string `json:"network"`
	Type            string `json:"type"`
	DestinationPort string `json:"destinationPort"`
	Host            string `json:"host"`
	DestinationIP   string `json:"destinationIP"`
}

type Connection struct {
	ID          string             `json:"id"`
	Start       string             `json:"start"`
	Chains      []string           `json:"chains"`
	Rule        string             `json:"rule"`
	RulePayload string             `json:"rulePayload"`
	Metadata    ConnectionMetadata `json:"metadata"`
}

type ConnectionsSnapshot struct {
	Connections []Connection `json:"connections"`
}

func (c *Client) connectionStreamURL() string {
	url := strings.Replace(c.base+"/connections", "https://", "wss://", 1)
	return strings.Replace(url, "http://", "ws://", 1)
}

// WatchConnections 订阅 Mihomo 的连接快照流。连接中断会自动退避重连，直到 ctx 取消。
func (c *Client) WatchConnections(ctx context.Context, onSnapshot func(ConnectionsSnapshot)) {
	delay := time.Second
	for ctx.Err() == nil {
		header := http.Header{"Authorization": []string{"Bearer " + c.secret}}
		conn, _, err := websocket.DefaultDialer.DialContext(ctx, c.connectionStreamURL(), header)
		if err == nil {
			delay = time.Second
			closed := make(chan struct{})
			go func() {
				select {
				case <-ctx.Done():
					_ = conn.Close()
				case <-closed:
				}
			}()
			for ctx.Err() == nil {
				var snapshot ConnectionsSnapshot
				if err = conn.ReadJSON(&snapshot); err != nil {
					break
				}
				onSnapshot(snapshot)
			}
			close(closed)
			_ = conn.Close()
		}
		if ctx.Err() != nil {
			return
		}
		timer := time.NewTimer(delay)
		select {
		case <-ctx.Done():
			timer.Stop()
			return
		case <-timer.C:
		}
		if delay < 15*time.Second {
			delay *= 2
		}
	}
}
