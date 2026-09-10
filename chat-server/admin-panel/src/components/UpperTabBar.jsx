import React from 'react';
import { useTranslation } from '../i18n';

export function UpperTabBar({
  activeTab,
  onSelectTab,
  counts = {},
  onOpenSites,
  onOpenSettings,
  onLogout,
  soundEnabled,
  onToggleSound,
  pushEnabled = false,
  pushPermission = 'default',
  onTogglePush,
  onTestPush
}) {
  const { t } = useTranslation();

  const getTabMetrics = (id) => {
    const val = counts[id];
    if (typeof val === 'object' && val !== null) {
      return {
        total: Number(val.total ?? val.count ?? 0),
        unread: Number(val.unread ?? 0)
      };
    }
    return {
      total: Number(val ?? 0),
      unread: 0
    };
  };

  const tabs = [
    { id: 'all', label: 'All Chats', icon: '💬', ...getTabMetrics('all') },
    { id: 'widget', label: 'Widget Chats', icon: '🌐', ...getTabMetrics('widget') },
    { id: 'telegram', label: 'Telegram Chats', icon: '✈️', ...getTabMetrics('telegram') },
    { id: 'email', label: 'Email', icon: '✉️', ...getTabMetrics('email') },
    { id: 'tickets', label: 'Tickets', icon: '🎫', ...getTabMetrics('tickets') },
    { id: 'escalated', label: 'Escalated', icon: '⚠️', ...getTabMetrics('escalated') }
  ];

  const totalUnreadAll = getTabMetrics('all').unread;

  return (
    <header className="bg-white border-b border-gray-200 px-3 sm:px-4 py-2 flex items-center justify-between gap-2 shadow-xs select-none z-20 flex-shrink-0">
      {/* Brand & Channel Tabs */}
      <div className="flex items-center gap-3 min-w-0 flex-1">
        <div className="flex items-center gap-2 flex-shrink-0 pr-2 border-r border-gray-200">
          <div className="relative">
            <div className="w-8 h-8 rounded-lg bg-gradient-to-tr from-blue-600 to-indigo-500 flex items-center justify-center text-white font-bold text-xs shadow-sm tracking-tighter">
              AK
            </div>
            {totalUnreadAll > 0 && (
              <span
                className="absolute -top-1.5 -right-1.5 min-w-[18px] h-[18px] px-1 bg-red-600 text-white rounded-full border-2 border-white text-[10px] font-black flex items-center justify-center shadow-xs animate-pulse"
                title={`${totalUnreadAll} total unread messages`}
              >
                {totalUnreadAll > 99 ? '99+' : totalUnreadAll}
              </span>
            )}
          </div>
          <span className="font-bold text-gray-800 text-sm hidden lg:inline tracking-tight">
            Chat Support by AKUniverse
          </span>
        </div>

        {/* Scrollable Upper Navigation Tabs */}
        <nav className="flex items-center gap-1.5 overflow-x-auto no-scrollbar py-0.5 min-w-0">
          {tabs.map((tab) => {
            const isActive = activeTab === tab.id;
            const hasTotal = tab.total > 0 || tab.id === 'all' || tab.id === 'tickets';
            const hasUnread = tab.unread > 0;

            return (
              <button
                key={tab.id}
                type="button"
                onClick={() => onSelectTab(tab.id)}
                className={`relative flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold whitespace-nowrap transition-all duration-150 flex-shrink-0 ${
                  isActive
                    ? 'bg-blue-600 text-white shadow-sm shadow-blue-500/20 ring-1 ring-blue-600'
                    : 'text-gray-600 hover:text-gray-900 hover:bg-gray-100/80 bg-gray-50/70 border border-gray-200/70'
                }`}
              >
                <span className="text-sm">{tab.icon}</span>
                <span>{tab.label}</span>

                {/* Total Count Pill */}
                {hasTotal && (
                  <span
                    className={`ml-0.5 text-[10px] font-bold px-1.5 py-0.2 rounded-full transition ${
                      isActive
                        ? 'bg-white/25 text-white'
                        : tab.id === 'escalated' && tab.total > 0
                        ? 'bg-rose-100 text-rose-700'
                        : tab.id === 'tickets' && tab.total > 0
                        ? 'bg-purple-100 text-purple-700'
                        : 'bg-gray-200 text-gray-700'
                    }`}
                    title={`${tab.total} total`}
                  >
                    {tab.total}
                  </span>
                )}

                {/* Unread / New Notifications Badge */}
                {hasUnread && (
                  <span
                    className="ml-0.5 text-[10px] font-black px-1.5 py-0.2 rounded-full bg-red-600 text-white shadow-sm animate-pulse ring-2 ring-red-400/40 flex items-center gap-0.5"
                    title={`${tab.unread} unread / new notification${tab.unread > 1 ? 's' : ''}`}
                  >
                    <span>{tab.unread > 99 ? '99+' : tab.unread}</span>
                    <span className="hidden sm:inline text-[9px] font-bold">new</span>
                  </span>
                )}
              </button>
            );
          })}
        </nav>
      </div>

      {/* Right Controls */}
      <div className="flex items-center gap-1.5 flex-shrink-0 pl-2">
        {/* Web Push Notification Quick Control */}
        <button
          type="button"
          onClick={onTogglePush}
          className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-semibold border transition shadow-xs ${
            pushPermission === 'denied'
              ? 'bg-amber-50 text-amber-800 border-amber-300 hover:bg-amber-100'
              : pushEnabled
              ? 'bg-emerald-50 text-emerald-700 border-emerald-300 hover:bg-emerald-100'
              : 'bg-gray-50 text-gray-600 border-gray-200 hover:bg-blue-50 hover:text-blue-700 hover:border-blue-200'
          }`}
          title={
            pushPermission === 'denied'
              ? 'Browser Notifications are blocked. Click to learn how to allow.'
              : pushEnabled
              ? 'Desktop Web Push Notifications are ACTIVE! Click to send a test alert.'
              : 'Click to Enable Desktop Web Push Notifications'
          }
        >
          <span className="text-sm">
            {pushPermission === 'denied' ? '🔕' : pushEnabled ? '🔔' : '🔔'}
          </span>
          <span className="hidden md:inline">
            {pushPermission === 'denied'
              ? 'Push: Blocked'
              : pushEnabled
              ? 'Push: On'
              : 'Enable Push'}
          </span>
          {pushEnabled && (
            <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
          )}
        </button>

        {/* Widget & Integration Docs */}
        <button
          type="button"
          onClick={onOpenSites}
          className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-semibold text-gray-700 bg-gray-50 hover:bg-blue-50 hover:text-blue-700 border border-gray-200 transition shadow-xs"
          title="Widget Integration Documentation"
        >
          <span>📖</span>
          <span className="hidden md:inline">Docs</span>
        </button>

        {/* Settings Button (right next to Docs) */}
        <button
          type="button"
          onClick={onOpenSettings}
          className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-semibold text-gray-700 bg-gray-50 hover:bg-blue-50 hover:text-blue-700 border border-gray-200 transition shadow-xs"
          title={t('sidebar.settings')}
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
          </svg>
          <span className="hidden md:inline">Settings</span>
        </button>

        {/* Sound Toggle */}
        <button
          type="button"
          onClick={onToggleSound}
          className={`p-1.5 rounded-lg border transition ${
            soundEnabled
              ? 'text-blue-600 bg-blue-50 border-blue-200'
              : 'text-gray-400 bg-gray-50 border-gray-200'
          }`}
          title={soundEnabled ? 'Mute Sounds' : 'Unmute Sounds'}
        >
          {soundEnabled ? '🔔' : '🔕'}
        </button>

        {/* Logout Button */}
        <button
          type="button"
          onClick={onLogout}
          className="p-1.5 text-gray-400 hover:text-red-600 hover:bg-red-50 rounded-lg border border-transparent hover:border-red-200 transition"
          title={t('sidebar.logout')}
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" />
          </svg>
        </button>
      </div>
    </header>
  );
}
