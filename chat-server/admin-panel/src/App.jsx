import { useState, useCallback, useEffect, useMemo } from 'react';
import { ChatProvider, useChat } from './context/ChatContext';
import { useWebSocket } from './hooks/useWebSocket';
import { I18nProvider, useTranslation } from './i18n';
import { Login } from './components/Login';
import { Sidebar, getUserChannel } from './components/Sidebar';
import { ChatArea } from './components/ChatArea';
import { OptionsModal } from './components/OptionsModal';
import { ConfirmModal } from './components/ConfirmModal';
import { SitesManager } from './components/SitesManager';
import { Toast } from './components/Toast';
import { UpperTabBar } from './components/UpperTabBar';
import { TicketsDesk } from './components/TicketsDesk';
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
  const { state, setActiveUser, clearNotification, setConfig } = useChat();
  const { t, changeLanguage } = useTranslation();
  const [activeModal, setActiveModal] = useState(null);
  const [toast, setToast] = useState(null);
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [touchStart, setTouchStart] = useState(null);
  const [touchEnd, setTouchEnd] = useState(null);
  const [activeChannelTab, setActiveChannelTab] = useState('all');
  const [tickets, setTickets] = useState([]);
  const [activeTicketId, setActiveTicketId] = useState(null);
  const [soundEnabled, setSoundEnabled] = useState(() => {
    const saved = localStorage.getItem('kaplia_sound_enabled');
    return saved !== null ? saved === 'true' : true;
  });
  const [soundType, setSoundType] = useState(() => {
    return localStorage.getItem('kaplia_sound_type') || 'chime';
  });
  const [notificationsEnabled, setNotificationsEnabled] = useState(() => isNotificationEnabled());
  const [pushPermission, setPushPermission] = useState(() => getNotificationPermission());

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
        setActiveTicketId(prev => {
          if (prev && list.some(t => t.id === prev)) return prev;
          return list.length > 0 ? list[0].id : null;
        });
      }
    } catch (err) {
      console.error('Failed to fetch tickets', err);
    }
  }, [state.config.apiToken]);

  // Periodic polling for tickets sync
  useEffect(() => {
    fetchTickets();
    const interval = setInterval(fetchTickets, 30000);
    return () => clearInterval(interval);
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
      setActiveTicketId(null);
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
          setActiveTicketId(current => (current === id ? (updated[0]?.id || null) : current));
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

  // Tab counts & unread calculation
  const counts = useMemo(() => {
    let widget = 0;
    let telegram = 0;
    let email = 0;
    let escalated = 0;

    let unreadAll = 0;
    let unreadWidget = 0;
    let unreadTelegram = 0;
    let unreadEmail = 0;
    let unreadEscalated = 0;

    (state.users || []).forEach((userId) => {
      const info = state.usersInfo[userId] || {};
      const ch = getUserChannel(userId, info);
      const unread = typeof state.notifications?.[userId] === 'number'
        ? state.notifications[userId]
        : (state.notifications?.[userId] ? 1 : 0);

      unreadAll += unread;

      if (ch === 'telegram') {
        telegram++;
        unreadTelegram += unread;
      } else if (ch === 'email') {
        email++;
        unreadEmail += unread;
      } else {
        widget++;
        unreadWidget += unread;
      }

      const aiStatus = state.sessionAiStatuses?.[userId];
      if (aiStatus === 'escalated' || aiStatus === 'human_active') {
        escalated++;
        unreadEscalated += unread;
      }
    });

    const unreadTickets = tickets.filter(t => !t.is_read || t.is_read === 0).length;

    return {
      all: { total: state.users.length, unread: unreadAll },
      widget: { total: widget, unread: unreadWidget },
      telegram: { total: telegram, unread: unreadTelegram },
      email: { total: email, unread: unreadEmail },
      tickets: { total: tickets.length, unread: unreadTickets },
      escalated: { total: escalated, unread: unreadEscalated }
    };
  }, [state.users, state.usersInfo, state.notifications, state.sessionAiStatuses, tickets]);

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
    changePassword,
    changeApiToken,
    updateWebhook,
    updateTimeSettings,
    updateRealtimeTyping,
    updateSystemLogs,
    updateLanguage,
    updateAllowedOrigins,
    updateAnonymousOrigins,
    updateRateLimit,
    updateMessageLimits,
    updateBusinessHours,
    updateSmtp,
    updateTelegramSettings,
    updateTelegramBots,
    toggleTelegramBot,
    testSmtp,
    sendAdminTyping,
    updateUserInfoFromAdmin,
    searchChats,
    setSearchResultsHandler,
    resumeAI,
    pauseAI,
  } = useWebSocket(handleSystemMessage, soundEnabled);

  // Set up browser notification click handler
  useEffect(() => {
    setNotificationClickHandler((targetId) => {
      if (typeof targetId === 'string' && targetId.startsWith('ticket_')) {
        const ticketId = parseInt(targetId.replace('ticket_', ''), 10);
        setActiveChannelTab('tickets');
        if (ticketId) {
          setActiveTicketId(ticketId);
          setTickets(prev => prev.map(t => t.id === ticketId ? { ...t, is_read: 1 } : t));
        }
        setSidebarOpen(false);
        return;
      }
      setActiveChannelTab('all');
      setActiveUser(targetId);
      clearNotification(targetId);
      getHistory(targetId);
      setSidebarOpen(false);
    });
  }, [setActiveUser, clearNotification, getHistory]);

  const handleSelectTab = (tabId) => {
    setActiveChannelTab(tabId);
    if (tabId === 'tickets') {
      setActiveTicketId(prev => (prev || (tickets.length > 0 ? tickets[0].id : null)));
    }
  };

  const handleNotificationsEnabledChange = async (enabled) => {
    if (enabled && isNotificationSupported()) {
      const permission = await requestNotificationPermission();
      setPushPermission(permission);
      if (permission !== 'granted') {
        return;
      }
    }
    setNotificationsEnabled(enabled);
    setNotificationEnabled(enabled);
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

  const handleSoundTypeChange = (type) => {
    setSoundType(type);
    localStorage.setItem('kaplia_sound_type', type);
  };

  const handleLogin = (password, rememberMe) => {
    return connect(password, () => {
      // Called on auth error (connection closed without auth_success)
      showToast(t('login.error'), 'error');
    }, rememberMe);
  };

  const handleSelectUser = (userId) => {
    setActiveUser(userId);
    clearNotification(userId);
    getHistory(userId);
    // Close sidebar on mobile after selecting user
    setSidebarOpen(false);
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

  const handleSendMessage = (targetId, text) => {
    sendReply(targetId, text);
  };

  const handleDeleteMessage = (msgId, targetId) => {
    deleteMessage(msgId, targetId);
  };

  const handleOpenSettings = (type) => {
    setActiveModal(type);
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

  const handleSavePassword = (newPassword) => {
    changePassword(newPassword);
    localStorage.setItem('ak_chat_admin_pass', newPassword);
    localStorage.setItem('kaplia_admin_pass', newPassword);
  };

  const handleSaveToken = (newToken) => {
    changeApiToken(newToken);
    setConfig({ apiToken: newToken });
  };

  const handleSaveWebhook = (url, enabled) => {
    updateWebhook(url, enabled);
    setConfig({ webhookUrl: url, webhookEnabled: enabled });
  };

  const handleSaveRealtimeTyping = (enabled) => {
    updateRealtimeTyping(enabled);
    setConfig({ realtimeTyping: enabled });
  };

  const handleSaveSystemLogs = (setting, enabled) => {
    updateSystemLogs(setting, enabled);
    setConfig({
      systemLogs: {
        ...state.config.systemLogs,
        [setting]: enabled
      }
    });
  };

  const handleSaveLanguage = (language) => {
    updateLanguage(language);
    setConfig({ language });
    changeLanguage(language);
  };

  const handleSaveAllowedOrigins = (origins) => {
    updateAllowedOrigins(origins);
    setConfig({ allowedOrigins: origins });
  };

  const handleSaveAnonymousOrigins = (origins) => {
    updateAnonymousOrigins(origins);
    setConfig({ allowedAnonymousOrigins: origins });
  };

  const handleSaveRateLimit = (maxMessagesPerMinute, maxMessageLength) => {
    updateRateLimit(maxMessagesPerMinute, maxMessageLength);
    setConfig({ maxMessagesPerMinute, maxMessageLength });
  };

  const handleSaveMessageLimits = (adminMessagesLimit, widgetMessagesLimit) => {
    updateMessageLimits(adminMessagesLimit, widgetMessagesLimit);
    setConfig({ adminMessagesLimit, widgetMessagesLimit });
  };

  const handleSaveBusinessHours = (businessHours) => {
    updateBusinessHours(businessHours);
    setConfig({ businessHours });
  };

  const handleSaveSmtp = (smtpCfg) => {
    updateSmtp(smtpCfg);
    setConfig({ smtpConfig: smtpCfg });
  };

  const handleTestSmtp = (smtpCfg) => {
    testSmtp(smtpCfg);
  };

  const handleSaveTelegram = (telegramCfg) => {
    const nextTelegramConfig = {
      ...state.config.telegramConfig,
      botToken: telegramCfg.botToken,
      chatId: telegramCfg.chatId,
    };
    updateTelegramSettings(nextTelegramConfig);
    setConfig({ telegramConfig: nextTelegramConfig });
  };

  const handleToggleTelegramBot = (enabled) => {
    toggleTelegramBot(enabled);
  };

  const handleSaveTelegramBots = (bots) => {
    updateTelegramBots(bots);
    setConfig({ telegramConfig: { ...state.config.telegramConfig, bots } });
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

  const handleSaveTimeSettings = (timezone, dateFormat, timeFormat) => {
    updateTimeSettings(timezone, dateFormat, timeFormat);
    setConfig({ timezone, dateFormat, timeFormat });
  };

  // Ticket Action Handlers
  const handleSelectTicket = useCallback(async (ticketId) => {
    setActiveTicketId(ticketId);
    // Optimistic read status update
    setTickets(prev => prev.map(t => t.id === ticketId ? { ...t, is_read: 1 } : t));
    try {
      await fetch(`/api/tickets/${ticketId}/read`, {
        method: 'PUT',
        headers: { Authorization: `Bearer ${state.config.apiToken}` }
      });
    } catch (err) {
      console.error('Failed to mark ticket as read', err);
    }
  }, [state.config.apiToken]);

  const handleClearAllTickets = useCallback(async () => {
    if (!window.confirm('Are you sure you want to permanently clear ALL tickets from the database? This cannot be undone.')) {
      return;
    }
    try {
      const res = await fetch('/api/tickets', {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${state.config.apiToken}` }
      });
      if (res.ok) {
        setTickets([]);
        setActiveTicketId(null);
        showToast('All tickets permanently cleared from database', 'success');
      } else {
        showToast('Failed to clear tickets', 'error');
      }
    } catch (err) {
      console.error('Failed to clear all tickets', err);
      showToast('Error clearing tickets', 'error');
    }
  }, [state.config.apiToken]);

  const handleDeleteTicket = useCallback(async (ticketId) => {
    if (!window.confirm(`Delete ticket #${ticketId}?`)) return;
    try {
      const res = await fetch(`/api/tickets/${ticketId}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${state.config.apiToken}` }
      });
      if (res.ok) {
        setTickets(prev => {
          const updated = prev.filter(t => t.id !== ticketId);
          setActiveTicketId(current => (current === ticketId ? (updated[0]?.id || null) : current));
          return updated;
        });
        showToast(`Ticket #${ticketId} deleted`, 'success');
      }
    } catch (err) {
      console.error('Failed to delete ticket', err);
    }
  }, [state.config.apiToken]);

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
      if (res.ok) {
        setTickets(prev => prev.map(t => t.id === ticketId ? { ...t, status: nextStatus, resolution_notes: resolution } : t));
        showToast(`Ticket #${ticketId} marked as ${nextStatus}`, 'success');
      }
    } catch (err) {
      console.error('Failed to update ticket status', err);
    }
  }, [state.config.apiToken]);

  const selectedTicket = useMemo(() => {
    return tickets.find(t => t.id === activeTicketId) || (tickets.length > 0 ? tickets[0] : null);
  }, [tickets, activeTicketId]);

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
    <div className="flex flex-col h-screen bg-gray-100 overflow-hidden">
      {/* Upper Navigation Tabs Bar */}
      <UpperTabBar
        activeTab={activeChannelTab}
        onSelectTab={handleSelectTab}
        counts={counts}
        onOpenSites={handleOpenSites}
        onOpenSettings={() => handleOpenSettings('options')}
        onLogout={handleLogout}
        soundEnabled={soundEnabled}
        onToggleSound={() => handleSoundEnabledChange(!soundEnabled)}
        pushEnabled={notificationsEnabled && pushPermission === 'granted'}
        pushPermission={pushPermission}
        onTogglePush={handleTogglePush}
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
              if (activeChannelTab === 'tickets') {
                setActiveChannelTab('all');
              }
              handleSelectUser(userId);
            }}
            onDeleteUser={handleDeleteUser}
            onEditUser={updateUserInfoFromAdmin}
            onOpenSettings={handleOpenSettings}
            onOpenSites={handleOpenSites}
            onLogout={handleLogout}
            onSearch={searchChats}
            onSearchResultsHandler={setSearchResultsHandler}
            activeChannelTab={activeChannelTab}
            onSelectChannelTab={handleSelectTab}
            tickets={tickets}
            activeTicketId={activeTicketId}
            onSelectTicket={handleSelectTicket}
            onClearAllTickets={handleClearAllTickets}
          />
        </div>

        {/* Workspace: Right-Side Ticket Inspector OR Live Chat Area */}
        <div className="flex-1 flex flex-col min-w-0 h-full overflow-hidden bg-white">
          {activeChannelTab === 'tickets' ? (
            <TicketsDesk
              ticket={selectedTicket}
              tickets={tickets}
              apiToken={state.config.apiToken}
              onUpdateStatus={handleUpdateTicketStatus}
              onDeleteTicket={handleDeleteTicket}
              onClearAllTickets={handleClearAllTickets}
              onOpenChat={(userId) => {
                setActiveChannelTab('all');
                handleSelectUser(userId);
              }}
            />
          ) : (
            <ChatArea
              onSendMessage={handleSendMessage}
              onDeleteMessage={handleDeleteMessage}
              onLoadMore={handleLoadMore}
              onDeleteSystemMessages={handleDeleteSystemMessages}
              onOpenSidebar={() => setSidebarOpen(true)}
              sidebarOpen={sidebarOpen}
              onAdminTyping={sendAdminTyping}
              onResumeAI={resumeAI}
              onPauseAI={pauseAI}
            />
          )}
        </div>
      </div>

      {/* Modals */}
      <OptionsModal
        isOpen={activeModal === 'options'}
        onClose={handleCloseModal}
        config={state.config}
        onSavePassword={handleSavePassword}
        onSaveToken={handleSaveToken}
        onSaveWebhook={handleSaveWebhook}
        onSaveTimeSettings={handleSaveTimeSettings}
        onSaveRealtimeTyping={handleSaveRealtimeTyping}
        onSaveSystemLogs={handleSaveSystemLogs}
        onSaveLanguage={handleSaveLanguage}
        onSaveAllowedOrigins={handleSaveAllowedOrigins}
        onSaveAnonymousOrigins={handleSaveAnonymousOrigins}
        onSaveRateLimit={handleSaveRateLimit}
        onSaveMessageLimits={handleSaveMessageLimits}
        onSaveBusinessHours={handleSaveBusinessHours}
        onSaveSmtp={handleSaveSmtp}
        onSaveTelegram={handleSaveTelegram}
        onSaveTelegramBots={handleSaveTelegramBots}
        onToggleTelegramBot={handleToggleTelegramBot}
        onTestSmtp={handleTestSmtp}
        soundEnabled={soundEnabled}
        onSoundEnabledChange={handleSoundEnabledChange}
        soundType={soundType}
        onSoundTypeChange={handleSoundTypeChange}
        notificationsEnabled={notificationsEnabled}
        onNotificationsEnabledChange={handleNotificationsEnabledChange}
        onCopyToken={() => showToast(t('settings.token.copied'), 'success')}
      />
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
