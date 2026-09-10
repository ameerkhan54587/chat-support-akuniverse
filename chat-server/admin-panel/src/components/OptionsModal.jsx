import { useState, useEffect, useRef } from 'react';
import { Modal } from './Modal';
import { playSound, soundOptions } from '../utils/notificationSound';
import { useTranslation } from '../i18n';
import { WidgetConfigurator } from './WidgetConfigurator';
import { SitesManager } from './SitesManager';

const TIMEZONE_OPTIONS = [
  { value: '-12', label: 'UTC -12:00' },
  { value: '-11', label: 'UTC -11:00' },
  { value: '-10', label: 'UTC -10:00' },
  { value: '-9.5', label: 'UTC -09:30' },
  { value: '-9', label: 'UTC -09:00' },
  { value: '-8', label: 'UTC -08:00' },
  { value: '-7', label: 'UTC -07:00' },
  { value: '-6', label: 'UTC -06:00' },
  { value: '-5', label: 'UTC -05:00' },
  { value: '-4', label: 'UTC -04:00' },
  { value: '-3.5', label: 'UTC -03:30' },
  { value: '-3', label: 'UTC -03:00' },
  { value: '-2', label: 'UTC -02:00' },
  { value: '-1', label: 'UTC -01:00' },
  { value: '0', label: 'UTC +00:00' },
  { value: '1', label: 'UTC +01:00' },
  { value: '2', label: 'UTC +02:00' },
  { value: '3', label: 'UTC +03:00' },
  { value: '3.5', label: 'UTC +03:30' },
  { value: '4', label: 'UTC +04:00' },
  { value: '4.5', label: 'UTC +04:30' },
  { value: '5', label: 'UTC +05:00' },
  { value: '5.5', label: 'UTC +05:30' },
  { value: '5.75', label: 'UTC +05:45' },
  { value: '6', label: 'UTC +06:00' },
  { value: '6.5', label: 'UTC +06:30' },
  { value: '7', label: 'UTC +07:00' },
  { value: '8', label: 'UTC +08:00' },
  { value: '8.75', label: 'UTC +08:45' },
  { value: '9', label: 'UTC +09:00' },
  { value: '9.5', label: 'UTC +09:30' },
  { value: '10', label: 'UTC +10:00' },
  { value: '10.5', label: 'UTC +10:30' },
  { value: '11', label: 'UTC +11:00' },
  { value: '12', label: 'UTC +12:00' },
  { value: '12.75', label: 'UTC +12:45' },
  { value: '13', label: 'UTC +13:00' },
  { value: '14', label: 'UTC +14:00' },
];

export function OptionsModal({
  isOpen,
  onClose,
  config,
  onSavePassword,
  onSaveToken,
  onSaveWebhook,
  onSaveTimeSettings,
  onSaveRealtimeTyping,
  onSaveSystemLogs,
  onSaveLanguage,
  onSaveAllowedOrigins,
  onSaveAnonymousOrigins,
  onSaveRateLimit,
  onSaveMessageLimits,
  onSaveBusinessHours,
  onSaveSmtp,
  onSaveTelegram,
  onSaveTelegramBots,
  onToggleTelegramBot,
  onTestSmtp,
  soundEnabled,
  onSoundEnabledChange,
  soundType,
  onSoundTypeChange,
  notificationsEnabled,
  onNotificationsEnabledChange,
  onCopyToken
}) {
  const { t, language } = useTranslation();
  const [activeTab, setActiveTab] = useState('chat');
  const [showSitesManager, setShowSitesManager] = useState(false);
  const tabsContainerRef = useRef(null);
  const tabRefs = useRef({});

  const handleTabClick = (tabId) => {
    setActiveTab(tabId);
    // Scroll to make the active tab visible with smooth animation
    const tabEl = tabRefs.current[tabId];
    const container = tabsContainerRef.current;
    if (tabEl && container) {
      const containerRect = container.getBoundingClientRect();
      const tabRect = tabEl.getBoundingClientRect();
      const scrollLeft = tabEl.offsetLeft - containerRect.width / 2 + tabRect.width / 2;
      container.scrollTo({ left: scrollLeft, behavior: 'smooth' });
    }
  };

  const tabs = [
    { id: 'chat', label: t('settings.tabs.chat') },
    { id: 'widget', label: t('settings.tabs.widget') },
    { id: 'sites', label: '🌐 Sites' },
  ];

  // Spam & Messages limits
  const [maxMessagesPerMinute, setMaxMessagesPerMinute] = useState(20);
  const [maxMessageLength, setMaxMessageLength] = useState(1000);
  const [adminMessagesLimit, setAdminMessagesLimit] = useState(20);
  const [widgetMessagesLimit, setWidgetMessagesLimit] = useState(20);

  useEffect(() => {
    if (isOpen && config) {
      setMaxMessagesPerMinute(config.maxMessagesPerMinute || 20);
      setMaxMessageLength(config.maxMessageLength || 1000);
      setAdminMessagesLimit(config.adminMessagesLimit || 20);
      setWidgetMessagesLimit(config.widgetMessagesLimit || 20);
    }
  }, [isOpen, config]);

  const handleSaveRateLimit = () => {
    onSaveRateLimit(parseInt(maxMessagesPerMinute) || 20, parseInt(maxMessageLength) || 1000);
  };

  const handleSaveMessageLimits = () => {
    onSaveMessageLimits(parseInt(adminMessagesLimit) || 20, parseInt(widgetMessagesLimit) || 20);
  };

  return (
    <Modal isOpen={isOpen} onClose={onClose} title={t('settings.title')} size="xl">
      {/* Tabs with fade effect */}
      <div className="relative mb-4 -mt-2">
        {/* Left fade gradient */}
        <div className="absolute left-0 top-0 bottom-0 w-6 bg-gradient-to-r from-white to-transparent z-10 pointer-events-none"></div>
        {/* Right fade gradient */}
        <div className="absolute right-0 top-0 bottom-0 w-6 bg-gradient-to-l from-white to-transparent z-10 pointer-events-none"></div>
        {/* Scrollable tabs container */}
        <div
          ref={tabsContainerRef}
          className="overflow-x-auto scrollbar-hide"
          style={{
            scrollbarWidth: 'none',
            msOverflowStyle: 'none',
            WebkitOverflowScrolling: 'touch'
          }}
        >
          <div className="flex border-b border-gray-200 px-4">
            {tabs.map((tab) => (
              <button
                key={tab.id}
                ref={(el) => (tabRefs.current[tab.id] = el)}
                onClick={() => handleTabClick(tab.id)}
                className={`px-3 py-2 text-sm font-medium border-b-2 transition whitespace-nowrap ${
                  activeTab === tab.id
                    ? 'border-blue-500 text-blue-600'
                    : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
                }`}
              >
                {tab.label}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Tab content */}
      <div className="space-y-4">


        {/* Sound Tab */}
        {activeTab === 'chat' && (
          <div className="space-y-6">
            <div className="flex items-center justify-between">
              <div>
                <span className="text-sm font-medium text-gray-700">{t('settings.sound.enabled')}</span>
                <p className="text-xs text-gray-500">{t('settings.sound.enabledHint')}</p>
              </div>
              <label className="relative inline-flex items-center cursor-pointer">
                <input
                  type="checkbox"
                  checked={soundEnabled}
                  onChange={(e) => onSoundEnabledChange(e.target.checked)}
                  className="sr-only peer"
                />
                <div className="w-11 h-6 bg-gray-200 peer-focus:outline-none peer-focus:ring-4 peer-focus:ring-blue-300 rounded-full peer peer-checked:after:translate-x-full rtl:peer-checked:after:-translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:start-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-blue-500"></div>
              </label>
            </div>

            <div className="flex items-center justify-between">
              <div>
                <span className="text-sm font-medium text-gray-700">{t('settings.sound.browserNotifications')}</span>
                <p className="text-xs text-gray-500">{t('settings.sound.browserNotificationsHint')}</p>
              </div>
              <label className="relative inline-flex items-center cursor-pointer">
                <input
                  type="checkbox"
                  checked={notificationsEnabled}
                  onChange={(e) => onNotificationsEnabledChange(e.target.checked)}
                  className="sr-only peer"
                />
                <div className="w-11 h-6 bg-gray-200 peer-focus:outline-none peer-focus:ring-4 peer-focus:ring-blue-300 rounded-full peer peer-checked:after:translate-x-full rtl:peer-checked:after:-translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:start-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-blue-500"></div>
              </label>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                {t('settings.sound.type')}
              </label>
              <div className="space-y-2">
                {soundOptions.map((sound) => (
                  <div
                    key={sound.id}
                    className={`flex items-center justify-between p-3 rounded-lg border cursor-pointer transition ${
                      soundType === sound.id
                        ? 'border-blue-500 bg-blue-50'
                        : 'border-gray-200 hover:border-gray-300 hover:bg-gray-50'
                    }`}
                    onClick={() => onSoundTypeChange(sound.id)}
                  >
                    <div className="flex items-center gap-3">
                      <input
                        type="radio"
                        name="soundType"
                        checked={soundType === sound.id}
                        onChange={() => onSoundTypeChange(sound.id)}
                        className="w-4 h-4 text-blue-500 focus:ring-blue-500"
                      />
                      <span className="text-sm text-gray-700">{t(sound.nameKey)}</span>
                    </div>
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        playSound(sound.id);
                      }}
                      className="px-3 py-1 text-xs text-blue-500 hover:text-blue-600 hover:bg-blue-100 rounded transition"
                    >
                      ▶ {t('settings.sound.test')}
                    </button>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}

        {/* Messages Tab */}
        {activeTab === 'chat' && (
          <div className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                {t('settings.messages.adminLimit')}
              </label>
              <input
                type="number"
                min="5"
                max="100"
                value={adminMessagesLimit}
                onChange={(e) => setAdminMessagesLimit(e.target.value)}
                className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none transition"
              />
              <p className="text-xs text-gray-500 mt-1">
                {t('settings.messages.adminLimitHint')}
              </p>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                {t('settings.messages.widgetLimit')}
              </label>
              <input
                type="number"
                min="5"
                max="100"
                value={widgetMessagesLimit}
                onChange={(e) => setWidgetMessagesLimit(e.target.value)}
                className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none transition"
              />
              <p className="text-xs text-gray-500 mt-1">
                {t('settings.messages.widgetLimitHint')}
              </p>
            </div>

            <button
              onClick={handleSaveMessageLimits}
              className="w-full bg-blue-500 hover:bg-blue-600 text-white font-medium py-2 px-4 rounded-lg transition"
            >
              {t('settings.messages.save')}
            </button>
          </div>
        )}

        {/* Spam Protection Tab */}
        {activeTab === 'chat' && (
          <div className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                {t('settings.spam.maxPerMinute')}
              </label>
              <input
                type="number"
                min="1"
                max="100"
                value={maxMessagesPerMinute}
                onChange={(e) => setMaxMessagesPerMinute(e.target.value)}
                className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none transition"
              />
              <p className="text-xs text-gray-500 mt-1">
                {t('settings.spam.maxPerMinuteHint')}
              </p>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                {t('settings.spam.maxLength')}
              </label>
              <input
                type="number"
                min="10"
                max="10000"
                value={maxMessageLength}
                onChange={(e) => setMaxMessageLength(e.target.value)}
                className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none transition"
              />
              <p className="text-xs text-gray-500 mt-1">
                {t('settings.spam.maxLengthHint')}
              </p>
            </div>

            <button
              onClick={handleSaveRateLimit}
              className="w-full bg-blue-500 hover:bg-blue-600 text-white font-medium py-2 px-4 rounded-lg transition"
            >
              {t('settings.spam.save')}
            </button>
          </div>
        )}

        {/* Widget Tab */}
        {activeTab === 'widget' && <WidgetConfigurator />}

        {/* Sites Manager Tab */}
        {activeTab === 'sites' && (
          <SitesManager
            isOpen={true}
            onClose={() => {}}
            apiToken={config?.apiToken}
          />
        )}
      </div>

      {/* SitesManager Modal */}
      {showSitesManager && (
        <SitesManager
          isOpen={showSitesManager}
          onClose={() => setShowSitesManager(false)}
          apiToken={config?.apiToken}
        />
      )}
    </Modal>
  );
}
