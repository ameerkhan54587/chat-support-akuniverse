import { useEffect, useState } from 'react';

export function ConsoleAvatar({ userId, info = {}, initial = '?', apiToken, size = 'w-10 h-10' }) {
  const [avatar, setAvatar] = useState({ key: '', src: '', broken: false });
  const isTelegram = String(userId || '').startsWith('telegram:') && info.site_id && info.user_id;
  const photo = isTelegram ? `/api/telegram/users/${encodeURIComponent(info.site_id)}/${encodeURIComponent(info.user_id)}/photo` : info.avatar_url || '';
  const current = avatar.key === photo && !avatar.broken;
  useEffect(() => {
    if (!photo || !apiToken) return undefined;
    let cancelled = false; let objectUrl = '';
    fetch(photo, { headers: { Authorization: `Bearer ${apiToken}` } }).then(r => { if (!r.ok) throw new Error('Avatar unavailable'); return r.blob(); }).then(blob => { objectUrl = URL.createObjectURL(blob); if (!cancelled) setAvatar({ key: photo, src: objectUrl, broken: false }); else URL.revokeObjectURL(objectUrl); }).catch(() => { if (!cancelled) setAvatar({ key: photo, src: '', broken: true }); });
    return () => { cancelled = true; if (objectUrl) URL.revokeObjectURL(objectUrl); };
  }, [photo, apiToken]);
  return current && avatar.src ? <img src={avatar.src} alt="" loading="lazy" onError={() => setAvatar({ key: photo, src: '', broken: true })} className={`${size} shrink-0 rounded-full object-cover bg-slate-700`} /> : <span className={`${size} shrink-0 rounded-full inline-flex items-center justify-center bg-slate-500 text-white font-bold`}>{initial}</span>;
}
