import React, { useState } from 'react';

export function TicketsDesk({
  ticket,
  onUpdateStatus,
  onDeleteTicket,
  onClearAllTickets,
  onOpenChat,
  apiToken
}) {
  const [copiedLog, setCopiedLog] = useState(false);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [sites, setSites] = useState([]);
  const [newTicket, setNewTicket] = useState({
    site_id: 1,
    subject: '',
    channel_type: 'software',
    priority: 'high',
    error_log: '',
    ai_summary: { summary: '', reason: '' }
  });

  const handleCopyLog = (text) => {
    if (!text) return;
    navigator.clipboard.writeText(text);
    setCopiedLog(true);
    setTimeout(() => setCopiedLog(false), 2000);
  };

  const fetchSites = async () => {
    try {
      const res = await fetch('/api/sites', {
        headers: { Authorization: `Bearer ${apiToken}` }
      });
      if (res.ok) {
        setSites(await res.json());
      }
    } catch (e) {
      console.error('Failed to fetch sites', e);
    }
  };

  const handleOpenCreateModal = () => {
    fetchSites();
    setShowCreateModal(true);
  };

  const handleCreateSubmit = async (e) => {
    e.preventDefault();
    if (!newTicket.subject.trim()) return;
    try {
      const res = await fetch('/api/tickets', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${apiToken}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          site_id: newTicket.site_id,
          subject: newTicket.subject,
          channel_type: newTicket.channel_type,
          priority: newTicket.priority,
          error_log: newTicket.error_log,
          ai_summary: {
            summary: newTicket.subject,
            reason: newTicket.error_log ? 'Manual crash submission' : 'Manual ticket creation'
          }
        })
      });
      if (res.ok) {
        setShowCreateModal(false);
        setNewTicket({
          site_id: sites[0]?.id || 1,
          subject: '',
          channel_type: 'software',
          priority: 'high',
          error_log: '',
          ai_summary: { summary: '', reason: '' }
        });
        if (typeof window !== 'undefined') {
          window.dispatchEvent(new CustomEvent('new_ticket_event'));
        }
      }
    } catch (err) {
      console.error('Failed to create ticket', err);
    }
  };

  if (!ticket) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center p-8 bg-gray-50 text-center h-full select-none">
        <div className="w-16 h-16 rounded-2xl bg-purple-100 border border-purple-200 text-purple-600 flex items-center justify-center text-3xl mb-4 shadow-sm">
          🎫
        </div>
        <h2 className="text-xl font-bold text-gray-800 mb-1.5">Select a Ticket to View Details</h2>
        <p className="text-sm text-gray-500 max-w-md mb-6 leading-relaxed">
          Tickets and bug reports appear in the left <strong>Chats / Tickets</strong> section with priority and site origin. Click any ticket to inspect error logs, AI diagnostics, and take action.
        </p>
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={handleOpenCreateModal}
            className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-xl text-xs font-semibold shadow-xs transition flex items-center gap-2"
          >
            <span>+ Create Ticket</span>
          </button>
          {onClearAllTickets && (
            <button
              type="button"
              onClick={onClearAllTickets}
              className="px-4 py-2 bg-rose-50 hover:bg-rose-100 text-rose-700 border border-rose-200 rounded-xl text-xs font-semibold transition flex items-center gap-1.5"
            >
              <span>🗑️ Clear All Tickets</span>
            </button>
          )}
        </div>

        {showCreateModal && (
          <div className="fixed inset-0 bg-black/50 backdrop-blur-xs flex items-center justify-center z-50 p-4">
            <div className="bg-white rounded-2xl shadow-2xl p-6 w-full max-w-md space-y-4 text-left">
              <div className="flex justify-between items-center border-b border-gray-100 pb-3">
                <h3 className="font-bold text-gray-800 text-sm flex items-center gap-2">
                  <span>✨ Create New Support Ticket</span>
                </h3>
                <button
                  type="button"
                  onClick={() => setShowCreateModal(false)}
                  className="text-gray-400 hover:text-gray-600 text-sm"
                >
                  ✕
                </button>
              </div>
              <form onSubmit={handleCreateSubmit} className="space-y-3">
                <div>
                  <label className="block text-xs font-semibold text-gray-700 mb-1">Target Site</label>
                  <select
                    value={newTicket.site_id}
                    onChange={(e) => setNewTicket({ ...newTicket, site_id: parseInt(e.target.value) })}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg text-xs bg-white"
                  >
                    {sites.map(s => (
                      <option key={s.id} value={s.id}>{s.name} ({s.domain})</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-semibold text-gray-700 mb-1">Subject / Issue Title *</label>
                  <input
                    type="text"
                    required
                    value={newTicket.subject}
                    onChange={(e) => setNewTicket({ ...newTicket, subject: e.target.value })}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg text-xs"
                    placeholder="e.g. Database connection timeout in FBVerse Bot"
                  />
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs font-semibold text-gray-700 mb-1">Channel</label>
                    <select
                      value={newTicket.channel_type}
                      onChange={(e) => setNewTicket({ ...newTicket, channel_type: e.target.value })}
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg text-xs bg-white"
                    >
                      <option value="software">💻 Software Bug</option>
                      <option value="widget">🌐 Website Widget</option>
                      <option value="telegram">✈️ Telegram</option>
                      <option value="email">✉️ Email</option>
                    </select>
                  </div>
                  <div>
                    <label className="block text-xs font-semibold text-gray-700 mb-1">Priority</label>
                    <select
                      value={newTicket.priority}
                      onChange={(e) => setNewTicket({ ...newTicket, priority: e.target.value })}
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg text-xs bg-white"
                    >
                      <option value="high">High</option>
                      <option value="medium">Medium</option>
                      <option value="low">Low</option>
                    </select>
                  </div>
                </div>
                <div>
                  <label className="block text-xs font-semibold text-gray-700 mb-1">Traceback / Error Log (Optional)</label>
                  <textarea
                    rows={4}
                    value={newTicket.error_log}
                    onChange={(e) => setNewTicket({ ...newTicket, error_log: e.target.value })}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg text-xs font-mono"
                    placeholder="Traceback (most recent call last):&#10;  File 'bot.py', line 42...&#10;TimeoutError"
                  />
                </div>
                <div className="flex justify-end gap-2 pt-2">
                  <button
                    type="button"
                    onClick={() => setShowCreateModal(false)}
                    className="px-3 py-2 text-gray-600 hover:bg-gray-100 rounded-lg text-xs font-semibold"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-xs font-semibold shadow-xs"
                  >
                    Submit Ticket
                  </button>
                </div>
              </form>
            </div>
          </div>
        )}
      </div>
    );
  }

  const isResolved = ticket.status === 'resolved';
  const siteName = ticket.site_name || `Site #${ticket.site_id || 1}`;
  const priority = (ticket.priority || 'medium').toLowerCase();
  const channel = ticket.channel_type || 'widget';
  const summaryObj = typeof ticket.ai_summary === 'object' && ticket.ai_summary !== null ? ticket.ai_summary : {};
  const errorLog = summaryObj.error_log || summaryObj.traceback || '';
  const aiSummary = summaryObj.summary || ticket.subject;
  const aiReason = summaryObj.reason || '';

  return (
    <div className="flex-1 flex flex-col bg-gray-50 h-full overflow-y-auto">
      {/* Top Header Bar */}
      <div className="bg-white border-b border-gray-200 px-6 py-4 shadow-2xs">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div className="min-w-0 flex-1">
            {/* Badges row */}
            <div className="flex items-center gap-2 flex-wrap mb-1.5">
              <span className="text-xs font-mono font-bold text-gray-500 bg-gray-100 px-2 py-0.5 rounded border border-gray-200">
                #{ticket.id}
              </span>
              <span className="text-xs font-bold text-gray-700 bg-blue-50 border border-blue-200 px-2.5 py-0.5 rounded-full flex items-center gap-1">
                🌐 {siteName}
              </span>
              {priority === 'critical' || priority === 'high' ? (
                <span className="text-[11px] bg-rose-100 text-rose-700 border border-rose-300 px-2 py-0.5 rounded-full font-bold uppercase">
                  ⚡ HIGH PRIORITY
                </span>
              ) : priority === 'medium' ? (
                <span className="text-[11px] bg-amber-100 text-amber-700 border border-amber-300 px-2 py-0.5 rounded-full font-medium uppercase">
                  MED PRIORITY
                </span>
              ) : (
                <span className="text-[11px] bg-slate-100 text-slate-700 border border-slate-300 px-2 py-0.5 rounded-full font-medium uppercase">
                  LOW PRIORITY
                </span>
              )}
              <span className={`text-[11px] px-2.5 py-0.5 rounded-full font-bold flex items-center gap-1.5 ${
                isResolved
                  ? 'bg-emerald-100 text-emerald-800 border border-emerald-300'
                  : 'bg-green-100 text-green-800 border border-green-300'
              }`}>
                <span className={`w-2 h-2 rounded-full ${isResolved ? 'bg-emerald-600' : 'bg-green-500 animate-pulse'}`} />
                {isResolved ? 'Resolved' : 'Open Ticket'}
              </span>
              <span className="text-[11px] text-gray-500 bg-gray-100 px-2 py-0.5 rounded border border-gray-200">
                {channel === 'software' ? '💻 Software Bug' : channel === 'telegram' ? '✈️ Telegram' : channel === 'email' ? '✉️ Email' : '🌐 Widget'}
              </span>
            </div>

            {/* Subject Title */}
            <h1 className="text-xl font-bold text-gray-900 tracking-tight break-words">
              {ticket.subject || 'Support Ticket'}
            </h1>
          </div>

          {/* Quick Actions */}
          <div className="flex items-center gap-2 flex-shrink-0 flex-wrap">
            {ticket.session_id && onOpenChat && (
              <button
                type="button"
                onClick={() => onOpenChat(ticket.session_id)}
                className="px-3.5 py-2 bg-blue-50 hover:bg-blue-100 text-blue-700 border border-blue-200 rounded-xl text-xs font-bold transition flex items-center gap-1.5 shadow-2xs"
                title="Open live chat session with this user"
              >
                <span>💬 Open Chat</span>
              </button>
            )}

            <button
              type="button"
              onClick={() => onUpdateStatus && onUpdateStatus(ticket.id, ticket.status)}
              className={`px-4 py-2 rounded-xl text-xs font-bold transition flex items-center gap-1.5 shadow-2xs ${
                isResolved
                  ? 'bg-amber-50 hover:bg-amber-100 text-amber-800 border border-amber-300'
                  : 'bg-emerald-600 hover:bg-emerald-700 text-white shadow-emerald-500/20'
              }`}
            >
              <span>{isResolved ? '↺ Reopen Ticket' : '✓ Mark Resolved'}</span>
            </button>

            {onDeleteTicket && (
              <button
                type="button"
                onClick={() => onDeleteTicket(ticket.id)}
                className="p-2 text-gray-400 hover:text-rose-600 hover:bg-rose-50 rounded-xl border border-gray-200 transition"
                title="Delete ticket"
              >
                🗑️
              </button>
            )}

            {onClearAllTickets && (
              <button
                type="button"
                onClick={onClearAllTickets}
                className="px-3 py-2 text-xs font-semibold text-rose-600 hover:text-rose-700 bg-rose-50 hover:bg-rose-100 border border-rose-200 rounded-xl transition flex items-center gap-1"
                title="Clear all tickets from Turso database"
              >
                <span>Clear All</span>
              </button>
            )}
          </div>
        </div>
      </div>

      {/* Detail Body */}
      <div className="p-6 space-y-6 max-w-5xl">
        {/* Traceback / Error Log Terminal View (if software bug report or traceback present) */}
        {errorLog ? (
          <div className="rounded-2xl bg-slate-950 border border-slate-800 shadow-xl overflow-hidden">
            {/* Terminal Window Header */}
            <div className="flex items-center justify-between px-4 py-2.5 bg-slate-900 border-b border-slate-800">
              <div className="flex items-center gap-2">
                <div className="flex items-center gap-1.5">
                  <span className="w-3 h-3 rounded-full bg-rose-500/80 inline-block"></span>
                  <span className="w-3 h-3 rounded-full bg-amber-500/80 inline-block"></span>
                  <span className="w-3 h-3 rounded-full bg-emerald-500/80 inline-block"></span>
                </div>
                <span className="text-xs font-mono text-slate-400 font-semibold pl-2">
                  Crash Traceback / Error Log
                </span>
                {summaryObj.version && (
                  <span className="text-[10px] bg-slate-800 text-slate-300 px-1.5 py-0.2 rounded font-mono">
                    v{summaryObj.version}
                  </span>
                )}
              </div>

              {/* 1-Click Copy Button */}
              <button
                type="button"
                onClick={() => handleCopyLog(errorLog)}
                className={`px-3 py-1 rounded-lg text-xs font-mono font-semibold transition flex items-center gap-1.5 ${
                  copiedLog
                    ? 'bg-emerald-500 text-white'
                    : 'bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700'
                }`}
              >
                <span>{copiedLog ? '✓ Copied!' : '📋 Copy Error Log'}</span>
              </button>
            </div>

            {/* Terminal Code Body */}
            <pre className="p-4 text-xs font-mono text-emerald-400 overflow-x-auto whitespace-pre-wrap leading-relaxed max-h-96 select-text">
              {errorLog}
            </pre>
          </div>
        ) : null}

        {/* AI Diagnostics & Analysis Card */}
        <div className="bg-white rounded-2xl border border-gray-200 p-5 shadow-2xs space-y-3">
          <div className="flex items-center gap-2 text-indigo-700 font-bold text-sm">
            <span>✨ AI Diagnostic Summary</span>
          </div>
          <div className="text-sm text-gray-800 leading-relaxed bg-indigo-50/50 rounded-xl p-3.5 border border-indigo-100">
            {aiSummary}
          </div>
          {aiReason && (
            <div className="text-xs text-gray-600 bg-gray-50 rounded-lg p-3 border border-gray-200">
              <span className="font-bold text-gray-700">Identified Reason / Root Cause: </span>
              {aiReason}
            </div>
          )}
        </div>

        {/* Ticket Metadata Grid */}
        <div className="bg-white rounded-2xl border border-gray-200 p-5 shadow-2xs space-y-4">
          <h3 className="text-sm font-bold text-gray-800">Ticket Information & Metadata</h3>
          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-4 text-xs">
            <div className="bg-gray-50 p-3 rounded-xl border border-gray-100">
              <div className="text-gray-400 font-semibold mb-1">Site / Origin</div>
              <div className="font-bold text-gray-800">{siteName}</div>
              {ticket.site_domain && <div className="text-gray-500">{ticket.site_domain}</div>}
            </div>

            <div className="bg-gray-50 p-3 rounded-xl border border-gray-100">
              <div className="text-gray-400 font-semibold mb-1">Channel</div>
              <div className="font-bold text-gray-800 capitalize">{channel}</div>
              <div className="text-gray-500">Auto-routed</div>
            </div>

            <div className="bg-gray-50 p-3 rounded-xl border border-gray-100">
              <div className="text-gray-400 font-semibold mb-1">Created At</div>
              <div className="font-bold text-gray-800">{new Date(ticket.created_at).toLocaleString()}</div>
            </div>

            {ticket.session_id && (
              <div className="bg-gray-50 p-3 rounded-xl border border-gray-100">
                <div className="text-gray-400 font-semibold mb-1">Associated Session</div>
                <div className="font-mono text-gray-800 truncate">{ticket.session_id}</div>
              </div>
            )}

            {summaryObj.user_id && (
              <div className="bg-gray-50 p-3 rounded-xl border border-gray-100">
                <div className="text-gray-400 font-semibold mb-1">Reported User ID</div>
                <div className="font-mono text-gray-800">{summaryObj.user_id}</div>
              </div>
            )}

            {ticket.resolution_notes && (
              <div className="bg-gray-50 p-3 rounded-xl border border-gray-100 sm:col-span-2">
                <div className="text-gray-400 font-semibold mb-1">Resolution Notes</div>
                <div className="text-emerald-700 font-medium">{ticket.resolution_notes}</div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
