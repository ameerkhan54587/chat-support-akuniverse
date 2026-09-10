import React, { useState, useEffect } from 'react';
import { Modal } from './Modal';

export function SitesManager({ isOpen, onClose, apiToken }) {
  const [sites, setSites] = useState([]);
  const [selectedSiteId, setSelectedSiteId] = useState(null);
  const [copiedId, setCopiedId] = useState(null);
  const [serverHost, setServerHost] = useState('');

  useEffect(() => {
    if (typeof window !== 'undefined') {
      setServerHost(window.location.origin);
    }
  }, []);

  useEffect(() => {
    if (isOpen) {
      fetchSites();
    }
  }, [isOpen, apiToken]);

  const fetchSites = async () => {
    try {
      const response = await fetch('/api/sites', {
        headers: { Authorization: `Bearer ${apiToken}` }
      });
      if (response.ok) {
        const data = await response.json();
        setSites(data);
        if (data.length > 0 && !selectedSiteId) {
          setSelectedSiteId(data[0].id);
        }
      }
    } catch (err) {
      console.error('Error fetching sites:', err);
    }
  };

  const copyToClipboard = (text, id) => {
    navigator.clipboard.writeText(text);
    setCopiedId(id);
    setTimeout(() => setCopiedId(null), 2500);
  };

  const selectedSite = sites.find(s => s.id === selectedSiteId) || sites[0] || {
    id: 'generic',
    name: 'Website Widget',
    domain: 'yourdomain.com'
  };

  const scriptUrl = `${serverHost || 'https://your-domain.com'}/widget.js`;

  // Helper: resolve AI reply status for a given channel
  const getChannelAiReply = (site, channel) => {
    if (!site) return true;
    const ch = channel.toLowerCase();
    // 1. Direct key: telegram_ai_reply, widget_ai_reply, email_ai_reply
    if (site[`${ch}_ai_reply`] !== undefined) return Boolean(site[`${ch}_ai_reply`]);
    if (site[`ai_reply_${ch}`] !== undefined) return Boolean(site[`ai_reply_${ch}`]);
    // 2. Object: ai_reply: { widget: true, telegram: false }
    if (site.ai_reply && typeof site.ai_reply === 'object' && site.ai_reply[ch] !== undefined) {
      return Boolean(site.ai_reply[ch]);
    }
    // 3. ai_replies object
    if (site.ai_replies && typeof site.ai_replies === 'object' && site.ai_replies[ch] !== undefined) {
      return Boolean(site.ai_replies[ch]);
    }
    // 4. Master switch fallback
    if (typeof site.ai_reply === 'boolean') return site.ai_reply;
    if (site.ai_reply !== undefined) return site.ai_reply !== false;
    return true;
  };

  const getEmbedCode = (site) => {
    return `<!-- Chat Support by AKUniverse - Widget for ${site.name} -->
<script>
  window.ChatSupportConfig = {
    site: "${site.id}",
    defaultLanguage: "en",
    metadata: {
      site_id: "${site.id}",
      user_name: "Customer Name",       // Optional: pass logged-in user's name
      user_email: "customer@example.com" // Optional: pass logged-in user's email
    }
  };
</script>
<script src="${scriptUrl}" async></script>`;
  };

  const simpleScriptTag = `<script src="${scriptUrl}" data-site="${selectedSite?.id || 'default'}" async></script>`;

  return (
    <Modal isOpen={isOpen} onClose={onClose} title="📖 Widget Integration & Setup Docs" size="3xl">
      <div className="space-y-5">
        {/* Architecture Note */}
        <div className="bg-gradient-to-r from-blue-50 to-indigo-50 border border-blue-200/80 rounded-xl p-3.5 flex items-start gap-3 text-xs text-blue-900 shadow-xs">
          <span className="text-xl flex-shrink-0">💡</span>
          <div className="space-y-1">
            <p className="font-semibold text-blue-950">
              Code-Driven Setup (No manual UI configuration needed)
            </p>
            <p className="text-blue-800 leading-relaxed">
              Telegram bots, Email SMTP, AI instructions, and site rules are loaded directly from the code preset files in{' '}
              <code className="bg-blue-100/80 px-1.5 py-0.5 rounded font-mono text-[11px] font-semibold">
                chat-server/data/sites/*.json
              </code>
              . To embed live chat on your websites, simply use the widget links and script tags below.
            </p>
          </div>
        </div>

        {/* Site Selector Pills */}
        <div>
          <label className="block text-xs font-bold text-gray-500 uppercase tracking-wider mb-2">
            Select Website / Service:
          </label>
          <div className="flex flex-wrap gap-2">
            {sites.map((site) => {
              const isSelected = selectedSite?.id === site.id;
              return (
                <button
                  key={site.id}
                  type="button"
                  onClick={() => setSelectedSiteId(site.id)}
                  className={`flex items-center gap-2 px-3 py-2 rounded-lg text-xs font-semibold transition-all ${
                    isSelected
                      ? 'bg-blue-600 text-white shadow-sm ring-2 ring-blue-600/30'
                      : 'bg-gray-50 hover:bg-gray-100 text-gray-700 border border-gray-200'
                  }`}
                >
                  <span>🌐</span>
                  <span>{site.name}</span>
                  <span
                    className={`text-[10px] px-1.5 py-0.5 rounded font-mono ${
                      isSelected ? 'bg-white/20 text-white' : 'bg-gray-200 text-gray-600'
                    }`}
                  >
                    {site.domain || site.id}
                  </span>
                </button>
              );
            })}
          </div>
        </div>

        {/* Selected Site Documentation Section */}
        {selectedSite && (
          <div className="bg-white border border-gray-200 rounded-xl p-4.5 space-y-4 shadow-xs">
            {/* Header info */}
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 pb-3 border-b border-gray-100">
              <div>
                <div className="flex items-center gap-2">
                  <h4 className="font-bold text-gray-800 text-base flex items-center gap-1.5">
                    <span>🌐</span>
                    <span>{selectedSite.name}</span>
                  </h4>
                  <span className="text-[11px] bg-emerald-50 text-emerald-700 font-semibold px-2 py-0.5 rounded border border-emerald-200">
                    ✓ Active in Code
                  </span>
                  <span
                    className={`text-[11px] font-semibold px-2 py-0.5 rounded border flex items-center gap-1 ${
                      getChannelAiReply(selectedSite, 'widget')
                        ? 'bg-blue-50 text-blue-700 border-blue-200'
                        : 'bg-rose-50 text-rose-700 border-rose-200'
                    }`}
                    title={`Widget AI: ${getChannelAiReply(selectedSite, 'widget') ? 'ON' : 'OFF'}`}
                  >
                    🌐 Widget AI: {getChannelAiReply(selectedSite, 'widget') ? 'ON' : 'OFF'}
                  </span>
                  <span
                    className={`text-[11px] font-semibold px-2 py-0.5 rounded border flex items-center gap-1 ${
                      getChannelAiReply(selectedSite, 'telegram')
                        ? 'bg-blue-50 text-blue-700 border-blue-200'
                        : 'bg-rose-50 text-rose-700 border-rose-200'
                    }`}
                    title={`Telegram AI: ${getChannelAiReply(selectedSite, 'telegram') ? 'ON' : 'OFF'}`}
                  >
                    ✈️ Telegram AI: {getChannelAiReply(selectedSite, 'telegram') ? 'ON' : 'OFF'}
                  </span>
                  <span
                    className={`text-[11px] font-semibold px-2 py-0.5 rounded border flex items-center gap-1 ${
                      getChannelAiReply(selectedSite, 'email')
                        ? 'bg-blue-50 text-blue-700 border-blue-200'
                        : 'bg-rose-50 text-rose-700 border-rose-200'
                    }`}
                    title={`Email AI: ${getChannelAiReply(selectedSite, 'email') ? 'ON' : 'OFF'}`}
                  >
                    ✉️ Email AI: {getChannelAiReply(selectedSite, 'email') ? 'ON' : 'OFF'}
                  </span>
                </div>
                <p className="text-xs text-gray-500 mt-0.5">
                  Target Domain:{' '}
                  <span className="font-mono font-medium text-gray-700">
                    {selectedSite.domain || selectedSite.id}
                  </span>
                </p>
              </div>

              <div className="flex items-center gap-2">
                <a
                  href={scriptUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="px-2.5 py-1 text-xs font-medium text-blue-600 hover:text-blue-800 hover:bg-blue-50 rounded border border-blue-200 transition flex items-center gap-1"
                >
                  <span>🔗</span>
                  <span>Open widget.js</span>
                </a>
              </div>
            </div>

            {/* Direct Widget Script Link */}
            <div>
              <div className="flex items-center justify-between mb-1.5">
                <span className="text-xs font-bold text-gray-700">
                  1. Direct Widget URL
                </span>
                <button
                  type="button"
                  onClick={() => copyToClipboard(scriptUrl, 'url')}
                  className="text-xs font-semibold text-blue-600 hover:text-blue-800 flex items-center gap-1"
                >
                  {copiedId === 'url' ? '✓ Copied URL!' : '📋 Copy URL'}
                </button>
              </div>
              <div className="bg-gray-50 border border-gray-200 rounded-lg p-2.5 font-mono text-xs text-gray-800 select-all break-all">
                {scriptUrl}
              </div>
            </div>

            {/* Full Embed Snippet */}
            <div>
              <div className="flex items-center justify-between mb-1.5">
                <span className="text-xs font-bold text-gray-700">
                  2. HTML Embed Code (Paste before &lt;/body&gt;)
                </span>
                <button
                  type="button"
                  onClick={() => copyToClipboard(getEmbedCode(selectedSite), 'full')}
                  className="text-xs font-semibold px-2.5 py-1 bg-blue-50 text-blue-700 hover:bg-blue-100 rounded border border-blue-200 transition flex items-center gap-1"
                >
                  {copiedId === 'full' ? '✓ Copied Code!' : '📋 Copy Embed Code'}
                </button>
              </div>
              <pre className="bg-gray-900 text-gray-100 rounded-xl p-3.5 text-xs font-mono overflow-x-auto leading-relaxed border border-gray-800">
                {getEmbedCode(selectedSite)}
              </pre>
            </div>

            {/* Quick 1-line script embed */}
            <div>
              <div className="flex items-center justify-between mb-1.5">
                <span className="text-xs font-bold text-gray-700">
                  3. Minimal 1-Line Embed Tag
                </span>
                <button
                  type="button"
                  onClick={() => copyToClipboard(simpleScriptTag, 'simple')}
                  className="text-xs font-semibold text-blue-600 hover:text-blue-800 flex items-center gap-1"
                >
                  {copiedId === 'simple' ? '✓ Copied!' : '📋 Copy'}
                </button>
              </div>
              <div className="bg-gray-50 border border-gray-200 rounded-lg p-2.5 font-mono text-xs text-gray-800 select-all break-all">
                {simpleScriptTag}
              </div>
            </div>

            {/* Software & Bot Bug Reporting API */}
            <div className="pt-2 border-t border-gray-100 space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-xs font-bold text-gray-800 flex items-center gap-1.5">
                  <span>💻</span>
                  <span>4. Software / Bot Bug Reporting API (Python / Desktop App)</span>
                </span>
                <span className="text-[10px] bg-purple-50 text-purple-700 font-semibold px-2 py-0.5 rounded border border-purple-200">
                  No Browser Domain Needed
                </span>
              </div>
              <p className="text-xs text-gray-500">
                Desktop software, bots, and background Python scripts authenticate using this site's secret{' '}
                <code className="bg-gray-100 px-1 py-0.5 rounded text-gray-700 font-semibold">api_key</code>.
              </p>

              {/* API Key Box */}
              <div className="bg-purple-50/50 border border-purple-200/80 rounded-xl p-3 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-2">
                <div>
                  <span className="text-[11px] font-bold text-purple-900 block uppercase">
                    Site Secret API Key:
                  </span>
                  <span className="font-mono text-xs text-purple-800 font-bold break-all">
                    {selectedSite.api_key || 'Configured in data/sites/' + selectedSite.id + '.json'}
                  </span>
                </div>
                {selectedSite.api_key && (
                  <button
                    type="button"
                    onClick={() => copyToClipboard(selectedSite.api_key, 'key')}
                    className="px-2.5 py-1 text-xs font-semibold bg-purple-600 text-white hover:bg-purple-700 rounded-lg transition flex-shrink-0 flex items-center gap-1 shadow-xs"
                  >
                    {copiedId === 'key' ? '✓ Copied Key!' : '📋 Copy API Key'}
                  </button>
                )}
              </div>

              {/* Python Snippet */}
              <div>
                <div className="flex items-center justify-between mb-1">
                  <span className="text-[11px] font-bold text-gray-600">
                    Python Code Example:
                  </span>
                  <button
                    type="button"
                    onClick={() =>
                      copyToClipboard(
`import requests

def report_software_bug(error_title, error_traceback, user_id=None):
    url = "${serverHost || 'https://your-domain.com'}/api/tickets"
    headers = {
        "Authorization": "Bearer ${selectedSite.api_key || 'YOUR_SITE_API_KEY'}",
        "Content-Type": "application/json"
    }
    payload = {
        "site_id": "${selectedSite.id}",
        "channel_type": "software",
        "subject": f"Bug: {error_title}",
        "priority": "high",
        "error_log": error_traceback,
        "user_id": user_id,
        "version": "1.0.0"
    }
    try:
        response = requests.post(url, json=payload, headers=headers, timeout=5)
        return response.json()
    except Exception as e:
        print("Failed to report bug:", e)
        return None
`,
                        'py'
                      )
                    }
                    className="text-xs font-semibold text-purple-700 hover:text-purple-900 flex items-center gap-1"
                  >
                    {copiedId === 'py' ? '✓ Copied Python Code!' : '📋 Copy Python Code'}
                  </button>
                </div>
                <pre className="bg-gray-900 text-purple-200 rounded-xl p-3 text-xs font-mono overflow-x-auto leading-relaxed border border-gray-800">
{`# Report software bug directly to Admin Tickets Desk
import requests

response = requests.post(
    "${serverHost || 'https://your-domain.com'}/api/tickets",
    headers={"Authorization": "Bearer ${selectedSite.api_key || 'YOUR_SITE_API_KEY'}"},
    json={
        "site_id": "${selectedSite.id}",
        "channel_type": "software",
        "subject": "Crash in automation resolver",
        "priority": "high",
        "error_log": "Traceback (most recent call last): ...",
        "version": "1.0.0"
    }
)`}
                </pre>
              </div>
            </div>

            {/* Backend Configuration Summary */}
            <div className="pt-2 border-t border-gray-100 grid grid-cols-1 sm:grid-cols-3 gap-2.5 text-xs">
              <div className="bg-gray-50 p-2.5 rounded-lg border border-gray-100">
                <span className="font-semibold text-gray-800 block">✈️ Telegram Bots</span>
                <span className="text-gray-500 text-[11px]">
                  Managed in code presets: <code className="text-blue-700">data/sites/{selectedSite.id}.json</code>
                </span>
              </div>
              <div className="bg-gray-50 p-2.5 rounded-lg border border-gray-100">
                <span className="font-semibold text-gray-800 block">✉️ Email Support</span>
                <span className="text-gray-500 text-[11px]">
                  Configured via server SMTP and routed automatically.
                </span>
              </div>
              <div className="bg-gray-50 p-2.5 rounded-lg border border-gray-100">
                <span className="font-semibold text-gray-800 block mb-1">🤖 AI Reply Control</span>
                <div className="flex flex-col gap-0.5 text-[11px]">
                  <span>
                    🌐 Widget: <span className={getChannelAiReply(selectedSite, 'widget') ? 'text-emerald-600 font-semibold' : 'text-rose-600 font-semibold'}>{getChannelAiReply(selectedSite, 'widget') ? 'ON' : 'OFF'}</span>
                  </span>
                  <span>
                    ✈️ Telegram: <span className={getChannelAiReply(selectedSite, 'telegram') ? 'text-emerald-600 font-semibold' : 'text-rose-600 font-semibold'}>{getChannelAiReply(selectedSite, 'telegram') ? 'ON' : 'OFF'}</span>
                  </span>
                  <span>
                    ✉️ Email: <span className={getChannelAiReply(selectedSite, 'email') ? 'text-emerald-600 font-semibold' : 'text-rose-600 font-semibold'}>{getChannelAiReply(selectedSite, 'email') ? 'ON' : 'OFF'}</span>
                  </span>
                  <span className="text-gray-400 mt-0.5">Edit <code className="text-blue-700">data/sites/{selectedSite.id}.json</code></span>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Close button */}
        <div className="flex justify-end pt-2">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 bg-gray-100 hover:bg-gray-200 text-gray-700 font-semibold rounded-lg text-xs transition"
          >
            Close Docs
          </button>
        </div>
      </div>
    </Modal>
  );
}
