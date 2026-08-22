package core

import (
	"bufio"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"sync"
	"time"
)

const (
	StateStopped  = "stopped"
	StateRunning  = "running"
	StateFailed   = "failed"
	StateStopping = "stopping"
)

// Manager mihomo 子进程生命周期管理（崩溃自动退避拉起）
type Manager struct {
	mu        sync.Mutex
	binPath   string
	dataDir   string
	cmd       *exec.Cmd
	state     string
	lastErr   string
	restarts  int
	startedAt time.Time
	stableAt  time.Time
	stopping  bool

	logMu   sync.Mutex
	logBuf  []string
	logSubs map[chan string]struct{}
}

func NewManager(binPath, dataDir string) *Manager {
	return &Manager{
		binPath:  binPath,
		dataDir:  dataDir,
		state:    StateStopped,
		logSubs:  map[chan string]struct{}{},
		stopping: false,
	}
}

type Status struct {
	State     string    `json:"state"`
	PID       int       `json:"pid"`
	Restarts  int       `json:"restarts"`
	StartedAt time.Time `json:"started_at"`
	LastError string    `json:"last_error"`
}

func (m *Manager) Status() Status {
	m.mu.Lock()
	defer m.mu.Unlock()
	st := Status{State: m.state, Restarts: m.restarts, StartedAt: m.startedAt, LastError: m.lastErr}
	if m.cmd != nil && m.cmd.Process != nil {
		st.PID = m.cmd.Process.Pid
	}
	return st
}

func (m *Manager) writeLog(line string) {
	m.logMu.Lock()
	defer m.logMu.Unlock()
	m.logBuf = append(m.logBuf, line)
	if len(m.logBuf) > 300 {
		m.logBuf = m.logBuf[len(m.logBuf)-300:]
	}
	for ch := range m.logSubs {
		select {
		case ch <- line:
		default:
		}
	}
}

// RecentLogs 内核进程 stdout/stderr 的最近输出
func (m *Manager) RecentLogs() []string {
	m.logMu.Lock()
	defer m.logMu.Unlock()
	out := make([]string, len(m.logBuf))
	copy(out, m.logBuf)
	return out
}

// Start 启动内核（若已在运行则跳过）
func (m *Manager) Start() error {
	m.mu.Lock()
	defer m.mu.Unlock()
	if m.state == StateRunning || m.state == StateStopping {
		return nil
	}
	if _, err := os.Stat(m.binPath); err != nil {
		m.state = StateFailed
		m.lastErr = "内核二进制不存在: " + m.binPath
		return fmt.Errorf("%s", m.lastErr)
	}
	if err := os.MkdirAll(filepath.Join(m.dataDir, "ruleset"), 0o755); err != nil {
		m.state = StateFailed
		m.lastErr = err.Error()
		return err
	}

	cmd := exec.Command(m.binPath, "-d", m.dataDir, "-f", filepath.Join(m.dataDir, "config.yaml"))
	cmd.Dir = m.dataDir
	stdout, _ := cmd.StdoutPipe()
	stderr, _ := cmd.StderrPipe()
	if err := cmd.Start(); err != nil {
		m.state = StateFailed
		m.lastErr = err.Error()
		return err
	}
	m.cmd = cmd
	m.state = StateRunning
	m.lastErr = ""
	m.startedAt = time.Now()
	go m.pump(stdout)
	go m.pump(stderr)

	go func() {
		err := cmd.Wait()
		m.mu.Lock()
		crashed := m.state == StateRunning
		wasStopping := m.stopping
		m.cmd = nil
		m.state = StateStopped
		if crashed && err != nil && !wasStopping {
			m.lastErr = err.Error()
		}
		m.mu.Unlock()
		if crashed && !wasStopping && !m.stopping {
			go m.autoRestart()
		}
	}()
	return nil
}

func (m *Manager) pump(r interface{ Read([]byte) (int, error) }) {
	sc := bufio.NewScanner(bufio.NewReaderSize(r, 64*1024))
	sc.Buffer(make([]byte, 64*1024), 1024*1024)
	for sc.Scan() {
		m.writeLog(sc.Text())
	}
}

// autoRestart 崩溃退避重启：2s 起 ×2，上限 30s；稳定运行 60s 后重置
func (m *Manager) autoRestart() {
	delay := 2 * time.Second
	for {
		m.mu.Lock()
		if m.state != StateStopped || m.stopping {
			m.mu.Unlock()
			return
		}
		if !m.startedAt.IsZero() && time.Since(m.startedAt) > 60*time.Second {
			delay = 2 * time.Second
			m.restarts = 0
		}
		m.restarts++
		n := m.restarts
		m.mu.Unlock()

		wait := delay
		delay *= 2
		if delay > 30*time.Second {
			delay = 30 * time.Second
		}
		m.writeLog(fmt.Sprintf("[easyproxy] 内核异常退出，%.0f 秒后第 %d 次重启", wait.Seconds(), n))
		time.Sleep(wait)

		if err := m.Start(); err != nil {
			m.writeLog("[easyproxy] 内核重启失败: " + err.Error())
			continue
		}
		return
	}
}

// Stop 停止内核（主动停止不触发自动重启）
func (m *Manager) Stop() error {
	m.mu.Lock()
	m.stopping = true
	cmd := m.cmd
	m.state = StateStopping
	m.mu.Unlock()
	defer func() {
		m.mu.Lock()
		m.stopping = false
		if m.state == StateStopping {
			m.state = StateStopped
		}
		m.mu.Unlock()
	}()
	if cmd == nil || cmd.Process == nil {
		return nil
	}
	return cmd.Process.Kill()
}

// Restart 主动重启（先 Stop 再 Start）
func (m *Manager) Restart() error {
	if err := m.Stop(); err != nil {
		return err
	}
	// 等待 Wait goroutine 回收
	deadline := time.Now().Add(10 * time.Second)
	for time.Now().Before(deadline) {
		m.mu.Lock()
		idle := m.cmd == nil && m.state == StateStopped
		m.mu.Unlock()
		if idle {
			break
		}
		time.Sleep(100 * time.Millisecond)
	}
	m.mu.Lock()
	m.stopping = false
	m.mu.Unlock()
	return m.Start()
}
