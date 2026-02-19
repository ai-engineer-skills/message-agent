export function getWebAppHtml(personaName: string): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${escapeHtml(personaName)} - Web Chat</title>
<style>
  :root {
    --bg: #0f1117;
    --surface: #1a1d27;
    --surface2: #242734;
    --border: #2e3244;
    --text: #e1e4ed;
    --text-dim: #8b8fa3;
    --primary: #6c8cff;
    --primary-dim: #4a6ae0;
    --user-bubble: #2d3a5e;
    --assistant-bubble: #1e2233;
    --success: #4ade80;
    --warning: #fbbf24;
    --error: #f87171;
    --radius: 8px;
  }
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body {
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
    background: var(--bg);
    color: var(--text);
    height: 100vh;
    overflow: hidden;
  }
  .app { display: flex; height: 100vh; }

  /* Sidebar */
  .sidebar {
    width: 260px;
    background: var(--surface);
    border-right: 1px solid var(--border);
    display: flex;
    flex-direction: column;
  }
  .sidebar-header {
    padding: 16px;
    border-bottom: 1px solid var(--border);
    font-weight: 600;
    font-size: 14px;
  }
  .nav-tabs {
    display: flex;
    border-bottom: 1px solid var(--border);
  }
  .nav-tab {
    flex: 1;
    padding: 10px;
    text-align: center;
    cursor: pointer;
    font-size: 13px;
    color: var(--text-dim);
    border: none;
    background: none;
    transition: color 0.2s;
  }
  .nav-tab.active { color: var(--primary); border-bottom: 2px solid var(--primary); }
  .conv-list { flex: 1; overflow-y: auto; padding: 8px; }
  .conv-item {
    padding: 10px 12px;
    border-radius: var(--radius);
    cursor: pointer;
    font-size: 13px;
    color: var(--text-dim);
    margin-bottom: 2px;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .conv-item:hover { background: var(--surface2); }
  .conv-item.active { background: var(--surface2); color: var(--text); }
  .new-chat-btn {
    margin: 8px;
    padding: 10px;
    background: var(--primary);
    color: #fff;
    border: none;
    border-radius: var(--radius);
    cursor: pointer;
    font-size: 13px;
    font-weight: 500;
  }
  .new-chat-btn:hover { background: var(--primary-dim); }

  /* Main content */
  .main { flex: 1; display: flex; flex-direction: column; }

  /* Chat view */
  .chat-view { flex: 1; display: flex; flex-direction: column; }
  .messages {
    flex: 1;
    overflow-y: auto;
    padding: 20px;
    display: flex;
    flex-direction: column;
    gap: 12px;
  }
  .msg {
    max-width: 72%;
    padding: 10px 14px;
    border-radius: var(--radius);
    font-size: 14px;
    line-height: 1.5;
    word-wrap: break-word;
  }
  .msg.user {
    align-self: flex-end;
    background: var(--user-bubble);
  }
  .msg.assistant {
    align-self: flex-start;
    background: var(--assistant-bubble);
    border: 1px solid var(--border);
  }
  .msg code {
    background: rgba(255,255,255,0.08);
    padding: 1px 5px;
    border-radius: 3px;
    font-size: 13px;
  }
  .msg pre {
    background: rgba(0,0,0,0.3);
    padding: 10px;
    border-radius: 6px;
    overflow-x: auto;
    margin: 6px 0;
  }
  .msg pre code { background: none; padding: 0; }
  .typing-indicator {
    align-self: flex-start;
    padding: 10px 14px;
    color: var(--text-dim);
    font-size: 13px;
    display: none;
  }
  .typing-indicator.visible { display: block; }
  .typing-dots span {
    animation: blink 1.4s infinite both;
    font-size: 18px;
  }
  .typing-dots span:nth-child(2) { animation-delay: 0.2s; }
  .typing-dots span:nth-child(3) { animation-delay: 0.4s; }
  @keyframes blink { 0%, 80%, 100% { opacity: 0.2; } 40% { opacity: 1; } }

  .input-area {
    padding: 16px 20px;
    border-top: 1px solid var(--border);
    display: flex;
    gap: 10px;
  }
  .input-area input {
    flex: 1;
    padding: 10px 14px;
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: var(--radius);
    color: var(--text);
    font-size: 14px;
    outline: none;
  }
  .input-area input:focus { border-color: var(--primary); }
  .input-area button {
    padding: 10px 20px;
    background: var(--primary);
    color: #fff;
    border: none;
    border-radius: var(--radius);
    cursor: pointer;
    font-size: 14px;
  }
  .input-area button:hover { background: var(--primary-dim); }

  /* Dashboard view */
  .dashboard-view {
    flex: 1;
    overflow-y: auto;
    padding: 20px;
    display: none;
  }
  .dashboard-view.active { display: block; }
  .chat-view.hidden { display: none; }

  .dash-grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
    gap: 16px;
    margin-bottom: 24px;
  }
  .dash-card {
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: var(--radius);
    padding: 16px;
  }
  .dash-card h3 {
    font-size: 13px;
    color: var(--text-dim);
    text-transform: uppercase;
    letter-spacing: 0.5px;
    margin-bottom: 12px;
  }
  .dash-card .value {
    font-size: 24px;
    font-weight: 600;
  }
  .channel-row {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 6px 0;
    font-size: 13px;
  }
  .status-dot {
    width: 8px;
    height: 8px;
    border-radius: 50%;
    flex-shrink: 0;
  }
  .status-dot.connected { background: var(--success); }
  .status-dot.connecting { background: var(--warning); }
  .status-dot.disconnected, .status-dot.error { background: var(--error); }

  .journal-feed {
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: var(--radius);
    padding: 16px;
    max-height: 400px;
    overflow-y: auto;
  }
  .journal-feed h3 {
    font-size: 13px;
    color: var(--text-dim);
    text-transform: uppercase;
    letter-spacing: 0.5px;
    margin-bottom: 12px;
  }
  .journal-entry {
    padding: 6px 0;
    border-bottom: 1px solid var(--border);
    font-size: 12px;
    font-family: monospace;
    color: var(--text-dim);
  }
  .journal-entry:last-child { border-bottom: none; }
  .journal-entry .event-type { color: var(--primary); font-weight: 500; }
  .journal-entry .timestamp { color: var(--text-dim); }

  .empty-state {
    display: flex;
    align-items: center;
    justify-content: center;
    height: 100%;
    color: var(--text-dim);
    font-size: 15px;
  }
</style>
</head>
<body>
<div class="app">
  <div class="sidebar">
    <div class="sidebar-header">${escapeHtml(personaName)}</div>
    <div class="nav-tabs">
      <button class="nav-tab active" data-view="chat" onclick="switchView('chat')">Chat</button>
      <button class="nav-tab" data-view="dashboard" onclick="switchView('dashboard')">Dashboard</button>
    </div>
    <div class="conv-list" id="convList"></div>
    <button class="new-chat-btn" onclick="newChat()">+ New Chat</button>
  </div>
  <div class="main">
    <div class="chat-view" id="chatView">
      <div class="messages" id="messages">
        <div class="empty-state" id="emptyState">Start a conversation</div>
      </div>
      <div class="typing-indicator" id="typingIndicator">
        <div class="typing-dots"><span>.</span><span>.</span><span>.</span></div>
      </div>
      <div class="input-area">
        <input type="text" id="msgInput" placeholder="Type a message..." onkeydown="if(event.key==='Enter')sendMsg()">
        <button onclick="sendMsg()">Send</button>
      </div>
    </div>
    <div class="dashboard-view" id="dashboardView">
      <div class="dash-grid" id="dashGrid"></div>
      <div class="journal-feed" id="journalFeed">
        <h3>Activity Feed</h3>
        <div id="journalEntries"></div>
      </div>
    </div>
  </div>
</div>
<script>
(function() {
  let currentConvId = null;
  let conversations = new Map();
  let eventSource = null;
  let typingTimeout = null;
  let currentView = 'chat';

  const messagesEl = document.getElementById('messages');
  const emptyState = document.getElementById('emptyState');
  const convListEl = document.getElementById('convList');
  const typingEl = document.getElementById('typingIndicator');
  const msgInput = document.getElementById('msgInput');

  window.switchView = function(view) {
    currentView = view;
    document.querySelectorAll('.nav-tab').forEach(t => t.classList.toggle('active', t.dataset.view === view));
    document.getElementById('chatView').classList.toggle('hidden', view !== 'chat');
    document.getElementById('dashboardView').classList.toggle('active', view === 'dashboard');
    if (view === 'dashboard') refreshDashboard();
  };

  window.newChat = function() {
    switchView('chat');
    currentConvId = null;
    renderMessages();
    renderConvList();
    msgInput.focus();
  };

  window.sendMsg = async function() {
    const text = msgInput.value.trim();
    if (!text) return;
    msgInput.value = '';

    try {
      const res = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text, conversationId: currentConvId }),
      });
      const data = await res.json();

      if (!currentConvId || currentConvId !== data.conversationId) {
        currentConvId = data.conversationId;
        connectSSE(currentConvId);
      }

      if (!conversations.has(currentConvId)) {
        conversations.set(currentConvId, []);
      }
      conversations.get(currentConvId).push({ role: 'user', content: text });
      renderMessages();
      renderConvList();
    } catch (err) {
      console.error('Send failed:', err);
    }
  };

  function connectSSE(convId) {
    if (eventSource) eventSource.close();
    eventSource = new EventSource('/api/chat/stream?conversationId=' + encodeURIComponent(convId));

    eventSource.addEventListener('message', function(e) {
      const data = JSON.parse(e.data);
      if (!conversations.has(convId)) conversations.set(convId, []);
      conversations.get(convId).push({ role: 'assistant', content: data.text });
      hideTyping();
      if (convId === currentConvId) renderMessages();
    });

    eventSource.addEventListener('typing', function() {
      if (convId === currentConvId) showTyping();
    });

    eventSource.addEventListener('error', function() {
      // Auto-reconnect is built into EventSource
    });
  }

  function showTyping() {
    typingEl.classList.add('visible');
    messagesEl.scrollTop = messagesEl.scrollHeight;
    clearTimeout(typingTimeout);
    typingTimeout = setTimeout(hideTyping, 10000);
  }

  function hideTyping() {
    typingEl.classList.remove('visible');
    clearTimeout(typingTimeout);
  }

  function renderMessages() {
    const msgs = currentConvId ? (conversations.get(currentConvId) || []) : [];
    if (msgs.length === 0) {
      messagesEl.innerHTML = '';
      messagesEl.appendChild(emptyState);
      emptyState.style.display = 'flex';
      return;
    }
    emptyState.style.display = 'none';
    messagesEl.innerHTML = msgs.map(function(m) {
      return '<div class="msg ' + m.role + '">' + renderMarkdown(m.content) + '</div>';
    }).join('');
    messagesEl.scrollTop = messagesEl.scrollHeight;
  }

  function renderConvList() {
    let html = '';
    for (const [id] of conversations) {
      const msgs = conversations.get(id);
      const preview = msgs.length > 0 ? msgs[0].content.slice(0, 30) : 'New chat';
      const active = id === currentConvId ? ' active' : '';
      html += '<div class="conv-item' + active + '" onclick="selectConv(\\'' + id + '\\')">' + escapeHtml(preview) + '</div>';
    }
    convListEl.innerHTML = html;
  }

  window.selectConv = function(id) {
    currentConvId = id;
    connectSSE(id);
    renderMessages();
    renderConvList();
    switchView('chat');
  };

  // Simple markdown renderer
  function renderMarkdown(text) {
    let html = escapeHtml(text);
    // Code blocks
    html = html.replace(/\`\`\`([\\s\\S]*?)\`\`\`/g, '<pre><code>$1</code></pre>');
    // Inline code
    html = html.replace(/\`([^\`]+)\`/g, '<code>$1</code>');
    // Bold
    html = html.replace(/\\*\\*(.+?)\\*\\*/g, '<strong>$1</strong>');
    // Italic
    html = html.replace(/\\*(.+?)\\*/g, '<em>$1</em>');
    // Links
    html = html.replace(/\\[([^\\]]+)\\]\\(([^)]+)\\)/g, '<a href="$2" target="_blank" style="color:var(--primary)">$1</a>');
    // Line breaks
    html = html.replace(/\\n/g, '<br>');
    return html;
  }

  function escapeHtml(s) {
    return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  // Dashboard
  async function refreshDashboard() {
    try {
      const [statusRes, journalRes] = await Promise.all([
        fetch('/api/status'),
        fetch('/api/journal?limit=30'),
      ]);
      const status = await statusRes.json();
      const journal = await journalRes.json();

      let gridHtml = '';
      // Uptime card
      const h = Math.floor(status.uptime / 3600);
      const m = Math.floor((status.uptime % 3600) / 60);
      gridHtml += '<div class="dash-card"><h3>Uptime</h3><div class="value">' + h + 'h ' + m + 'm</div></div>';

      // Memory card
      gridHtml += '<div class="dash-card"><h3>Memory (Heap)</h3><div class="value">' + status.memory.heapUsed + ' MB</div></div>';

      // Active tasks card
      gridHtml += '<div class="dash-card"><h3>Active Tasks</h3><div class="value">' + status.activeTasks + '</div></div>';

      // Channels card
      let channelHtml = '<div class="dash-card"><h3>Channels</h3>';
      for (const ch of status.channels) {
        channelHtml += '<div class="channel-row"><span class="status-dot ' + ch.status + '"></span>' + escapeHtml(ch.id) + ' (' + ch.type + ') — ' + ch.status;
        if (ch.error) channelHtml += ' <span style="color:var(--error)">' + escapeHtml(ch.error) + '</span>';
        channelHtml += '</div>';
      }
      channelHtml += '</div>';
      gridHtml += channelHtml;

      document.getElementById('dashGrid').innerHTML = gridHtml;

      // Journal entries
      let jHtml = '';
      for (const entry of journal.entries) {
        const time = entry.ts ? entry.ts.slice(11, 19) : '';
        jHtml += '<div class="journal-entry"><span class="timestamp">' + time + '</span> <span class="event-type">' + (entry.event || '') + '</span> ' + (entry.channelId || '') + '/' + (entry.conversationId || '').slice(0, 8) + '</div>';
      }
      document.getElementById('journalEntries').innerHTML = jHtml || '<div style="color:var(--text-dim);font-size:13px">No activity yet</div>';
    } catch (err) {
      console.error('Dashboard refresh failed:', err);
    }
  }

  // Load existing conversations on start
  fetch('/api/conversations')
    .then(function(r) { return r.json(); })
    .then(function(data) {
      if (data.conversations) {
        data.conversations.forEach(function(id) { conversations.set(id, []); });
        renderConvList();
      }
    })
    .catch(function() {});

  // Auto-refresh dashboard every 10 seconds if visible
  setInterval(function() {
    if (currentView === 'dashboard') refreshDashboard();
  }, 10000);
})();
</script>
</body>
</html>`;
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
