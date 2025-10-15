import { esc } from './utils.js';

let markerImage;
let activeInfoWindow = null;

function getMarkerImage() {
    if (markerImage) return markerImage;
    const svg = `
<svg width="44" height="56" viewBox="0 0 44 56" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <linearGradient id="grad" x1="22" y1="0" x2="22" y2="44" gradientUnits="userSpaceOnUse">
      <stop offset="0" stop-color="#f97316"/>
      <stop offset="1" stop-color="#ef4444"/>
    </linearGradient>
    <filter id="shadow" x="0" y="0" width="44" height="56" filterUnits="userSpaceOnUse">
      <feDropShadow dx="0" dy="6" stdDeviation="6" flood-color="#0f172a" flood-opacity="0.25"/>
    </filter>
  </defs>
  <g filter="url(#shadow)">
    <path d="M22 2C11.3 2 2.5 10.73 2.5 21.3c0 13.65 12.19 28.02 17.5 32.3a2 2 0 0 0 2.5 0c5.31-4.28 17.5-18.65 17.5-32.3C40 10.73 32.7 2 22 2z" fill="url(#grad)"/>
    <circle cx="22" cy="20" r="8" fill="#fff" fill-opacity="0.9"/>
  </g>
</svg>`.trim();
    const src = `data:image/svg+xml;charset=UTF-8,${encodeURIComponent(svg)}`;
    markerImage = new kakao.maps.MarkerImage(
        src,
        new kakao.maps.Size(44, 56),
        { offset: new kakao.maps.Point(22, 56) }
    );
    return markerImage;
}

export async function loadKakao() {
    const key = import.meta.env.VITE_KAKAO_JS_KEY;
    const src = `https://dapi.kakao.com/v2/maps/sdk.js?appkey=${key}&libraries=clusterer&autoload=false`;
    await new Promise((res, rej) => {
        const s = document.createElement('script');
        s.src = src;
        s.async = true;
        s.onload = res;
        s.onerror = () => rej(new Error('SDK load error'));
        document.head.appendChild(s);
    });
    if (!window.kakao) throw new Error('kakao undefined');
}

export function initMap(lat, lng) {
    const map = new kakao.maps.Map(document.getElementById('map'), {
        center: new kakao.maps.LatLng(lat, lng),
        level: 5,
    });
    map.setDraggable(true); // ensure mobile drag remains enabled
    map.setZoomable(true);
    const clusterer = new kakao.maps.MarkerClusterer({ map, averageCenter: true, minLevel: 6 });
    return { map, clusterer };
}

function parseOpening(opening) {
    try {
        if (!opening) return null;
        const d = typeof opening === 'string' ? JSON.parse(opening) : opening;
        return d;
    } catch {
        return null;
    }
}

function buildModalHTML(c) {
    const oh = parseOpening(c.opening_hour);
    const lastOrder = oh?.lastOrder ? ` (라스트오더 ${oh.lastOrder})` : '';
    const features = [
        c.size_tag ? `📏 ${esc(c.size_tag)}` : '',
        c.pyeong != null ? `📐 ${esc(String(c.pyeong))}평` : '',
        c.price != null ? `☕ ₩${Number(c.price).toLocaleString()}` : '',
        c.parking_type ? `🅿 ${esc(c.parking_type)}` : '',
        c.wheel ? '♿ 가능' : '',
        c.elevator ? '🛗 있음' : '',
        c.pet_allowed ? '🐶 동반' : '',
        c.kids_allowed ? '👶 키즈' : '',
        c.wifi ? '📶 와이파이' : '',
        c.outlet ? '🔌 콘센트' : '',
        c.table_shape ? `🪑 ${esc(c.table_shape)}` : '',
        c.table_height ? `↕ ${esc(c.table_height)}` : '',
        c.toilet_indoor_outdoor ? `🚻 ${esc(c.toilet_indoor_outdoor)}` : '',
        c.toilet_cleaning ? `✨ ${esc(c.toilet_cleaning)}` : '',
    ].filter(Boolean);
    const kakao = `https://map.kakao.com/link/to/${encodeURIComponent(c.name || '카페')},${c.lat},${c.lng}`;
    const naver = `https://map.naver.com/v5/directions?destination=${c.lng},${c.lat},${encodeURIComponent(c.name || '카페')}`;
    const google = `https://www.google.com/maps/dir/?api=1&destination=${c.lat},${c.lng}`;

    return `
      <h2 class="title">${esc(c.name || '카페')}</h2>
      <div class="subtitle">${esc(c.address || '')}</div>
      ${oh ? `<div class="row">🕒 ${esc(Object.keys(oh.openHour||{}).map(k=>`${k}: ${oh.openHour[k]?.[0]||''}~${oh.openHour[k]?.[1]||''}`).join(' · '))}${lastOrder}</div>` : ''}
      <div class="row">${features.map(f=>`<span class="badge">${f}</span>`).join(' ')}</div>
      <div class="actions">
        <a class="btn" target="_blank" rel="noopener" href="${kakao}">카카오 길찾기</a>
        <a class="btn" target="_blank" rel="noopener" href="${naver}">네이버 길찾기</a>
        <a class="btn" target="_blank" rel="noopener" href="${google}">구글 길찾기</a>
      </div>
    `;
}

function openModal(c) {
    const modal = document.getElementById('modal');
    const content = document.getElementById('modalContent');
    const closeBtn = document.getElementById('modalClose');
    const backdrop = document.getElementById('modalBackdrop');
    if (!modal || !content) return;
    content.innerHTML = buildModalHTML(c);
    modal.classList.add('open');
    const close = () => modal.classList.remove('open');
    if (backdrop) backdrop.onclick = close;
    if (closeBtn) closeBtn.onclick = close;
    document.onkeydown = (e) => { if (e.key === 'Escape') close(); };
}

export function renderMarkers(map, clusterer, list) {
    clusterer.clear();
    const image = getMarkerImage();
    const markers = list
        .filter((c) => c.lat != null && c.lng != null)
        .map((c) => {
        const pos = new kakao.maps.LatLng(c.lat ?? c['\uC704\uB3C4'], c.lng ?? c['\uACBD\uB3C4']);
        const m = new kakao.maps.Marker({
            position: pos,
            image,
            title: String(c.name || c['\uCE74\uD398\uBA85'] || '\uCE74\uD398'),
            zIndex: 2,
        });
        kakao.maps.event.addListener(m, 'click', () => openModal(c));
        return m;
    });
    clusterer.addMarkers(markers);
}
