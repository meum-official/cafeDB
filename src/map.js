import { esc } from './utils.js';

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
    const clusterer = new kakao.maps.MarkerClusterer({ map, averageCenter: true, minLevel: 6 });
    return { map, clusterer };
}

export function renderMarkers(map, clusterer, list) {
    clusterer.clear();
    const markers = list.map((c) => {
        const pos = new kakao.maps.LatLng(c.위도, c.경도);
        const m = new kakao.maps.Marker({ position: pos });
        const iw = new kakao.maps.InfoWindow({
            content: `
      <div style="padding:6px 8px;font-size:12px;max-width:240px">
        <div class="font-semibold">${esc(c.name || c.카페명 || '카페')}</div>
        <div style="color:#64748b">${esc(c.address || c.주소 || '')}</div>
      </div>`,
        });
        kakao.maps.event.addListener(m, 'click', () => iw.open(map, m));
        return m;
    });
    clusterer.addMarkers(markers);
}
