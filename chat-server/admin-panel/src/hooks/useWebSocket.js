import { useRef, useCallback, useEffect } from 'react';
import { useChat } from '../context/ChatContext';
import { playNotificationSound } from '../utils/notificationSound';
import { startTitleFlash } from '../utils/titleNotification';
import { showBrowserNotification } from '../utils/browserNotification';

export function useWebSocket(onSystemMessage, soundEnabled = true) {
  const soundEnabledRef = useRef(soundEnabled);
  const wsRef = useRef(null);
  const activeUserIdRef = useRef(null);
  const handleMessageRef = useRef(null);
  const onAuthErrorRef = useRef(null);
  const onSystemMessageRef = useRef(onSystemMessage);
  const passwordRef = useRef(null);
  const reconnectTimeoutRef = useRef(null);
  const connectRef = useRef(null);
  const isManualDisconnectRef = useRef(false);
  const onSearchResultsRef = useRef(null);
  const usersInfoRef = useRef({});
  const {
    state,
    setAuthenticated,
    setAuthChecking,
    setConfig,
    setUsers,
    addUser,
    updateUserInfo,
    removeUser,
    setMessages,
    prependMessages,
    setLoadingMore,
    addMessage,
    deleteMessage,
    deleteSystemMessagesFromState,
    setTyping,
    setNotification,
    setUserOnline,
    setTabActive,
  } = useChat();

  // Keep refs in sync with state
  useEffect(() => {
    activeUserIdRef.current = state.activeUserId;
  }, [state.activeUserId]);

  useEffect(() => {
    usersInfoRef.current = state.usersInfo;
  }, [state.usersInfo]);

  const handleMessage = useCallback((data) => {
    switch (data.type) {
      case 'auth_success':
        setAuthenticated(true);
        setConfig({
          webhookUrl: data.webhookConfig?.url || '',
          webhookEnabled: data.webhookConfig?.enabled || false,
          apiToken: data.apiToken || '',
          timezone: data.timezone || '0',
          dateFormat: data.dateFormat || 'd.m.Y',
          timeFormat: data.timeFormat || 'H:i',
          realtimeTyping: data.realtimeTyping || false,
          systemLogs: data.systemLogs || { onlineStatus: true, tabActivity: true, chatWidget: true, pageVisits: true },
          allowedOrigins: data.allowedOrigins || '',
          allowedAnonymousOrigins: data.allowedAnonymousOrigins || '',
          maxMessagesPerMinute: data.maxMessagesPerMinute || 20,
          maxMessageLength: data.maxMessageLength || 1000,
          language: data.language || 'en',
          telegramConfig: data.telegramConfig || { botToken: '', chatId: '', enabled: false, lastUpdateId: 0, bots: [] },
        });
        if (onSystemMessageRef.current) {
          onSystemMessageRef.current('Authentication successful!');
        }
        break;

      case 'user_list':
        setUsers(data.users || []);
        break;

      case 'new_user':
        addUser(data.id);
        break;

      case 'user_connected':
        // User opened page with widget - mark as online
        addUser(data.id);
        setUserOnline(data.id, true);
        // Add system message to chat if this is the active user
        if (data.id === activeUserIdRef.current && data.msgId) {
          addMessage({
            id: data.msgId,
            userId: data.id,
            sender: 'system',
            text: 'user_connected',
            timestamp: data.timestamp,
          });
        }
        break;

      case 'user_info_update':
        addUser(data.id);
        setUserOnline(data.id, true);
        updateUserInfo(data.id, data.info);
        break;

      case 'user_left':
        // User disconnected - mark as offline but don't remove from list
        setUserOnline(data.id, false);
        // Add system message to chat if this is the active user
        if (data.id === activeUserIdRef.current && data.msgId) {
          addMessage({
            id: data.msgId,
            userId: data.id,
            sender: 'system',
            text: 'user_left',
            timestamp: data.timestamp,
          });
        }
        break;

      case 'client_msg': {
        // Add user first (before updating info to avoid overwriting)
        addUser(data.from);
        // Mark user as online since they sent a message
        setUserOnline(data.from, true);
        // Update user info if provided
        if (data.info) {
          updateUserInfo(data.from, data.info);
        }
        updateUserInfo(data.from, { lastMessage: { text: data.text, timestamp: data.timestamp, sender: 'client' } });
        // Add message only if it's from the active chat
        if (data.from === activeUserIdRef.current) {
          addMessage({
            id: data.id,
            userId: data.from,
            sender: 'client',
            text: data.text,
            timestamp: data.timestamp,
          });
        }
        // Keep unread state current for chats outside the active conversation
        if (data.from !== activeUserIdRef.current) {
          setNotification(data.from, true);
        }
        // Play notification sound and flash tab title
        const mutedChats = new Set(JSON.parse(localStorage.getItem('console_muted_conversations') || '[]'));
        const isMuted = mutedChats.has(data.from);
        if (!isMuted && soundEnabledRef.current) {
          playNotificationSound();
        }
        if (!isMuted) startTitleFlash();
        // Desktop Web Push Browser notification
        {
          const info = data.info || usersInfoRef.current[data.from] || {};
          const name = info.user_name || info.name || data.from;
          if (!isMuted) showBrowserNotification(`💬 ${name}`, data.text, data.from, {
            activeUserId: activeUserIdRef.current
          });
        }
        break;
      }

      case 'client_typing':
        if (data.userId === activeUserIdRef.current) {
          setTyping(data.text || '');
        }
        break;

      case 'tab_visibility':
        // Just update UI state (no msgId means no DB save - navigation detection)
        setTabActive(data.userId, data.isActive);
        break;

      case 'system_event':
        // Delayed system event that was saved to DB (real tab switch, not navigation)
        if (data.userId === activeUserIdRef.current && data.msgId) {
          addMessage({
            id: data.msgId,
            userId: data.userId,
            sender: 'system',
            text: data.eventType,
            timestamp: data.timestamp,
          });
        }
        break;

      case 'chat_opened':
      case 'chat_closed':
        // Add system message to chat if this is the active user
        if (data.userId === activeUserIdRef.current && data.msgId) {
          addMessage({
            id: data.msgId,
            userId: data.userId,
            sender: 'system',
            text: data.type,
            timestamp: data.timestamp,
          });
        }
        break;

      case 'page_visit':
        // Update user info with current URL
        updateUserInfo(data.userId, { current_url: data.url });
        // Add system message to chat if this is the active user
        if (data.userId === activeUserIdRef.current && data.msgId) {
          addMessage({
            id: data.msgId,
            userId: data.userId,
            sender: 'system',
            text: `page_visit:${data.url}`,
            timestamp: data.timestamp,
          });
        }
        break;

      case 'api_msg_sent':
      case 'admin_msg_sent': {
        if (data.info) updateUserInfo(data.targetId, data.info);
        const outboundSender = data.sender || (data.type === 'admin_msg_sent' ? 'internal_team' : 'support');
        if (data.targetId === activeUserIdRef.current) {
          addMessage({
            id: data.id,
            userId: data.targetId,
            sender: outboundSender,
            text: data.text,
            timestamp: data.timestamp,
          });
        } else {
          updateUserInfo(data.targetId, { lastMessage: { text: data.text, timestamp: data.timestamp, sender: outboundSender } });
        }
        break;
      }

      case 'new_ticket':
        if (soundEnabledRef.current) {
          playNotificationSound();
        }
        startTitleFlash();
        if (data.ticket) {
          const siteName = data.ticket.site_name || 'Support';
          const title = `🎫 Ticket (${siteName}): ${data.ticket.subject || 'New Ticket'}`;
          const body = `${data.ticket.channel ? `[${data.ticket.channel.toUpperCase()}] ` : ''}${data.ticket.description ? data.ticket.description.slice(0, 120) : 'A new ticket has been submitted.'}`;
          showBrowserNotification(title, body, `ticket_${data.ticket.id}`, { force: true });
          if (onSystemMessageRef.current) {
            onSystemMessageRef.current(`🎫 New ticket #${data.ticket.id} (${siteName}): ${data.ticket.subject}`);
          }
          if (typeof window !== 'undefined') {
            window.dispatchEvent(new CustomEvent('new_ticket_event', { detail: data.ticket }));
          }
        }
        break;

      case 'tickets_cleared':
        if (typeof window !== 'undefined') {
          window.dispatchEvent(new CustomEvent('tickets_cleared_event'));
        }
        break;

      case 'ticket_read':
        if (typeof window !== 'undefined') {
          window.dispatchEvent(new CustomEvent('ticket_read_event', { detail: { id: data.id } }));
        }
        break;

      case 'ticket_deleted':
        if (typeof window !== 'undefined') {
          window.dispatchEvent(new CustomEvent('ticket_deleted_event', { detail: { id: data.id } }));
        }
        break;

      case 'history_data':
        if (data.targetId === activeUserIdRef.current) {
          const messages = (data.messages || []).map(m => ({
            id: m.id,
            userId: data.targetId,
            sender: m.sender,
            text: m.text,
            timestamp: m.timestamp,
          }));
          setMessages(messages, data.hasMore || false);
        }
        break;

      case 'more_history':
        if (data.targetId === activeUserIdRef.current) {
          const messages = (data.messages || []).map(m => ({
            id: m.id,
            userId: data.targetId,
            sender: m.sender,
            text: m.text,
            timestamp: m.timestamp,
          }));
          prependMessages(messages, data.hasMore || false);
        }
        break;

      case 'message_deleted':
        deleteMessage(data.msgId);
        break;

      case 'session_deleted':
        removeUser(data.id);
        break;

      case 'system_messages_deleted':
        // Remove all system messages from current chat
        if (data.targetId === activeUserIdRef.current) {
          deleteSystemMessagesFromState();
        }
        break;

      case 'system':
        if (onSystemMessageRef.current) {
          onSystemMessageRef.current(data.text);
        }
        break;

      case 'telegram_updated':
        setConfig({
          telegramConfig: data.telegramConfig || { botToken: '', chatId: '', enabled: false, lastUpdateId: 0, bots: [] },
        });
        break;

      case 'search_results':
        if (onSearchResultsRef.current) {
          onSearchResultsRef.current(data.results, data.query);
        }
        break;

      default:
        console.log('Unknown message type:', data.type);
    }
  }, [
    setAuthenticated,
    setConfig,
    setUsers,
    addUser,
    updateUserInfo,
    setMessages,
    addMessage,
    deleteMessage,
    deleteSystemMessagesFromState,
    setTyping,
    removeUser,
    setNotification,
    setUserOnline,
    setTabActive,
    prependMessages,
  ]);

  // Keep handleMessage ref updated
  useEffect(() => {
    handleMessageRef.current = handleMessage;
  }, [handleMessage]);

  // Keep onSystemMessage ref updated
  useEffect(() => {
    onSystemMessageRef.current = onSystemMessage;
  }, [onSystemMessage]);

  // Keep soundEnabled ref updated
  useEffect(() => {
    soundEnabledRef.current = soundEnabled;
  }, [soundEnabled]);

  const connect = useCallback((credential, onAuthError, rememberMe = true, silent = false) => {
    return new Promise((resolve, reject) => {
      const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
      const isSession = typeof credential === 'string' && credential.startsWith('aksess_');
      const paramName = isSession ? 'sessionToken' : 'auth';
      const wsUrl = `${protocol}//${window.location.host}/?${paramName}=${encodeURIComponent(credential)}`;

      // Clear any pending reconnect
      if (reconnectTimeoutRef.current) {
        clearTimeout(reconnectTimeoutRef.current);
        reconnectTimeoutRef.current = null;
      }

      if (wsRef.current) {
        wsRef.current.close();
        wsRef.current = null;
      }

      // Store credential for reconnection
      passwordRef.current = credential;
      isManualDisconnectRef.current = false;

      // Store auth error callback
      onAuthErrorRef.current = onAuthError;
      let authSuccessReceived = false;
      let settled = false;

      const authTimeout = setTimeout(() => {
        if (!settled && !authSuccessReceived) {
          settled = true;
          if (onAuthErrorRef.current) {
            onAuthErrorRef.current();
            onAuthErrorRef.current = null;
          }
          if (wsRef.current) {
            wsRef.current.close();
          }
          reject(new Error('Authentication timed out'));
        }
      }, 10000);

      const ws = new WebSocket(wsUrl);
      wsRef.current = ws;

      ws.onopen = () => {
        console.log('WebSocket connected');
      };

      ws.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data);
          if (data.type === 'auth_success') {
            authSuccessReceived = true;
            clearTimeout(authTimeout);
            onAuthErrorRef.current = null;
            // Save session token in Render storage format (both session and local if rememberMe)
            if (data.sessionToken) {
              sessionStorage.setItem('ak_chat_session_token', data.sessionToken);
              if (rememberMe) {
                localStorage.setItem('ak_chat_session_token', data.sessionToken);
              }
            }
            // Legacy password persistence is intentionally disabled. Store session tokens only.
            localStorage.removeItem('ak_chat_admin_pass');
            localStorage.removeItem('kaplia_admin_pass');
            // Show toast only for initial login, not reconnects
            if (!silent && onSystemMessageRef.current) {
              onSystemMessageRef.current('Authentication successful!');
            }
            // Still need to update state
            setAuthenticated(true);
            setConfig({
              webhookUrl: data.webhookConfig?.url || '',
              webhookEnabled: data.webhookConfig?.enabled || false,
              apiToken: data.apiToken || '',
              timezone: data.timezone || '0',
              dateFormat: data.dateFormat || 'd.m.Y',
              timeFormat: data.timeFormat || 'H:i',
              realtimeTyping: data.realtimeTyping || false,
              systemLogs: data.systemLogs || { onlineStatus: true, tabActivity: true, chatWidget: true, pageVisits: true },
              allowedOrigins: data.allowedOrigins || '',
              allowedAnonymousOrigins: data.allowedAnonymousOrigins || '',
              maxMessagesPerMinute: data.maxMessagesPerMinute || 20,
              maxMessageLength: data.maxMessageLength || 1000,
              adminMessagesLimit: data.adminMessagesLimit || 20,
              widgetMessagesLimit: data.widgetMessagesLimit || 20,
              language: data.language || 'en',
              businessHours: data.businessHours || {},
              smtpConfig: data.smtpConfig || {},
              telegramConfig: data.telegramConfig || { botToken: '', chatId: '', enabled: false, lastUpdateId: 0, bots: [] },
            });
            if (!settled) {
              settled = true;
              resolve(data);
            }
            return; // Don't pass to handleMessage since we handled it here
          }
          if (handleMessageRef.current) {
            handleMessageRef.current(data);
          }
        } catch (e) {
          console.error('Failed to parse message:', e);
        }
      };

      ws.onclose = (event) => {
        console.log('WebSocket disconnected', event.code);
        clearTimeout(authTimeout);
        // If closed without auth_success - wrong password
        if (!authSuccessReceived) {
          if (onAuthErrorRef.current) {
            onAuthErrorRef.current();
            onAuthErrorRef.current = null;
          }
          sessionStorage.removeItem('ak_chat_session_token');
          localStorage.removeItem('ak_chat_session_token');
          localStorage.removeItem('ak_chat_admin_pass');
          localStorage.removeItem('kaplia_admin_pass');
          setAuthenticated(false);
          if (!settled) {
            settled = true;
            reject(new Error('Authentication failed'));
          }
          return;
        }

        // Auto-reconnect if not manual disconnect and we have password
        if (!isManualDisconnectRef.current && passwordRef.current) {
          console.log('Connection lost, reconnecting in 2 seconds...');
          reconnectTimeoutRef.current = setTimeout(() => {
            if (passwordRef.current && !isManualDisconnectRef.current) {
              connectRef.current?.(passwordRef.current, null, false, true).catch(() => {}); // silent reconnect
            }
          }, 2000);
        } else {
          setAuthenticated(false);
        }
      };

      ws.onerror = (error) => {
        console.error('WebSocket error:', error);
      };
    });
  }, [setAuthenticated, setConfig]);

  useEffect(() => {
    connectRef.current = connect;
  }, [connect]);

  const send = useCallback((data) => {
    if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify(data));
    }
  }, []);

  const sendReply = useCallback((targetId, text, clientMessageId) => {
    send({ type: 'admin_reply', targetId, text, clientMessageId });
  }, [send]);

  const getHistory = useCallback((targetId) => {
    send({ type: 'get_history', targetId });
  }, [send]);

  const loadMoreHistory = useCallback((targetId, beforeId) => {
    setLoadingMore(true);
    send({ type: 'get_history', targetId, beforeId });
  }, [send, setLoadingMore]);

  const deleteMessageCmd = useCallback((msgId, targetId) => {
    send({ type: 'delete_message', msgId, targetId });
  }, [send]);

  const deleteSession = useCallback((targetId) => {
    send({ type: 'delete_session', targetId });
  }, [send]);

  const deleteSystemMessages = useCallback((targetId) => {
    send({ type: 'delete_system_messages', targetId });
  }, [send]);

  const sendAdminTyping = useCallback((targetId, isTyping) => {
    send({ type: 'admin_typing', targetId, isTyping });
  }, [send]);

  const updateUserInfoFromAdmin = useCallback((targetId, userName, adminNotes) => {
    send({ type: 'admin_update_user', targetId, userName, adminNotes });
    updateUserInfo(targetId, { user_name: userName, admin_notes: adminNotes });
  }, [send, updateUserInfo]);

  const searchChats = useCallback((query) => {
    send({ type: 'search_chats', query });
  }, [send]);

  const setSearchResultsHandler = useCallback((handler) => {
    onSearchResultsRef.current = handler;
  }, []);

  const disconnect = useCallback(() => {
    isManualDisconnectRef.current = true;
    passwordRef.current = null;

    if (reconnectTimeoutRef.current) {
      clearTimeout(reconnectTimeoutRef.current);
      reconnectTimeoutRef.current = null;
    }

    if (wsRef.current) {
      if (wsRef.current.readyState === WebSocket.OPEN) {
        wsRef.current.send(JSON.stringify({ type: 'logout' }));
      }
      wsRef.current.close();
      wsRef.current = null;
    }
    sessionStorage.removeItem('ak_chat_session_token');
    localStorage.removeItem('ak_chat_session_token');
    localStorage.removeItem('ak_chat_admin_pass');
    localStorage.removeItem('kaplia_admin_pass');
    setAuthenticated(false);
  }, [setAuthenticated]);

  // Auto-connect on mount: prioritize Render disk session token, fallback to password
  useEffect(() => {
    const savedSessionToken = sessionStorage.getItem('ak_chat_session_token') || localStorage.getItem('ak_chat_session_token');
    // Clear legacy raw-password keys left by earlier releases, then restore only a session token.
    localStorage.removeItem('ak_chat_admin_pass');
    localStorage.removeItem('kaplia_admin_pass');
    const authCredential = savedSessionToken;
    if (authCredential) {
      connect(authCredential, null, false, true).catch(() => { setAuthenticated(false); setAuthChecking(false); }); // silent = true for auto-connect
    } else {
      setAuthChecking(false);
    }

    return () => {
      if (reconnectTimeoutRef.current) {
        clearTimeout(reconnectTimeoutRef.current);
      }
      if (wsRef.current) {
        wsRef.current.close();
      }
    };
  }, [connect, setAuthenticated, setAuthChecking]);

  return {
    connect,
    disconnect,
    send,
    sendReply,
    getHistory,
    loadMoreHistory,
    deleteMessage: deleteMessageCmd,
    deleteSession,
    deleteSystemMessages,
    sendAdminTyping,
    updateUserInfoFromAdmin,
    searchChats,
    setSearchResultsHandler,
  };
}
