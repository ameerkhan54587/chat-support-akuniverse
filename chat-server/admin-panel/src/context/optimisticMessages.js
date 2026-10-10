export function optimisticMessageReducer(state, action) {
  switch (action.type) {
    case 'ADD_OPTIMISTIC_MESSAGE': {
      const msg = action.payload;
      const previousLastMessage = state.usersInfo[msg.userId]?.lastMessage || null;
      return {
        ...state,
        messages: msg.userId === state.activeUserId ? [...state.messages, { ...msg, previousLastMessage }] : state.messages,
        users: [msg.userId, ...state.users.filter(id => id !== msg.userId)],
        usersInfo: {
          ...state.usersInfo,
          [msg.userId]: {
            ...state.usersInfo[msg.userId],
            lastMessage: { text: msg.text, timestamp: msg.timestamp, sender: msg.sender, clientMessageId: msg.clientMessageId, status: 'pending', previousLastMessage },
          },
        },
      };
    }

    case 'CONFIRM_OPTIMISTIC_MESSAGE': {
      const msg = action.payload;
      const exists = state.messages.some(item => item.clientMessageId === msg.clientMessageId);
      const messages = exists
        ? state.messages.map(item => item.clientMessageId === msg.clientMessageId ? { ...msg, status: 'sent' } : item)
        : (state.activeUserId === msg.userId ? [...state.messages, { ...msg, status: 'sent' }] : state.messages);
      const currentLast = state.usersInfo[msg.userId]?.lastMessage;
      const shouldUpdatePreview = currentLast?.clientMessageId === msg.clientMessageId
        || (!exists && (!currentLast?.timestamp || new Date(currentLast.timestamp).getTime() <= new Date(msg.timestamp).getTime()));
      return {
        ...state,
        messages,
        users: [msg.userId, ...state.users.filter(id => id !== msg.userId)],
        usersInfo: shouldUpdatePreview
          ? { ...state.usersInfo, [msg.userId]: { ...state.usersInfo[msg.userId], lastMessage: { text: msg.text, timestamp: msg.timestamp, sender: msg.sender } } }
          : state.usersInfo,
      };
    }

    case 'FAIL_OPTIMISTIC_MESSAGE': {
      const { userId, clientMessageId } = action.payload;
      const currentLast = state.usersInfo[userId]?.lastMessage;
      return {
        ...state,
        messages: state.messages.map(item => item.clientMessageId === clientMessageId ? { ...item, status: 'unconfirmed' } : item),
        usersInfo: currentLast?.clientMessageId === clientMessageId
          ? { ...state.usersInfo, [userId]: { ...state.usersInfo[userId], lastMessage: { ...currentLast, status: 'unconfirmed' } } }
          : state.usersInfo,
      };
    }

    default:
      return state;
  }
}
