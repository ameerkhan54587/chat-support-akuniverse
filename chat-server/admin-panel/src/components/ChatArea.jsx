import { useState, useRef, useEffect, useCallback } from 'react';
import { ConfirmModal } from './ConfirmModal';
import { useChat } from '../context/ChatContext';
import { useTranslation } from '../i18n';
import { Message } from './Message';
import { SystemMessage } from './SystemMessage';
import { isDifferentDay, getDateDivider } from '../utils/dateUtils';

export function ChatArea({ onSendMessage, onDeleteMessage, onLoadMore, onDeleteSystemMessages, onOpenSidebar, onAdminTyping, tickets = [], onTicketViewed, onTicketStatusChange, telegramBlocked = false, onToggleTelegramBlock, telegramMuted = false, onToggleTelegramMute }) {
  const { state } = useChat();
  const { t } = useTranslation();
  const { activeUserId, messages, usersInfo, typingText, config, hasMoreMessages, loadingMoreMessages } = state;
  const [inputText, setInputText] = useState('');
  const [selectedImage, setSelectedImage] = useState(null);
  const [imagePreview, setImagePreview] = useState('');
  const [sending, setSending] = useState(false);
  const [confirmClear, setConfirmClear] = useState(false);
  const fileInputRef = useRef(null);
  const [expandedTicketId, setExpandedTicketId] = useState(null);
  const messagesEndRef = useRef(null);
  const messagesContainerRef = useRef(null);
  const isInitialLoadRef = useRef(true);
  const prevMessagesLengthRef = useRef(0);
  const scrollHeightBeforeLoadRef = useRef(0);
  const isPrependingRef = useRef(false);

  const adminTypingRef = useRef(false);

  const setAdminTyping = useCallback((isTyping) => {
    if (adminTypingRef.current !== isTyping && activeUserId && onAdminTyping) {
      adminTypingRef.current = isTyping;
      onAdminTyping(activeUserId, isTyping);
    }
  }, [activeUserId, onAdminTyping]);

  const userInfo = activeUserId ? usersInfo[activeUserId] : null;
  const userName = userInfo?.user_name || userInfo?.name || t('chat.guest');
  const userEmail = userInfo?.user_email || userInfo?.email || '';

  // Reset initial load flag when active user changes
  useEffect(() => {
    isInitialLoadRef.current = true;
    prevMessagesLengthRef.current = 0;
    // Stop typing for previous user
    adminTypingRef.current = false;
  }, [activeUserId]);

  // Auto-scroll to bottom on initial load or new messages at end
  useEffect(() => {
    if (messages.length === 0) return;

    const container = messagesContainerRef.current;
    if (!container) return;

    // If this is initial load or new message added at end, scroll to bottom
    if (isInitialLoadRef.current) {
      messagesEndRef.current?.scrollIntoView({ behavior: 'auto' });
      isInitialLoadRef.current = false;
    } else if (messages.length > prevMessagesLengthRef.current) {
      // Check if new message was added at end (not prepended)
      const wasAtBottom = container.scrollHeight - container.scrollTop - container.clientHeight < 100;
      if (wasAtBottom) {
        messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
      }
    }

    prevMessagesLengthRef.current = messages.length;
  }, [messages]);

  // Scroll to bottom when typing indicator appears
  useEffect(() => {
    if (typingText && messagesEndRef.current) {
      const container = messagesContainerRef.current;
      if (container) {
        const wasAtBottom = container.scrollHeight - container.scrollTop - container.clientHeight < 100;
        if (wasAtBottom) {
          messagesEndRef.current.scrollIntoView({ behavior: 'smooth' });
        }
      }
    }
  }, [typingText]);

  // Handle scroll to load more messages
  const handleScroll = () => {
    if (!hasMoreMessages || loadingMoreMessages) return;

    const container = messagesContainerRef.current;
    if (!container) return;

    // Load more when scrolled near top (within 50px)
    if (container.scrollTop < 50) {
      // Save scroll height before loading
      scrollHeightBeforeLoadRef.current = container.scrollHeight;
      isPrependingRef.current = true;
      onLoadMore();
    }
  };

  // Restore scroll position after prepending messages
  useEffect(() => {
    if (!isPrependingRef.current) return;

    const container = messagesContainerRef.current;
    if (!container) return;

    // Calculate new scroll position to maintain view
    const newScrollHeight = container.scrollHeight;
    const scrollDiff = newScrollHeight - scrollHeightBeforeLoadRef.current;
    container.scrollTop = scrollDiff;

    isPrependingRef.current = false;
  }, [messages]);

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (sending || (!inputText.trim() && !selectedImage) || !activeUserId) return;
    if (selectedImage && !/^telegram:/i.test(String(activeUserId))) { window.alert('Image attachments are only supported in Telegram chats.'); return; }
    setSending(true);
    try {
      const success = await onSendMessage(activeUserId, selectedImage ? { imageData: selectedImage, caption: inputText.trim() } : inputText.trim());
      if (success !== false) { setInputText(''); setSelectedImage(null); setImagePreview(''); setAdminTyping(false); }
    } finally { setSending(false); }
  };


  // Group messages by date
  const renderMessages = () => {
    const result = [];
    let lastDate = null;

    messages.forEach((msg, index) => {
      const msgDate = new Date(msg.timestamp);

      // Add date divider if needed
      if (!lastDate || isDifferentDay(lastDate, msgDate, config.timezone)) {
        result.push(
          <div key={`divider-${index}`} className="flex items-center my-4">
            <div className="flex-1 border-t border-gray-200"></div>
            <span className="px-3 text-sm text-gray-500">
              {getDateDivider(msgDate, config.dateFormat, config.timezone)}
            </span>
            <div className="flex-1 border-t border-gray-200"></div>
          </div>
        );
      }
      lastDate = msgDate;

      // Render system message or regular message
      if (msg.sender === 'system') {
        result.push(
          <SystemMessage
            key={msg.id}
            message={msg}
            config={config}
          />
        );
      } else {
        result.push(
          <Message
            key={msg.id}
            message={msg}
            config={config}
            onDelete={() => onDeleteMessage(msg.id, activeUserId)}
          />
        );
      }
    });

    return result;
  };

  if (!activeUserId) {
    return (
      <div className="flex-1 flex flex-col bg-gray-50">
        {/* Mobile header with burger menu */}
        <div className="bg-white border-b border-gray-200 px-4 py-3 md:hidden">
          <button
            onClick={onOpenSidebar}
            className="p-1.5 text-gray-500 hover:text-blue-500 hover:bg-blue-50 rounded-lg transition"
          >
            <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
            </svg>
          </button>
        </div>
        <div className="flex-1 flex items-center justify-center">
          <div className="text-center text-gray-500">
            <svg className="w-16 h-16 mx-auto mb-4 text-gray-300" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1} d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
            </svg>
            <p>{t('chat.selectChat')}</p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="flex-1 flex flex-col bg-gray-50 dark:bg-[#0b1120] h-full min-w-0">
      {/* Chat header */}
      <div className="bg-white dark:bg-[#151f30] border-b border-gray-200 dark:border-slate-700 px-4 py-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2 flex-wrap">
            {/* Mobile burger menu */}
            <button
              onClick={onOpenSidebar}
              aria-label="Open conversations" title="Open conversations"
              className="p-1.5 text-gray-500 hover:text-blue-500 hover:bg-blue-50 rounded-lg transition md:hidden"
            >
              <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
              </svg>
            </button>
            <div className="font-semibold text-gray-900 dark:text-slate-100">
              {userName}{userEmail && `: ${userEmail}`}
            </div>

            {/* Site domain badge if available */}
            {userInfo?.current_url && (() => {
              try {
                const host = new URL(userInfo.current_url).hostname;
                return (
                  <span className="px-2 py-0.5 text-xs font-semibold bg-blue-50 text-blue-700 border border-blue-200 rounded-md">
                    🌐 {host}
                  </span>
                );
              } catch { return null; }
            })()}

          </div>
          {userInfo?.source === 'telegram' && <div className="flex gap-2">
            <button type="button" onClick={onToggleTelegramBlock} className="text-xs rounded-lg border border-gray-300 dark:border-slate-600 px-2.5 py-1 text-gray-600 dark:text-slate-300 hover:bg-gray-100 dark:hover:bg-slate-700 transition">{telegramBlocked ? 'Unblock' : 'Block'}</button>
            <button type="button" onClick={onToggleTelegramMute} className="text-xs rounded-lg border border-gray-300 dark:border-slate-600 px-2.5 py-1 text-gray-600 dark:text-slate-300 hover:bg-gray-100 dark:hover:bg-slate-700 transition">{telegramMuted ? 'Unmute' : 'Mute'}</button>
          </div>}
          <button
            onClick={() => setConfirmClear(true)}
            className="text-xs text-gray-400 hover:text-red-500 transition"
            title={t('chat.clearLogTitle')}
            aria-label={t('chat.clearLogTitle')}
          >
            🗑 {t('chat.clearLog')}
          </button>
        </div>
        <details className="mt-2 text-xs text-gray-500"><summary className="cursor-pointer select-none">Technical details</summary><div className="mt-1 flex flex-wrap items-center gap-x-2"><span>session: {userInfo?.user_session || '—'}</span><span>user: {userInfo?.user_id || '—'}</span><button type="button" className="text-blue-500 hover:underline" onClick={() => navigator.clipboard.writeText(activeUserId)} title="Copy conversation ID">Copy ID</button></div></details>
        <div className="text-xs text-gray-500 mt-1 flex flex-wrap items-center gap-x-1">
          {userInfo?.current_url && (
            <>
              <span className="text-gray-400">📍</span>
              <a
                href={userInfo.current_url}
                target="_blank"
                rel="noopener noreferrer"
                className="text-cyan-600 hover:text-cyan-800 hover:underline truncate max-w-xs"
                title={userInfo.current_url}
              >
                {userInfo.current_url}
              </a>
            </>
          )}
        </div>
      </div>

      {tickets.length > 0 && (
        <section className="border-b border-amber-200 dark:border-amber-900 bg-amber-50/70 dark:bg-amber-950/30 px-4 py-3 space-y-2" aria-label="Support tickets for this chat">
          {tickets.map(ticket => {
            const expanded = expandedTicketId === ticket.id;
            const isResolved = ticket.status === 'resolved';
            return (
              <article key={ticket.id} className="rounded-xl border border-amber-200 bg-white shadow-xs overflow-hidden">
                <button
                  type="button"
                  onClick={() => {
                    setExpandedTicketId(expanded ? null : ticket.id);
                    if (!expanded && (!ticket.is_read || ticket.is_read === 0)) onTicketViewed?.(ticket.id);
                  }}
                  className="w-full flex items-center gap-3 px-3 py-2.5 text-left hover:bg-amber-50 transition"
                  aria-expanded={expanded}
                >
                  <span className="w-8 h-8 rounded-lg bg-amber-100 text-amber-800 flex items-center justify-center flex-shrink-0">🎫</span>
                  <span className="flex-1 min-w-0">
                    <span className="block text-xs font-bold text-gray-800 truncate">#{ticket.id} · {ticket.subject || 'Support ticket'}</span>
                    <span className="block text-[11px] text-gray-500">{ticket.site_name || 'Support'} · {isResolved ? 'Resolved' : 'Open'}{ticket.is_read ? '' : ' · New'}</span>
                  </span>
                  <span className="text-xs font-semibold text-blue-700">{expanded ? 'Close' : 'View & reply'} {expanded ? '⌃' : '⌄'}</span>
                </button>
                {expanded && (
                  <div className="border-t border-amber-100 px-3 py-3 space-y-3">
                    <div className="text-sm text-gray-700 whitespace-pre-wrap">{ticket.subject || 'Support ticket'}</div>
                    {ticket.error_log && (
                      <pre className="max-h-40 overflow-auto rounded-lg bg-slate-950 p-3 text-[11px] leading-relaxed text-emerald-300 whitespace-pre-wrap">{ticket.error_log}</pre>
                    )}
                    <div className="flex items-center justify-between gap-2">
                      <span className={`text-[11px] font-semibold ${isResolved ? 'text-emerald-700' : 'text-blue-700'}`}>{isResolved ? 'Resolved' : 'Open ticket'}</span>
                      <button
                        type="button"
                        onClick={() => onTicketStatusChange?.(ticket.id, ticket.status)}
                        className="rounded-lg border border-gray-200 px-3 py-1.5 text-xs font-semibold text-gray-700 hover:bg-gray-50"
                      >{isResolved ? 'Reopen' : 'Mark resolved'}</button>
                    </div>
                    <p className="text-[11px] text-gray-500">Reply to the customer using the chat box below.</p>
                  </div>
                )}
              </article>
            );
          })}
        </section>
      )}

      {/* Messages container */}
      <div
        ref={messagesContainerRef}
        className="flex-1 overflow-y-auto p-4"
        onScroll={handleScroll}
      >
        {/* Load more indicator */}
        {loadingMoreMessages && (
          <div className="text-center py-2 mb-2">
            <span className="text-gray-500 text-sm">{t('chat.loading')}</span>
          </div>
        )}
        {messages.length === 0 ? (
          <div className="text-center text-gray-400 mt-8">
            {t('chat.noMessages')}
          </div>
        ) : (
          renderMessages()
        )}
        <div ref={messagesEndRef} />
      </div>

      {/* Typing indicator */}
      {config.realtimeTyping && typingText && (
        <div className="px-4 py-2 bg-yellow-50 border-t border-yellow-200">
          <div className="text-sm text-yellow-700">
            <span className="font-medium">{t('chat.typing')}</span> {typingText}
          </div>
        </div>
      )}

      {/* Input area */}
      <form onSubmit={handleSubmit} className="bg-white dark:bg-[#151f30] border-t border-gray-200 dark:border-slate-700 p-3 sm:p-4">
        {imagePreview && <div className="mb-2 flex items-center gap-3"><img src={imagePreview} alt="Selected attachment preview" className="h-16 w-16 rounded-lg object-cover" /><button type="button" className="text-xs text-red-500" onClick={() => { setSelectedImage(null); setImagePreview(''); }}>Remove image</button></div>}
        <div className="flex gap-2 items-end">
          <input ref={fileInputRef} type="file" accept="image/*" className="hidden" aria-label="Choose image" onChange={e => { const file=e.target.files?.[0]; if (!file) return; if (file.size > (/^telegram:site_smsotps:/i.test(String(activeUserId)) ? 5 : 7.5)*1024*1024) { window.alert(/^telegram:site_smsotps:/i.test(String(activeUserId)) ? 'SMSOTPS images must be 5 MB or smaller.' : 'Image must be under 7.5 MB.'); e.target.value=''; return; } const reader=new FileReader(); reader.onload=()=>{ setSelectedImage(String(reader.result)); setImagePreview(String(reader.result)); e.target.value=''; }; reader.readAsDataURL(file); }} />
          <button type="button" title="Attach image" aria-label="Attach image" onClick={() => fileInputRef.current?.click()} className="h-10 w-10 shrink-0 rounded-full border border-gray-300 dark:border-slate-600 text-gray-500 hover:text-blue-500">＋</button>
          <textarea
            rows={1}
            value={inputText}
            onChange={(e) => { setInputText(e.target.value); setAdminTyping(e.target.value.length > 0); }}
            onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSubmit(e); } }}
            placeholder={t('chat.inputPlaceholder')}
            className="flex-1 min-h-10 max-h-32 resize-y px-4 py-2 border border-gray-300 dark:border-slate-600 dark:bg-slate-900 dark:text-slate-100 rounded-2xl focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none transition"
          />
          <button
            type="submit"
            disabled={sending || (!inputText.trim() && !selectedImage)}
            className="w-10 h-10 bg-blue-500 hover:bg-blue-600 disabled:bg-gray-300 text-white rounded-full flex items-center justify-center transition"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 19l9 2-9-18-9 18 9-2zm0 0v-8" />
            </svg>
          </button>
        </div>
      </form>
      <ConfirmModal isOpen={confirmClear} onClose={() => setConfirmClear(false)} onConfirm={onDeleteSystemMessages} title="Clear system log?" message="This removes system events from this conversation. Customer and agent messages stay." confirmText="Clear log" danger />
    </div>
  );
}
