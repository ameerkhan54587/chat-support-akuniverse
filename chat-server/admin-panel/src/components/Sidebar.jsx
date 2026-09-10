import { useState, useMemo, useRef, useEffect, useCallback } from 'react';
import { useChat } from '../context/ChatContext';
import { useTranslation } from '../i18n';
import { getTimeString } from '../utils/dateUtils';
import { ConfirmModal } from './ConfirmModal';
import { EditUserModal } from './EditUserModal';

export function getUserChannel(userId, info = {}) {
  if (info.channel === 'telegram' || info.telegram_bot_name || info.telegram_bot_id || info.telegram_chat_id || String(userId).startsWith('tg_')) {
    return 'telegram';
  }
  if (info.channel === 'email' || info.source === 'email' || String(userId).startsWith('email_')) {
    return 'email';
  }
  return 'widget';
}

export function Sidebar({
  onSelectUser,
  onDeleteUser,
  onEditUser,
  onOpenSettings,
  onOpenSites,
  onLogout,
  onSearch,
  onSearchResultsHandler,
  activeChannelTab = 'all',
  onSelectChannelTab,
  tickets = [],
  activeTicketId = null,
  onSelectTicket = () => {},
  onClearAllTickets = () => {}
}) {
  const { state } = useChat();
  const { t } = useTranslation();
  const { users, usersInfo, activeUserId, notifications, onlineUsers, tabActiveUsers, config } = state;
  const [deleteConfirm, setDeleteConfirm] = useState(null);
  const [editUserId, setEditUserId] = useState(null);

  // Search state
  const [searchMode, setSearchMode] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState(null);
  const [searchLoading, setSearchLoading] = useState(false);
  const searchInputRef = useRef(null);
  const debounceTimerRef = useRef(null);
  const lastSearchQueryRef = useRef('');

  // Sort users: online first, then offline
  const sortedUsers = useMemo(() => {
    return [...users].sort((a, b) => {
      const aOnline = onlineUsers[a] ?? false;
      const bOnline = onlineUsers[b] ?? false;
      if (aOnline === bOnline) return 0;
      return aOnline ? -1 : 1;
    });
  }, [users, onlineUsers]);

  // Filter users based on activeChannelTab
  const channelFilteredUsers = useMemo(() => {
    return sortedUsers.filter(userId => {
      if (!activeChannelTab || activeChannelTab === 'all' || activeChannelTab === 'tickets') return true;
      const info = usersInfo[userId] || {};
      const channel = getUserChannel(userId, info);
      if (activeChannelTab === 'escalated') {
        const aiStatus = state.sessionAiStatuses?.[userId];
        return aiStatus === 'escalated' || aiStatus === 'human_active';
      }
      return channel === activeChannelTab;
    });
  }, [sortedUsers, usersInfo, activeChannelTab, state.sessionAiStatuses]);

  const isUserOnline = (userId) => onlineUsers[userId] ?? false;
  const isTabActive = (userId) => tabActiveUsers[userId] ?? false;

  const getUserName = (userId) => {
    const info = usersInfo[userId];
    return info?.user_name || info?.name || t('sidebar.guest');
  };

  const getUserEmail = (userId) => {
    const info = usersInfo[userId];
    return info?.user_email || info?.email || '';
  };

  const getInitial = (userId) => {
    const name = getUserName(userId);
    return name.charAt(0).toUpperCase();
  };

  const getBotName = (userId) => usersInfo[userId]?.telegram_bot_name || '';

  // Register search results handler
  useEffect(() => {
    if (onSearchResultsHandler) {
      onSearchResultsHandler((results, query) => {
        if (query === lastSearchQueryRef.current) {
          setSearchResults(results);
          setSearchLoading(false);
        }
      });
    }
    return () => {
      if (onSearchResultsHandler) {
        onSearchResultsHandler(null);
      }
    };
  }, [onSearchResultsHandler]);

  // Auto-focus input when search mode opens
  useEffect(() => {
    if (searchMode && searchInputRef.current) {
      searchInputRef.current.focus();
    }
  }, [searchMode]);

  // Cleanup debounce timer on unmount
  useEffect(() => {
    return () => {
      if (debounceTimerRef.current) {
        clearTimeout(debounceTimerRef.current);
      }
    };
  }, []);

  const handleSearchInput = useCallback((value) => {
    setSearchQuery(value);

    if (debounceTimerRef.current) {
      clearTimeout(debounceTimerRef.current);
    }

    if (value.trim().length < 2) {
      setSearchResults(null);
      setSearchLoading(false);
      lastSearchQueryRef.current = '';
      return;
    }

    if (value.trim().length > 100) return;

    setSearchLoading(true);
    debounceTimerRef.current = setTimeout(() => {
      lastSearchQueryRef.current = value.trim();
      onSearch(value.trim());
    }, 400);
  }, [onSearch]);

  const openSearch = useCallback(() => {
    setSearchMode(true);
    setSearchQuery('');
    setSearchResults(null);
    setSearchLoading(false);
  }, []);

  const closeSearch = useCallback(() => {
    setSearchMode(false);
    setSearchQuery('');
    setSearchResults(null);
    setSearchLoading(false);
    if (debounceTimerRef.current) {
      clearTimeout(debounceTimerRef.current);
    }
  }, []);

  // Render a user item (reused in both normal and search modes)
  const renderUserItem = (userId, info, matchedText) => {
    const online = isUserOnline(userId);
    const name = info?.user_name || info?.name || t('sidebar.guest');
    const email = info?.user_email || info?.email || '';
    const initial = name.charAt(0).toUpperCase();
    const channel = getUserChannel(userId, info);
    const aiStatus = state.sessionAiStatuses?.[userId];
    const isEscalated = aiStatus === 'escalated' || aiStatus === 'human_active';
    const unreadCount = Number(notifications[userId]) || (notifications[userId] ? 1 : 0);
    const hasUnread = unreadCount > 0;

    return (
      <div
        key={userId}
        onClick={() => onSelectUser(userId)}
        className={`p-3 border-b border-gray-100 cursor-pointer hover:bg-gray-50 transition relative ${
          activeUserId === userId
            ? 'bg-blue-50 border-l-4 border-l-blue-600'
            : hasUnread
            ? 'bg-red-50/40 border-l-4 border-l-red-500 hover:bg-red-50/60'
            : ''
        } ${!online ? 'opacity-70' : ''}`}
      >
        <div className="flex items-center gap-3">
          {/* Avatar */}
          <div className="relative flex-shrink-0">
            <div className={`w-10 h-10 rounded-full flex items-center justify-center text-white font-bold ${
              online ? 'bg-blue-600' : 'bg-gray-400'
            }`}>
              {initial}
            </div>
            {hasUnread && (
              <span className="absolute -top-1.5 -right-1.5 min-w-[20px] h-[20px] px-1 bg-red-600 text-white rounded-full border-2 border-white text-[11px] font-black flex items-center justify-center shadow-xs animate-pulse z-10">
                {unreadCount > 99 ? '99+' : unreadCount}
              </span>
            )}
            <span className={`absolute -bottom-0.5 -right-0.5 w-3.5 h-3.5 rounded-full border-2 border-white ${
              online ? 'bg-green-500' : 'bg-gray-400'
            }`}></span>
          </div>

          {/* User info */}
          <div className="flex-1 min-w-0">
            <div className="flex items-center justify-between gap-1">
              <div className={`truncate flex items-center gap-1.5 ${
                hasUnread ? 'font-black text-gray-950 text-[14px]' : online ? 'font-medium text-gray-800' : 'font-medium text-gray-500'
              }`}>
                <span className="truncate">{name}</span>
                {getBotName(userId) && (
                  <span className="inline-flex rounded bg-sky-100 px-1.5 py-0.5 text-[10px] font-medium text-sky-700 align-middle">
                    {getBotName(userId)}
                  </span>
                )}
              </div>

              {/* Channel Pill Badge & Unread Count */}
              <div className="flex items-center gap-1 flex-shrink-0">
                {hasUnread && (
                  <span className="bg-red-600 text-white text-[10px] font-black px-1.5 py-0.5 rounded-full shadow-xs animate-pulse">
                    {unreadCount} new
                  </span>
                )}
                {isEscalated ? (
                  <span className="text-[10px] bg-rose-50 text-rose-700 px-1.5 py-0.2 rounded border border-rose-200 font-bold">
                    ⚠️ Escalated
                  </span>
                ) : channel === 'telegram' ? (
                  <span className="text-[10px] bg-sky-50 text-sky-700 px-1.5 py-0.2 rounded border border-sky-200 font-medium">
                    ✈️ Telegram
                  </span>
                ) : channel === 'email' ? (
                  <span className="text-[10px] bg-amber-50 text-amber-700 px-1.5 py-0.2 rounded border border-amber-200 font-medium">
                    ✉️ Email
                  </span>
                ) : (
                  <span className="text-[10px] bg-blue-50 text-blue-700 px-1.5 py-0.2 rounded border border-blue-200 font-medium">
                    🌐 Widget
                  </span>
                )}
              </div>
            </div>

            {email && (
              <div className="text-xs text-gray-500 truncate">{email}</div>
            )}
            {matchedText && (
              <div className="text-xs text-gray-400 truncate mt-0.5 italic">
                {matchedText}
              </div>
            )}
          </div>
        </div>
      </div>
    );
  };

  // Filtered tickets (supports search mode)
  const filteredTickets = useMemo(() => {
    if (!tickets || !Array.isArray(tickets)) return [];
    if (searchMode && searchQuery.trim().length >= 2) {
      const q = searchQuery.toLowerCase().trim();
      return tickets.filter(t => {
        return String(t.id).includes(q) ||
          (t.subject && t.subject.toLowerCase().includes(q)) ||
          (t.site_name && t.site_name.toLowerCase().includes(q)) ||
          (t.channel_type && t.channel_type.toLowerCase().includes(q)) ||
          (t.priority && t.priority.toLowerCase().includes(q)) ||
          (t.ai_summary && JSON.stringify(t.ai_summary).toLowerCase().includes(q));
      });
    }
    return tickets;
  }, [tickets, searchMode, searchQuery]);

  // Render a ticket item card
  const renderTicketItem = (ticket) => {
    const isSelected = activeTicketId === ticket.id;
    const isUnread = !ticket.is_read || ticket.is_read === 0;
    const isResolved = ticket.status === 'resolved';
    const siteName = ticket.site_name || `Site #${ticket.site_id || 1}`;
    const priority = (ticket.priority || 'medium').toLowerCase();
    const channel = ticket.channel_type || 'widget';

    return (
      <div
        key={ticket.id}
        onClick={() => onSelectTicket(ticket.id)}
        className={`p-3 border-b border-gray-100 cursor-pointer transition relative select-none ${
          isSelected
            ? 'bg-blue-50/90 border-l-4 border-l-blue-600 shadow-2xs'
            : isUnread
            ? 'bg-red-50/40 border-l-4 border-l-red-500 hover:bg-red-50/70'
            : 'border-l-4 border-l-transparent hover:bg-gray-50'
        } ${isResolved ? 'opacity-70' : ''}`}
      >
        <div className="flex items-start gap-2.5">
          {/* Channel Icon Badge */}
          <div className="relative flex-shrink-0 mt-0.5">
            <div className={`w-9 h-9 rounded-lg flex items-center justify-center text-sm font-bold shadow-2xs ${
              channel === 'software'
                ? 'bg-rose-100 text-rose-700 border border-rose-200'
                : channel === 'telegram'
                ? 'bg-sky-100 text-sky-700 border border-sky-200'
                : channel === 'email'
                ? 'bg-amber-100 text-amber-700 border border-amber-200'
                : 'bg-blue-100 text-blue-700 border border-blue-200'
            }`}>
              {channel === 'software' ? '💻' : channel === 'telegram' ? '✈️' : channel === 'email' ? '✉️' : '🎫'}
            </div>
            {isUnread && (
              <span className="absolute -top-1 -right-1 w-2.5 h-2.5 bg-red-600 rounded-full ring-2 ring-white animate-pulse" />
            )}
          </div>

          {/* Ticket Body */}
          <div className="flex-1 min-w-0">
            {/* Top row: Site Badge & Priority Pill */}
            <div className="flex items-center justify-between gap-1 mb-1">
              <div className="flex items-center gap-1.5 min-w-0">
                <span className="text-[11px] font-bold text-gray-700 truncate bg-gray-100 px-1.5 py-0.5 rounded border border-gray-200">
                  🌐 {siteName}
                </span>
                <span className="text-[10px] text-gray-400 font-mono">
                  #{ticket.id}
                </span>
              </div>

              <div className="flex items-center gap-1 flex-shrink-0">
                {isUnread && (
                  <span className="bg-red-600 text-white text-[9px] font-black px-1.5 py-0.2 rounded-full shadow-xs animate-pulse">
                    NEW
                  </span>
                )}
                {priority === 'critical' || priority === 'high' ? (
                  <span className="text-[10px] bg-rose-50 text-rose-700 px-1.5 py-0.2 rounded border border-rose-200 font-bold uppercase">
                    HIGH
                  </span>
                ) : priority === 'medium' ? (
                  <span className="text-[10px] bg-amber-50 text-amber-700 px-1.5 py-0.2 rounded border border-amber-200 font-medium uppercase">
                    MED
                  </span>
                ) : (
                  <span className="text-[10px] bg-slate-50 text-slate-600 px-1.5 py-0.2 rounded border border-slate-200 font-medium uppercase">
                    LOW
                  </span>
                )}
              </div>
            </div>

            {/* Subject Title */}
            <div className={`text-xs line-clamp-2 mb-1 ${
              isUnread ? 'font-bold text-gray-950' : 'font-medium text-gray-700'
            }`}>
              {ticket.subject || 'Support Ticket'}
            </div>

            {/* Bottom Row: Status & Timestamp */}
            <div className="flex items-center justify-between text-[10px] text-gray-400">
              <span className={`inline-flex items-center gap-1 font-semibold ${
                isResolved ? 'text-emerald-600' : 'text-blue-600'
              }`}>
                <span className={`w-1.5 h-1.5 rounded-full ${isResolved ? 'bg-emerald-500' : 'bg-blue-500'}`} />
                {isResolved ? 'Resolved' : 'Open'}
              </span>
              <span>{getTimeString(ticket.created_at, config?.timeFormat, config?.timezone)}</span>
            </div>
          </div>
        </div>
      </div>
    );
  };

  return (
    <aside className="w-80 bg-white border-r border-gray-200 flex flex-col h-full">
      {/* Header */}
      {searchMode ? (
        <div className="p-4 border-b border-gray-200 relative">
          <div className="flex items-center gap-2">
            {/* Search icon on left */}
            <svg className="w-5 h-5 text-gray-400 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
            </svg>
            {/* Search input */}
            <input
              ref={searchInputRef}
              type="text"
              value={searchQuery}
              onChange={(e) => handleSearchInput(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Escape') closeSearch(); }}
              maxLength={100}
              placeholder={activeChannelTab === 'tickets' ? 'Search tickets by ID, site, bug log...' : t('sidebar.searchPlaceholder')}
              className="flex-1 outline-none text-gray-800 placeholder-gray-400 bg-transparent text-sm"
            />
            {/* Close button on right */}
            <button
              onClick={closeSearch}
              className="p-1 text-gray-400 hover:text-gray-600 rounded transition flex-shrink-0"
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
          {/* Loading animation bar */}
          {searchLoading && (
            <div className="absolute bottom-0 left-0 right-0 h-0.5 overflow-hidden">
              <div className="h-full bg-blue-500 animate-search-loading"></div>
            </div>
          )}
        </div>
      ) : activeChannelTab === 'tickets' ? (
        <div className="p-4 border-b border-gray-200 flex items-center justify-between">
          <div className="flex items-center gap-2 min-w-0">
            <h1 className="text-xl font-bold text-gray-800">Support Tickets</h1>
            <span className="text-xs bg-purple-100 text-purple-700 font-bold px-2 py-0.5 rounded-full">
              {tickets.length}
            </span>
          </div>
          <div className="flex items-center gap-1.5 flex-shrink-0">
            {/* Clear All Tickets button */}
            <button
              onClick={onClearAllTickets}
              disabled={tickets.length === 0}
              className="px-2.5 py-1 text-xs font-semibold text-rose-600 hover:text-rose-700 bg-rose-50 hover:bg-rose-100 border border-rose-200 rounded-lg transition flex items-center gap-1 disabled:opacity-40 disabled:cursor-not-allowed shadow-2xs"
              title="Clear all tickets from Turso database"
            >
              <span>🗑️</span>
              <span className="hidden sm:inline">Clear All</span>
            </button>
            {/* Search button */}
            <button
              onClick={openSearch}
              className="p-1.5 text-gray-500 hover:text-blue-500 hover:bg-blue-50 rounded-lg transition"
              title="Search Tickets"
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
              </svg>
            </button>
          </div>
        </div>
      ) : (
        <div className="p-4 border-b border-gray-200 flex items-center justify-between">
          <h1 className="text-xl font-bold text-gray-800">{t('sidebar.title')}</h1>
          <div className="flex items-center gap-1">
            {/* ONLY keep Search button */}
            <button
              onClick={openSearch}
              className="p-1.5 text-gray-500 hover:text-blue-500 hover:bg-blue-50 rounded-lg transition"
              title={t('sidebar.search')}
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
              </svg>
            </button>
          </div>
        </div>
      )}

      {/* User list / Tickets list / Search results */}
      <div className="flex-1 overflow-y-auto">
        {activeChannelTab === 'tickets' ? (
          filteredTickets.length === 0 ? (
            <div className="p-8 text-center space-y-2">
              <div className="text-3xl mb-1">🎫</div>
              <div className="text-gray-600 font-semibold text-sm">No Tickets Found</div>
              <div className="text-gray-400 text-xs">
                {searchMode && searchQuery ? 'No tickets matched your search query.' : 'All support tickets and bug reports are cleared.'}
              </div>
            </div>
          ) : (
            filteredTickets.map(renderTicketItem)
          )
        ) : searchMode ? (
          <>
            {searchQuery.trim().length < 2 ? (
              <div className="p-4 text-gray-400 text-center text-sm">
                {t('sidebar.searchHint')}
              </div>
            ) : searchResults !== null && !searchLoading ? (
              searchResults.length === 0 ? (
                <div className="p-4 text-gray-400 text-center text-sm">
                  {t('sidebar.searchNoResults')}
                </div>
              ) : (
                searchResults.map((result) => renderUserItem(result.id, result.info, result.matchedText))
              )
            ) : null}
          </>
        ) : (
          <>
            {/* Active Channel Filter Strip */}
            {activeChannelTab && activeChannelTab !== 'all' && activeChannelTab !== 'tickets' && (
              <div className="px-3 py-2 bg-blue-50/80 border-b border-blue-100 flex items-center justify-between text-xs text-blue-900">
                <span className="font-semibold flex items-center gap-1.5">
                  <span className="capitalize">{activeChannelTab} Chats</span>
                  <span className="text-[10px] bg-blue-200 text-blue-800 px-1.5 py-0.2 rounded-full font-bold">
                    {channelFilteredUsers.length}
                  </span>
                </span>
                {onSelectChannelTab && (
                  <button
                    type="button"
                    onClick={() => onSelectChannelTab('all')}
                    className="text-[11px] text-blue-600 hover:underline font-medium"
                  >
                    Show All
                  </button>
                )}
              </div>
            )}

            {channelFilteredUsers.length === 0 ? (
              <div className="p-6 text-center space-y-2">
                <div className="text-gray-400 text-sm">
                  {users.length === 0
                    ? t('sidebar.noChats')
                    : `No active ${activeChannelTab} chats.`}
                </div>
                {activeChannelTab !== 'all' && onSelectChannelTab && users.length > 0 && (
                  <button
                    type="button"
                    onClick={() => onSelectChannelTab('all')}
                    className="text-xs text-blue-600 hover:underline font-semibold block mx-auto"
                  >
                    View All Chats ({users.length})
                  </button>
                )}
              </div>
            ) : (
              channelFilteredUsers.map((userId) => {
                const online = isUserOnline(userId);
                const info = usersInfo[userId] || {};
                const channel = getUserChannel(userId, info);
                const aiStatus = state.sessionAiStatuses?.[userId];
                const isEscalated = aiStatus === 'escalated' || aiStatus === 'human_active';
                const unreadCount = Number(notifications[userId]) || (notifications[userId] ? 1 : 0);
                const hasUnread = unreadCount > 0;

                return (
                  <div
                    key={userId}
                    onClick={() => onSelectUser(userId)}
                    className={`p-3 border-b border-gray-100 cursor-pointer hover:bg-gray-50 transition relative ${
                      activeUserId === userId
                        ? 'bg-blue-50 border-l-4 border-l-blue-600'
                        : hasUnread
                        ? 'bg-red-50/40 border-l-4 border-l-red-500 hover:bg-red-50/60'
                        : ''
                    } ${!online ? 'opacity-70' : ''}`}
                  >
                    <div className="flex items-center gap-3">
                      {/* Avatar */}
                      <div className="relative flex-shrink-0">
                        <div className={`w-10 h-10 rounded-full flex items-center justify-center text-white font-bold ${
                          online ? 'bg-blue-600' : 'bg-gray-400'
                        }`}>
                          {getInitial(userId)}
                        </div>
                        {hasUnread && (
                          <span className="absolute -top-1.5 -right-1.5 min-w-[20px] h-[20px] px-1 bg-red-600 text-white rounded-full border-2 border-white text-[11px] font-black flex items-center justify-center shadow-xs animate-pulse z-10">
                            {unreadCount > 99 ? '99+' : unreadCount}
                          </span>
                        )}
                        {/* Online indicator */}
                        <span className={`absolute -bottom-0.5 -right-0.5 w-3.5 h-3.5 rounded-full border-2 border-white ${
                          online ? 'bg-green-500' : 'bg-gray-400'
                        }`}></span>
                      </div>

                      {/* User info */}
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center justify-between gap-1">
                          <div className={`truncate flex items-center gap-1.5 ${
                            hasUnread ? 'font-black text-gray-950 text-[14px]' : online ? 'font-medium text-gray-800' : 'font-medium text-gray-500'
                          }`}>
                            <span className="truncate">{getUserName(userId)}</span>
                            {getBotName(userId) && (
                              <span className="inline-flex rounded bg-sky-100 px-1.5 py-0.5 text-[10px] font-medium text-sky-700 flex-shrink-0">
                                {getBotName(userId)}
                              </span>
                            )}
                            {/* Online & tab active indicator */}
                            {online && (
                              <span title={isTabActive(userId) ? t('sidebar.tabActive') : t('sidebar.tabBackground')}>
                                {isTabActive(userId) ? (
                                  <svg className="w-4 h-4 text-green-500" fill="currentColor" viewBox="0 0 20 20">
                                    <path d="M10 12a2 2 0 100-4 2 2 0 000 4z" />
                                    <path fillRule="evenodd" d="M.458 10C1.732 5.943 5.522 3 10 3s8.268 2.943 9.542 7c-1.274 4.057-5.064 7-9.542 7S1.732 14.057.458 10zM14 10a4 4 0 11-8 0 4 4 0 018 0z" clipRule="evenodd" />
                                  </svg>
                                ) : (
                                  <svg className="w-4 h-4 text-gray-400" fill="currentColor" viewBox="0 0 20 20">
                                    <path fillRule="evenodd" d="M3.707 2.293a1 1 0 00-1.414 1.414l14 14a1 1 0 001.414-1.414l-1.473-1.473A10.014 10.014 0 0019.542 10C18.268 5.943 14.478 3 10 3a9.958 9.958 0 00-4.512 1.074l-1.78-1.781zm4.261 4.26l1.514 1.515a2.003 2.003 0 012.45 2.45l1.514 1.514a4 4 0 00-5.478-5.478z" clipRule="evenodd" />
                                    <path d="M12.454 16.697L9.75 13.992a4 4 0 01-3.742-3.741L2.335 6.578A9.98 9.98 0 00.458 10c1.274 4.057 5.065 7 9.542 7 .847 0 1.669-.105 2.454-.303z" />
                                  </svg>
                                )}
                              </span>
                            )}
                            {/* Notes indicator */}
                            {usersInfo[userId]?.admin_notes && (
                              <span title={usersInfo[userId].admin_notes}>
                                <svg className="w-4 h-4 text-amber-500" fill="currentColor" viewBox="0 0 20 20">
                                  <path fillRule="evenodd" d="M4 4a2 2 0 012-2h4.586A2 2 0 0112 2.586L15.414 6A2 2 0 0116 7.414V16a2 2 0 01-2 2H6a2 2 0 01-2-2V4zm2 6a1 1 0 011-1h6a1 1 0 110 2H7a1 1 0 01-1-1zm1 3a1 1 0 100 2h6a1 1 0 100-2H7z" clipRule="evenodd" />
                                </svg>
                              </span>
                            )}
                          </div>

                          {/* Channel Badge Pill & Unread Pill */}
                          <div className="flex items-center gap-1 flex-shrink-0">
                            {hasUnread && (
                              <span className="bg-red-600 text-white text-[10px] font-black px-1.5 py-0.5 rounded-full shadow-xs animate-pulse">
                                {unreadCount} new
                              </span>
                            )}
                            {isEscalated ? (
                              <span className="text-[10px] bg-rose-50 text-rose-700 px-1.5 py-0.5 rounded font-semibold border border-rose-200">
                                ⚠️ Escalated
                              </span>
                            ) : channel === 'telegram' ? (
                              <span className="text-[10px] bg-sky-50 text-sky-700 px-1.5 py-0.5 rounded font-medium border border-sky-200">
                                ✈️ Telegram
                              </span>
                            ) : channel === 'email' ? (
                              <span className="text-[10px] bg-amber-50 text-amber-700 px-1.5 py-0.5 rounded font-medium border border-amber-200">
                                ✉️ Email
                              </span>
                            ) : (
                              <span className="text-[10px] bg-blue-50 text-blue-700 px-1.5 py-0.5 rounded font-medium border border-blue-200">
                                🌐 Widget
                              </span>
                            )}
                          </div>
                        </div>
                        {usersInfo[userId]?.lastMessage ? (
                          <div className="flex items-center gap-1 mt-0.5">
                            <span className="text-xs text-gray-500 flex-shrink-0">
                              {getTimeString(usersInfo[userId].lastMessage.timestamp, config.timeFormat, config.timezone)}
                            </span>
                            <span className={`text-xs truncate ${hasUnread ? 'font-bold text-gray-900' : 'text-gray-400'}`}>
                              {usersInfo[userId].lastMessage.sender === 'support' && (
                                <span className="text-gray-500 font-normal">{t('sidebar.you')}: </span>
                              )}
                              {usersInfo[userId].lastMessage.text}
                            </span>
                          </div>
                        ) : (
                          <div className="text-xs text-gray-400 mt-0.5">{getUserEmail(userId) || userId}</div>
                        )}
                      </div>

                      {/* Edit button */}
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          setEditUserId(userId);
                        }}
                        className="p-1 text-gray-400 hover:text-green-500 hover:bg-green-50 rounded transition"
                        title={t('sidebar.editUser')}
                      >
                        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z" />
                        </svg>
                      </button>

                      {/* Delete button */}
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          setDeleteConfirm(userId);
                        }}
                        className="p-1 text-gray-400 hover:text-red-500 hover:bg-red-50 rounded transition"
                        title={t('sidebar.deleteChat')}
                      >
                        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                        </svg>
                      </button>
                    </div>
                  </div>
                );
              })
            )}
          </>
        )}
      </div>

      {/* Delete confirmation modal */}
      <ConfirmModal
        isOpen={!!deleteConfirm}
        onClose={() => setDeleteConfirm(null)}
        onConfirm={() => onDeleteUser(deleteConfirm)}
        title={t('confirm.deleteChat')}
        message={t('confirm.deleteChatMessage')}
        confirmText={t('confirm.delete')}
        cancelText={t('confirm.cancel')}
        danger
      />

      {/* Edit user modal */}
      <EditUserModal
        isOpen={!!editUserId}
        onClose={() => setEditUserId(null)}
        userId={editUserId}
        userInfo={editUserId ? usersInfo[editUserId] : null}
        onSave={onEditUser}
      />
    </aside>
  );
}
