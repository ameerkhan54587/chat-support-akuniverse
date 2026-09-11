import { useState, useRef, useEffect, useCallback } from 'react';
import { useChat } from '../context/ChatContext';
import { useTranslation } from '../i18n';
import { Message } from './Message';
import { SystemMessage } from './SystemMessage';
import { isDifferentDay, getDateDivider } from '../utils/dateUtils';

export function ChatArea({ onSendMessage, onDeleteMessage, onLoadMore, onDeleteSystemMessages, onOpenSidebar, sidebarOpen, onAdminTyping, onResumeAI, onPauseAI }) {
  const { state, clearAiSuggestion } = useChat();
  const { t } = useTranslation();
  const { activeUserId, messages, usersInfo, typingText, config, hasMoreMessages, loadingMoreMessages, aiSuggestions = {}, sessionAiStatuses = {} } = state;
  const [inputText, setInputText] = useState('');
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

  const handleSubmit = (e) => {
    e.preventDefault();
    if (!inputText.trim() || !activeUserId) return;

    onSendMessage(activeUserId, inputText.trim());
    setInputText('');
    setAdminTyping(false);
  };

  const handleKeyDown = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSubmit(e);
    }
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
    <div className="flex-1 flex flex-col bg-gray-50 h-full">
      {/* Chat header */}
      <div className="bg-white border-b border-gray-200 px-4 py-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2 flex-wrap">
            {/* Mobile burger menu */}
            <button
              onClick={onOpenSidebar}
              className="p-1.5 text-gray-500 hover:text-blue-500 hover:bg-blue-50 rounded-lg transition md:hidden"
            >
              <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
              </svg>
            </button>
            <div className="font-medium text-gray-800">
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
              } catch (e) { return null; }
            })()}

            {/* AI Status Indicator */}
            {(() => {
              const status = sessionAiStatuses[activeUserId] || 'active';
              if (status === 'active') {
                return (
                  <div className="inline-flex items-center gap-1.5">
                    <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-medium bg-emerald-50 text-emerald-700 border border-emerald-200">
                      <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse"></span>
                      🤖 AI Active
                    </span>
                    {onPauseAI && (
                      <button
                        type="button"
                        onClick={() => onPauseAI(activeUserId)}
                        className="px-2 py-0.5 text-xs font-medium bg-amber-100 hover:bg-amber-200 text-amber-800 border border-amber-300 rounded-md shadow-sm transition flex items-center gap-1"
                        title="Pause AI auto-replies for this chat"
                      >
                        ⏸️ Pause AI
                      </button>
                    )}
                  </div>
                );
              }
              if (status === 'human_active') {
                return (
                  <div className="inline-flex items-center gap-1.5">
                    <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-medium bg-amber-50 text-amber-700 border border-amber-200">
                      <span className="w-1.5 h-1.5 rounded-full bg-amber-500"></span>
                      👤 Human Active
                    </span>
                    {onResumeAI && (
                      <button
                        type="button"
                        onClick={() => onResumeAI(activeUserId)}
                        className="px-2.5 py-0.5 text-xs font-semibold bg-blue-600 hover:bg-blue-700 text-white rounded-md shadow-sm transition flex items-center gap-1"
                        title="Return conversation to automated AI handling"
                      >
                        🤖 Resume AI
                      </button>
                    )}
                  </div>
                );
              }
              if (status === 'escalated') {
                return (
                  <div className="inline-flex items-center gap-1.5">
                    <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-medium bg-rose-50 text-rose-700 border border-rose-200">
                      <span className="w-1.5 h-1.5 rounded-full bg-rose-500 animate-ping"></span>
                      ⚠️ Escalated
                    </span>
                    {onResumeAI && (
                      <button
                        type="button"
                        onClick={() => onResumeAI(activeUserId)}
                        className="px-2.5 py-0.5 text-xs font-semibold bg-blue-600 hover:bg-blue-700 text-white rounded-md shadow-sm transition flex items-center gap-1"
                        title="Resume AI handling"
                      >
                        🤖 Resume AI
                      </button>
                    )}
                  </div>
                );
              }
              return null;
            })()}
          </div>
          <button
            onClick={onDeleteSystemMessages}
            className="text-xs text-gray-400 hover:text-red-500 transition"
            title={t('chat.clearLogTitle')}
          >
            🗑 {t('chat.clearLog')}
          </button>
        </div>
        <div className="text-xs text-gray-500 mt-1 flex flex-wrap items-center gap-x-1">
          {userInfo?.user_session && (
            <span>user_session: {userInfo.user_session},</span>
          )}
          {userInfo?.user_id && (
            <span>user_id: {userInfo.user_id},</span>
          )}
          <span
            className="cursor-pointer hover:text-blue-500"
            onClick={() => navigator.clipboard.writeText(activeUserId)}
            title={t('chat.copyId')}
          >
            target_id: {activeUserId}
          </span>
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

      {/* AI Suggested Reply Banner */}
      {(() => {
        const suggestion = aiSuggestions[activeUserId];
        if (!suggestion) return null;
        return (
          <div className="mx-4 mb-2 p-3.5 bg-gradient-to-r from-blue-50/90 to-indigo-50/90 border border-blue-200/80 rounded-xl shadow-sm backdrop-blur-sm">
            <div className="flex items-center justify-between mb-1.5">
              <div className="flex items-center gap-2">
                <span className="flex h-2 w-2 relative">
                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-blue-400 opacity-75"></span>
                  <span className="relative inline-flex rounded-full h-2 w-2 bg-blue-500"></span>
                </span>
                <span className="text-xs font-bold text-blue-900 tracking-wide uppercase">💡 AI Suggested Reply</span>
                {suggestion.confidence && (
                  <span className="text-[11px] bg-blue-100 text-blue-800 px-1.5 py-0.5 rounded font-medium border border-blue-200">
                    {(suggestion.confidence * 100).toFixed(0)}% match
                  </span>
                )}
                {suggestion.siteName && (
                  <span className="text-[11px] text-gray-500 font-medium">
                    • {suggestion.siteName}
                  </span>
                )}
              </div>
              <button
                type="button"
                onClick={() => clearAiSuggestion(activeUserId)}
                className="text-gray-400 hover:text-gray-600 text-xs px-1.5 py-0.5 rounded hover:bg-black/5 transition"
                title="Dismiss suggestion"
              >
                ✕
              </button>
            </div>
            <p className="text-sm text-gray-800 mb-2.5 leading-relaxed bg-white/80 p-2.5 rounded-lg border border-blue-100/80 select-text">
              {suggestion.suggestion}
            </p>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => {
                  setInputText(suggestion.suggestion);
                  clearAiSuggestion(activeUserId);
                }}
                className="text-xs bg-white hover:bg-gray-50 text-blue-700 font-medium px-3 py-1.5 rounded-lg border border-blue-200 shadow-sm transition flex items-center gap-1.5"
              >
                <span>✍️ Use & Edit</span>
              </button>
              <button
                type="button"
                onClick={() => {
                  onSendMessage(activeUserId, suggestion.suggestion);
                  clearAiSuggestion(activeUserId);
                }}
                className="text-xs bg-blue-600 hover:bg-blue-700 text-white font-medium px-3.5 py-1.5 rounded-lg shadow-sm transition flex items-center gap-1.5"
              >
                <span>🚀 Send Directly</span>
              </button>
            </div>
          </div>
        );
      })()}

      {/* Input area */}
      <form onSubmit={handleSubmit} className="bg-white border-t border-gray-200 p-4">
        <div className="flex gap-2">
          <input
            type="text"
            value={inputText}
            onChange={(e) => { setInputText(e.target.value); setAdminTyping(e.target.value.length > 0); }}
            onKeyDown={handleKeyDown}
            placeholder={t('chat.inputPlaceholder')}
            className="flex-1 px-4 py-2 border border-gray-300 rounded-full focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none transition"
          />
          <button
            type="submit"
            disabled={!inputText.trim()}
            className="w-10 h-10 bg-blue-500 hover:bg-blue-600 disabled:bg-gray-300 text-white rounded-full flex items-center justify-center transition"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 19l9 2-9-18-9 18 9-2zm0 0v-8" />
            </svg>
          </button>
        </div>
      </form>
    </div>
  );
}
