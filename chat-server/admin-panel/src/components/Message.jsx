import { useEffect, useState } from 'react';
import { getTimeString } from '../utils/dateUtils';
import { linkify } from '../utils/linkUtils';

export function Message({ message, config, onDelete }) {
  const [showDelete, setShowDelete] = useState(false);
  const [mediaSources, setMediaSources] = useState({ key: '', urls: [] });
  const isClient = message.sender === 'client';
  const label = message.sender === 'internal_team' ? 'Human agent' : message.sender === 'support' ? 'AI support' : (isClient ? 'Customer' : 'Support');
  const media = String(message.text || '').match(/\/api\/telegram\/(?:users\/[^\s]+|messages\/\d+\/media)/g) || [];
  const mediaKey = media.join('|');
  const messageText = String(message.text || '');
  useEffect(() => {
    let cancelled = false;
    let objectUrls = [];
    const paths = messageText.match(/\/api\/telegram\/(?:users\/[^\s]+|messages\/\d+\/media)/g) || [];
    Promise.all(paths.map(url => fetch(url, { headers: { Authorization: `Bearer ${config?.apiToken || ''}` } }).then(response => {
      if (!response.ok) throw new Error('Image unavailable');
      return response.blob();
    }).then(blob => URL.createObjectURL(blob)).catch(() => ''))).then(result => {
      objectUrls = result.filter(Boolean);
      if (!cancelled) setMediaSources({ key: messageText, urls: objectUrls });
      else objectUrls.forEach(URL.revokeObjectURL);
    });
    return () => {
      cancelled = true;
      objectUrls.forEach(URL.revokeObjectURL);
    };
  }, [message.id, config?.apiToken, mediaKey, messageText]);
  const bodyText = messageText.replace(/\/api\/telegram\/(?:users\/[^\s]+|messages\/\d+\/media)/g, '').trim();

  const renderText = (text) => {
    const parts = linkify(text);
    return parts.map((part) => {
      if (part.type === 'link') {
        return (
          <a
            key={part.key}
            href={part.url}
            target="_blank"
            rel="noopener noreferrer"
            className="text-blue-600 dark:text-blue-300 hover:underline break-all"
          >
            {part.url}
          </a>
        );
      }
      return <span key={part.key}>{part.content}</span>;
    });
  };

  return (
    <div
      className={`flex mb-3 ${isClient ? 'justify-start' : 'justify-end'} ${message.status === 'pending' || message.status === 'unconfirmed' ? 'opacity-70' : ''}`}
      onMouseEnter={() => setShowDelete(true)}
      onMouseLeave={() => setShowDelete(false)}
      onFocus={() => setShowDelete(true)} onBlur={e => { if (!e.currentTarget.contains(e.relatedTarget)) setShowDelete(false); }}
    >
      <div className={`relative max-w-[min(78%,52rem)] group chat-bubble`}>
        {/* Delete button */}
        {showDelete && (
          <button
            onClick={onDelete}
            className={`absolute top-1 ${isClient ? '-right-6' : '-left-6'} p-1 text-gray-400 hover:text-red-500 opacity-100 sm:opacity-0 sm:group-hover:opacity-100 focus:opacity-100 transition-opacity`}
            title="Delete message" aria-label="Delete message"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
            </svg>
          </button>
        )}

        {/* Message bubble */}
        <div
          className={`px-4 py-2 rounded-2xl break-words ${
            isClient
              ? 'bg-white dark:bg-[#1e293b] border border-gray-200 dark:border-slate-700 text-gray-800 dark:text-slate-100 rounded-bl-md shadow-sm'
              : message.sender === 'support' ? 'bg-indigo-700 text-white rounded-br-md shadow-sm' : 'bg-blue-600 text-white rounded-br-md shadow-sm'
          }`}
        >
          <div className={`mb-1 text-[10px] font-semibold uppercase tracking-wide ${isClient ? 'text-gray-400' : 'text-blue-100'}`}>{label}</div>
          <div className="whitespace-pre-wrap break-words">{bodyText && renderText(bodyText)}{(mediaSources.key === messageText ? mediaSources.urls : []).map((url, i) => <img key={`${message.id}-image-${i}`} src={url} alt="Image attachment" loading="lazy" className="mt-2 max-h-96 max-w-full rounded-xl object-contain" onError={e => { e.currentTarget.alt = 'Image could not be loaded'; }} />)}</div>
        </div>

        {/* Timestamp */}
        <div
          className={`text-xs text-gray-400 mt-1 ${
            isClient ? 'text-left' : 'text-right'
          }`}
        >
          {message.status === 'pending' ? 'Sending…' : message.status === 'unconfirmed' ? 'Send unconfirmed - syncing…' : getTimeString(message.timestamp, config.timeFormat, config.timezone)}
        </div>
      </div>
    </div>
  );
}
