// Web Push / Desktop Browser Notifications for new messages and tickets

let savedPref = localStorage.getItem('kaplia_notifications_enabled');
let notificationEnabled = savedPref !== null ? savedPref === 'true' : true;
let onClickCallback = null;

export function isNotificationSupported() {
  return typeof window !== 'undefined' && 'Notification' in window;
}

export function getNotificationPermission() {
  if (!isNotificationSupported()) return 'denied';
  return Notification.permission;
}

export async function requestNotificationPermission() {
  if (!isNotificationSupported()) return 'denied';
  try {
    const permission = await Notification.requestPermission();
    if (permission === 'granted') {
      setNotificationEnabled(true);
    }
    return permission;
  } catch (err) {
    console.error('Failed to request notification permission', err);
    return 'denied';
  }
}

export function setNotificationEnabled(enabled) {
  notificationEnabled = enabled;
  if (typeof localStorage !== 'undefined') {
    localStorage.setItem('kaplia_notifications_enabled', String(enabled));
  }
}

export function isNotificationEnabled() {
  return notificationEnabled && isNotificationSupported() && Notification.permission === 'granted';
}

export function setNotificationClickHandler(handler) {
  onClickCallback = handler;
}

export function showBrowserNotification(title, body, userId = 'general', options = {}) {
  if (!isNotificationSupported()) return;
  if (Notification.permission !== 'granted') return;
  if (!notificationEnabled && !options.force) return;

  // Only suppress if the admin is actively viewing the exact same chat right now
  if (!options.force && !document.hidden && options.activeUserId && options.activeUserId === userId) {
    return;
  }

  try {
    const cleanBody = body && typeof body === 'string'
      ? (body.length > 120 ? body.substring(0, 120) + '...' : body)
      : 'New customer message';

    const notification = new Notification(title || 'Support Chat', {
      body: cleanBody,
      icon: '/favicon.ico',
      badge: '/favicon.ico',
      tag: 'kaplia-' + userId,
      renotify: true,
      silent: false
    });

    notification.onclick = () => {
      window.focus();
      notification.close();
      if (onClickCallback && userId) {
        onClickCallback(userId);
      }
    };

    setTimeout(() => {
      try { notification.close(); } catch (e) {}
    }, 6500);
  } catch (err) {
    console.warn('Web notification dispatch failed:', err);
  }
}

// Quick diagnostic/test trigger for admin panel
export function sendTestNotification() {
  if (getNotificationPermission() !== 'granted') {
    requestNotificationPermission().then(p => {
      if (p === 'granted') {
        showBrowserNotification('🔔 Web Push Connected', 'Browser desktop notifications are working perfectly!', 'test', { force: true });
      }
    });
  } else {
    showBrowserNotification('🔔 Web Push Connected', 'Browser desktop notifications are working perfectly!', 'test', { force: true });
  }
}
