import { useState, useCallback, useEffect, useMemo, useRef } from 'react';
import { ChatProvider, useChat } from './context/ChatContext';
import { useWebSocket } from './hooks/useWebSocket';
import { I18nProvider, useTranslation } from './i18n';
import { Login } from './components/Login';
import { Sidebar } from './components/Sidebar';
import { ChatArea } from './components/ChatArea';
import { ConfirmModal } from './components/ConfirmModal';
import { SitesManager } from './components/SitesManager';
import { Toast } from './components/Toast';
import { UpperTabBar } from './components/UpperTabBar';
import { ticketsForChat, chatIdForTicket, brandTabForConversation, conversationsForBrand, TELEGRAM_BRAND_TABS } from './utils/ticketChat';
import {
  setNotificationClickHandler,
  setNotificationEnabled,
  isNotificationEnabled,
  isNotificationSupported,
  getNotificationPermission,
  requestNotificationPermission,
  sendTestNotification
} from './utils/browserNotification';

function AppContent() {
  const { state, setActiveUser, clearNotification, addOptimisticMessage, failOptimisticMessage } = useChat();
  const { t, changeLanguage } = useTranslation();
  const [activeModal, setActiveModal] = useState(null);
  const [toast, setToast] = useState(null);
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [touchStart, setTouchStart] = useState(null);
  const [touchEnd, setTouchEnd] = useState(null);
  const [activeChannelTab, setActiveChannelTab] = useState(() => {
    const saved = localStorage.getItem('console_active_site_tab');
    return TELEGRAM_BRAND_TABS.some(tab => tab.id === saved) ? saved : 'brand:fbverse_bot';
  });
  useEffect(() => { localStorage.setItem('console_active_site_tab', activeChannelTab); }, [activeChannelTab]);
  const [tickets, setTickets] = useState([]);
  const [soundEnabled, setSoundEnabled] = useState(() => {
    const saved = localStorage.getItem('kaplia_sound_enabled');
    return saved !== null ? saved === 'true' : true;
  });
  const [notificationsEnabled, setNotificationsEnabled] = useState(() => isNotificationEnabled());
  const [pushPermission, setPushPermission] = useState(() => getNotificationPermission());
  const [darkMode, setDarkMode] = useState(() => localStorage.getItem('console_dark_mode') !== 'false');
  const [telegramBlocked, setTelegramBlocked] = useState(false);
  const [telegramMuted, setTelegramMuted] = useState(() => new Set(JSON.parse(localStorage.getItem('console_muted_conversations') || '[]')));
  useEffect(() => {
    document.documentElement.classList.toggle('dark', darkMode);
    localStorage.setItem('console_dark_mode', String(darkMode));
  }, [darkMode]);

  const currentInfo = state.usersInfo[state.activeUserId] || {};
  const telegramSiteId = currentInfo.site_id;
  const telegramChatId = currentInfo.user_id;
  const telegramIdentity = useMemo(() => state.activeUserId?.startsWith('telegram:') && telegramSiteId && telegramChatId ? { siteId: telegramSiteId, chatId: telegramChatId } : null, [state.activeUserId, telegramSiteId, telegramChatId]);
  useEffect(() => {
    if (!telegramIdentity || !state.config.apiToken) return;
    let cancelled = false;
    fetch(`/api/telegram/users/${encodeURIComponent(telegramSiteId)}/${encodeURIComponent(telegramChatId)}/status`, { headers: { Authorization: `Bearer ${state.config.apiToken}` } }).then(r => r.ok ? r.json() : null).then(data => { if (!cancelled && data) setTelegramBlocked(Boolean(data.blocked)); }).catch(() => {});
    return () => { cancelled = true; };
  }, [telegramIdentity, telegramSiteId, telegramChatId, state.config.apiToken]);
  const toggleTelegramBlock = async () => {
    if (!telegramIdentity) return;
    const wasBlocked = telegramBlocked;
    const method = wasBlocked ? 'DELETE' : 'PUT';
    try {
      const response = await fetch(`/api/telegram/users/${encodeURIComponent(telegramIdentity.siteId)}/${encodeURIComponent(telegramIdentity.chatId)}/block`, { method, headers: { Authorization: `Bearer ${state.config.apiToken}` } });
      const result = await response.json().catch(() => ({}));
      if (!response.ok) {
        if (result.local_blocked === true) setTelegramBlocked(true);
        showToast(telegramIdentity.siteId === 'smsotps' ? 'Block state sync failed. The local block is kept; do not treat this as synced.' : 'Block state update failed.', 'error');
        return;
      }
      if (result.synced !== true) {
        showToast('Block state was not confirmed by both systems.', 'error');
        return;
      }
      setTelegramBlocked(Boolean(result.blocked));
      showToast(result.blocked ? 'Blocked and synced.' : 'Unblocked and synced.', 'success');
    } catch {
      fetch(`/api/telegram/users/${encodeURIComponent(telegramIdentity.siteId)}/${encodeURIComponent(telegramIdentity.chatId)}/status`, { headers: { Authorization: `Bearer ${state.config.apiToken}` } })
        .then(response => response.ok ? response.json() : null)
        .then(result => { if (result) setTelegramBlocked(Boolean(result.blocked)); })
        .catch(() => {});
      showToast('Block state update could not be confirmed. Check the current state before changing it again.', 'error');
    }
  };
  const toggleTelegramMute = () => {
    if (!state.activeUserId) return;
    const next = new Set(telegramMuted);
    if (next.has(state.activeUserId)) next.delete(state.activeUserId); else next.add(state.activeUserId);
    setTelegramMuted(next); localStorage.setItem('console_muted_conversations', JSON.stringify([...next])); window.dispatchEvent(new Event('console_muted_changed'));
  };

  // Fetch full tickets list
  const fetchTickets = useCallback(async () => {
    if (!state.config.apiToken) return;
    try {
      const res = await fetch('/api/tickets', {
        headers: { Authorization: `Bearer ${state.config.apiToken}` }
      });
      if (res.ok) {
        const data = await res.json();
        const list = Array.isArray(data) ? data : [];
        setTickets(list);
      }
    } catch (err) {
      console.error('Failed to fetch tickets', err);
    }
  }, [state.config.apiToken]);

  // Periodic polling for tickets sync
  useEffect(() => {
    const initialFetch = setTimeout(fetchTickets, 0);
    const interval = setInterval(fetchTickets, 30000);
    return () => {
      clearTimeout(initialFetch);
      clearInterval(interval);
    };
  }, [fetchTickets]);

  // Real-time ticket WebSocket events
  useEffect(() => {
    const handleNewTicketEvent = (e) => {
      const newT = e.detail;
      if (newT) {
        setTickets(prev => {
          const exists = prev.some(t => t.id === newT.id);
          if (exists) return prev.map(t => t.id === newT.id ? { ...t, ...newT } : t);
          return [newT, ...prev];
        });
      } else {
        fetchTickets();
      }
    };

    const handleTicketsClearedEvent = () => {
      setTickets([]);
    };

    const handleTicketReadEvent = (e) => {
      const id = e.detail?.id;
      if (id) {
        setTickets(prev => prev.map(t => t.id === id ? { ...t, is_read: 1 } : t));
      }
    };

    const handleTicketDeletedEvent = (e) => {
      const id = e.detail?.id;
      if (id) {
        setTickets(prev => {
          const updated = prev.filter(t => t.id !== id);
          return updated;
        });
      }
    };

    window.addEventListener('new_ticket_event', handleNewTicketEvent);
    window.addEventListener('tickets_cleared_event', handleTicketsClearedEvent);
    window.addEventListener('ticket_read_event', handleTicketReadEvent);
    window.addEventListener('ticket_deleted_event', handleTicketDeletedEvent);

    return () => {
      window.removeEventListener('new_ticket_event', handleNewTicketEvent);
      window.removeEventListener('tickets_cleared_event', handleTicketsClearedEvent);
      window.removeEventListener('ticket_read_event', handleTicketReadEvent);
      window.removeEventListener('ticket_deleted_event', handleTicketDeletedEvent);
    };
  }, [fetchTickets]);

  // Per-brand Telegram counts and unread badges.
  const counts = useMemo(() => {
    const result = {};
    for (const tab of TELEGRAM_BRAND_TABS) {
      const conversations = conversationsForBrand(state.users, state.usersInfo, tab.id);
      result[tab.id] = {
        total: conversations.length,
        unread: conversations.reduce((sum, userId) => sum + (Number(state.notifications?.[userId]) || 0), 0),
      };
    }
    return result;
  }, [state.users, state.usersInfo, state.notifications]);

  // Sync language with config from server
  useEffect(() => {
    if (state.config.language) {
      changeLanguage(state.config.language);
    }
  }, [state.config.language, changeLanguage]);

  const showToast = (message, type = 'error') => {
    setToast({ message, type });
  };

  const handleSystemMessage = useCallback((text) => {
    showToast(text, 'success');
  }, []);

  const {
    connect,
    disconnect,
    sendReply,
    getHistory,
    loadMoreHistory,
    deleteMessage,
    deleteSession,
    deleteSystemMessages,
    sendAdminTyping,
    updateUserInfoFromAdmin,
    searchChats,
    setSearchResultsHandler,
  } = useWebSocket(handleSystemMessage, soundEnabled);

  const handleSelectUser = useCallback((userId) => {
    setActiveChannelTab(brandTabForConversation(userId, state.usersInfo[userId] || {}));
    setActiveUser(userId);
    clearNotification(userId);
    getHistory(userId);
    // Close sidebar on mobile after selecting user
    setSidebarOpen(false);
  }, [state.usersInfo, setActiveUser, clearNotification, getHistory]);

  const handleTicketViewed = useCallback(async (ticketId) => {
    setTickets(prev => prev.map(ticket => ticket.id === ticketId ? { ...ticket, is_read: 1 } : ticket));
    try {
      await fetch(`/api/tickets/${ticketId}/read`, {
        method: 'PUT',
        headers: { Authorization: `Bearer ${state.config.apiToken}` }
      });
    } catch (err) {
      console.error('Failed to mark ticket as read', err);
    }
  }, [state.config.apiToken]);

  // Set up browser notification click handler
  useEffect(() => {
    setNotificationClickHandler((targetId) => {
      if (typeof targetId === 'string' && targetId.startsWith('ticket_')) {
        const ticketId = parseInt(targetId.replace('ticket_', ''), 10);
        const ticket = tickets.find(item => item.id === ticketId);
        const chatId = chatIdForTicket(ticket, state.users, state.usersInfo);
        if (chatId) {
          handleSelectUser(chatId);
          if (!ticket.is_read || ticket.is_read === 0) handleTicketViewed(ticketId);
        } else showToast('This ticket is not linked to an active chat.', 'error');
        return;
      }
      handleSelectUser(targetId);
    });
  }, [tickets, state.users, state.usersInfo, handleSelectUser, handleTicketViewed]);

  const handleSelectTab = (tabId) => {
    if (!TELEGRAM_BRAND_TABS.some(tab => tab.id === tabId)) return;
    setActiveChannelTab(tabId);
    const activeInfo = state.usersInfo[state.activeUserId] || {};
    if (state.activeUserId && brandTabForConversation(state.activeUserId, activeInfo) !== tabId) {
      setActiveUser(null);
    }
  };

  const handleTogglePush = async () => {
    if (!isNotificationSupported()) {
      showToast('Desktop Web Push Notifications are not supported in this browser.', 'error');
      return;
    }

    const currentPerm = getNotificationPermission();
    if (currentPerm === 'denied') {
      showToast('Desktop Notifications are blocked. Please click the site settings lock in your browser URL bar to allow notifications.', 'error');
      return;
    }

    if (currentPerm !== 'granted') {
      const perm = await requestNotificationPermission();
      setPushPermission(perm);
      if (perm === 'granted') {
        setNotificationsEnabled(true);
        setNotificationEnabled(true);
        sendTestNotification();
        showToast('Web Push Notifications enabled! Test alert sent.', 'success');
      } else {
        showToast('Notification permission was not granted.', 'error');
      }
      return;
    }

    if (!notificationsEnabled) {
      setNotificationsEnabled(true);
      setNotificationEnabled(true);
      sendTestNotification();
      showToast('Web Push Notifications active! Test alert sent.', 'success');
    } else {
      sendTestNotification();
      showToast('Test push notification dispatched to your desktop!', 'success');
    }
  };

  const handleSoundEnabledChange = (enabled) => {
    setSoundEnabled(enabled);
    localStorage.setItem('kaplia_sound_enabled', String(enabled));
  };

  const handleLogin = (password, rememberMe) => {
    return connect(password, () => {
      // Called on auth error (connection closed without auth_success)
      showToast(t('login.error'), 'error');
    }, rememberMe);
  };



  // Swipe handling
  const minSwipeDistance = 50;

  const onTouchStart = (e) => {
    setTouchEnd(null);
    setTouchStart(e.targetTouches[0].clientX);
  };

  const onTouchMove = (e) => {
    setTouchEnd(e.targetTouches[0].clientX);
  };

  const onTouchEnd = () => {
    if (!touchStart || !touchEnd) return;
    const distance = touchStart - touchEnd;
    const isLeftSwipe = distance > minSwipeDistance;
    const isRightSwipe = distance < -minSwipeDistance;

    if (isRightSwipe && !sidebarOpen) {
      setSidebarOpen(true);
    } else if (isLeftSwipe && sidebarOpen) {
      setSidebarOpen(false);
    }
  };

  const handleDeleteUser = (userId) => {
    deleteSession(userId);
  };

  const replyIdRef = useRef(0);
  const handleSendMessage = async (targetId, text) => {
    const imageData = typeof text === 'string' ? text : (text && typeof text.imageData === 'string' ? text.imageData : '');
    if (imageData.startsWith('data:image/')) {
      const match = /^data:(image\/(?:jpeg|png|gif|webp));base64,([\s\S]+)$/.exec(imageData);
      if (!match) { showToast('Unsupported image format.', 'error'); return false; }
      try {
        const binary = atob(match[2]);
        const bytes = new Uint8Array(binary.length);
        for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
        const info = state.usersInfo[targetId] || {};
        const siteId = info.site_id;
        const chatId = info.user_id;
        if (!siteId || !chatId) { showToast('Image reply target is unavailable.', 'error'); return false; }
        const caption = typeof text === 'object' && typeof text.caption === 'string' ? text.caption : '';
        const response = await fetch(`/api/telegram/users/${encodeURIComponent(siteId)}/${encodeURIComponent(chatId)}/send-photo`, { method: 'POST', headers: { Authorization: `Bearer ${state.config.apiToken}`, 'Content-Type': match[1], ...(caption ? { 'X-Image-Caption-Encoded': encodeURIComponent(caption) } : {}) }, body: bytes });
        if (!response.ok) { const data = await response.json().catch(() => ({})); throw new Error(data.error === 'telegram_bot_unavailable' ? 'Telegram bot unavailable.' : data.error === 'unsupported_image_type' ? 'Use a JPEG, PNG, GIF, or WebP image.' : `Image send failed (${response.status}).`); }
        showToast('Image sent.', 'success');
        return true;
      } catch (error) { showToast(error.message || 'Image send failed. Please retry.', 'error'); return false; }
    }
    replyIdRef.current += 1;
    const clientMessageId = `${targetId}:${Date.now()}:${replyIdRef.current}`;
    addOptimisticMessage({ id: `pending:${clientMessageId}`, clientMessageId, userId: targetId, sender: 'internal_team', text, timestamp: new Date().toISOString(), status: 'pending' });
    if (!sendReply(targetId, text, clientMessageId)) {
      failOptimisticMessage(targetId, clientMessageId);
      getHistory(targetId);
      showToast('Send unconfirmed. Check the conversation before retrying.', 'error');
      return false;
    }
    return true;
  };

  const handleDeleteMessage = (msgId, targetId) => {
    deleteMessage(msgId, targetId);
  };

  const handleOpenSites = () => {
    setActiveModal('sites');
  };

  const handleCloseModal = () => {
    setActiveModal(null);
  };

  const handleLogout = () => {
    setActiveModal('logout');
  };

  const confirmLogout = () => {
    showToast(t('toast.logoutSuccess'), 'success');
    disconnect();
  };

  const handleLoadMore = () => {
    if (state.messages.length > 0 && state.activeUserId) {
      const oldestMsgId = state.messages[0].id;
      loadMoreHistory(state.activeUserId, oldestMsgId);
    }
  };

  const handleDeleteSystemMessages = () => {
    if (state.activeUserId) {
      deleteSystemMessages(state.activeUserId);
    }
  };



  const handleUpdateTicketStatus = useCallback(async (ticketId, currentStatus) => {
    const nextStatus = currentStatus === 'resolved' ? 'open' : 'resolved';
    const resolution = nextStatus === 'resolved' ? 'Resolved by admin' : '';
    try {
      const res = await fetch(`/api/tickets/${ticketId}`, {
        method: 'PUT',
        headers: {
          Authorization: `Bearer ${state.config.apiToken}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ status: nextStatus, resolution })
      });
      if (res.ok) setTickets(prev => prev.map(ticket => ticket.id === ticketId ? { ...ticket, status: nextStatus, resolution_notes: resolution } : ticket));
    } catch (err) {
      console.error('Failed to update ticket status', err);
    }
  }, [state.config.apiToken]);

  if (state.isAuthChecking) {
    return <div className="min-h-screen bg-gray-100 dark:bg-gray-950 flex items-center justify-center text-gray-500 dark:text-gray-300" aria-label="Restoring session"><div className="h-7 w-7 rounded-full border-2 border-gray-300 border-t-blue-600 animate-spin" /></div>;
  }

  if (!state.isAuthenticated) {
    return (
      <>
        <Login onLogin={handleLogin} />
        {toast && (
          <Toast
            message={toast.message}
            type={toast.type}
            onClose={() => setToast(null)}
          />
        )}
      </>
    );
  }

  return (
    <div className="flex flex-col h-screen bg-gray-100 dark:bg-[#0b1120] overflow-hidden">
      {/* Upper Navigation Tabs Bar */}
      <UpperTabBar
        activeTab={activeChannelTab}
        onSelectTab={handleSelectTab}
        counts={counts}
        onOpenSites={handleOpenSites}
        onLogout={handleLogout}
        soundEnabled={soundEnabled}
        onToggleSound={() => handleSoundEnabledChange(!soundEnabled)}
        pushEnabled={notificationsEnabled && pushPermission === 'granted'}
        pushPermission={pushPermission}
        onTogglePush={handleTogglePush}
        darkMode={darkMode}
        onToggleDarkMode={() => setDarkMode(value => !value)}
      />

      {/* Main Workspace */}
      <div
        className="flex flex-1 min-h-0 relative"
        onTouchStart={onTouchStart}
        onTouchMove={onTouchMove}
        onTouchEnd={onTouchEnd}
      >
        {/* Mobile overlay when sidebar is open */}
        {sidebarOpen && (
          <div
            className="fixed inset-0 bg-black/50 z-20 md:hidden"
            onClick={() => setSidebarOpen(false)}
          />
        )}

        {/* Sidebar */}
        <div className={`
          fixed md:relative inset-y-0 left-0 z-30
          transform transition-transform duration-300 ease-in-out
          ${sidebarOpen ? 'translate-x-0' : '-translate-x-full'}
          md:translate-x-0 flex-shrink-0 h-full
        `}>
          <Sidebar
            onSelectUser={(userId) => {
              handleSelectUser(userId);
            }}
            onDeleteUser={handleDeleteUser}
            onEditUser={updateUserInfoFromAdmin}
            onSearch={searchChats}
            onSearchResultsHandler={setSearchResultsHandler}
            activeChannelTab={activeChannelTab}
            onSelectChannelTab={handleSelectTab}
            tickets={tickets}
          />
        </div>

        {/* Live chat and its related support tickets */}
        <div className="flex-1 flex flex-col min-w-0 h-full overflow-hidden bg-white dark:bg-[#151f30]">
          <ChatArea
            onSendMessage={handleSendMessage}
            onDeleteMessage={handleDeleteMessage}
            onLoadMore={handleLoadMore}
            onDeleteSystemMessages={handleDeleteSystemMessages}
            telegramBlocked={telegramBlocked}
            onToggleTelegramBlock={toggleTelegramBlock}
            telegramMuted={telegramMuted.has(state.activeUserId)}
            onToggleTelegramMute={toggleTelegramMute}
            onOpenSidebar={() => setSidebarOpen(true)}
            sidebarOpen={sidebarOpen}
            onAdminTyping={sendAdminTyping}
            tickets={ticketsForChat(tickets, state.activeUserId, state.usersInfo[state.activeUserId] || {})}
            onTicketViewed={handleTicketViewed}
            onTicketStatusChange={handleUpdateTicketStatus}
          />
        </div>
      </div>

      <footer title="Release v0.12.6" className="shrink-0 px-3 py-1 text-[10px] text-slate-500 text-right bg-white dark:bg-[#0b1120] border-t border-gray-200 dark:border-slate-700">AKUniverse Console · v0.12.6</footer>

      {/* Modals */}
      <ConfirmModal
        isOpen={activeModal === 'logout'}
        onClose={handleCloseModal}
        onConfirm={confirmLogout}
        title={t('confirm.logoutTitle')}
        message={t('confirm.logoutMessage')}
        confirmText={t('sidebar.logout')}
        cancelText={t('confirm.cancel')}
      />
      <SitesManager
        isOpen={activeModal === 'sites'}
        onClose={handleCloseModal}
        apiToken={state.config.apiToken}
      />

      {/* Toast notifications */}
      {toast && (
        <Toast
          message={toast.message}
          type={toast.type}
          onClose={() => setToast(null)}
        />
      )}
    </div>
  );
}

function AppWithI18n() {
  const { state } = useChat();
  return (
    <I18nProvider initialLanguage={state.config.language || 'en'}>
      <AppContent />
    </I18nProvider>
  );
}

function App() {
  return (
    <ChatProvider>
      <AppWithI18n />
    </ChatProvider>
  );
}

export default App;
