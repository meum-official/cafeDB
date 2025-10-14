import dayjs from 'dayjs';
import { fetchCafes } from './sheet.js';
import { loadKakao, initMap, renderMarkers } from './map.js';
import {
    SIZE_TAGS,
    PARKING_TAGS,
    TABLE_SHAPES,
    TABLE_HEIGHTS,
    num,
    getDistance,
    normalizeHeight,
    toSizeTagFromPyeong,
    debounce,
} from './utils.js';

let map,
    clusterer,
    myLL,
    cafes = [],
    filtered = [];

const $ = (sel) => document.querySelector(sel);
const chips = (id, arr) => {
    const el = $(id);
    el.innerHTML = arr.map((x) => `<button type="button" class="chip">${x}</button>`).join('');
    el.querySelectorAll('.chip').forEach((c) => (c.onclick = () => c.classList.toggle('active')));
};

function getState() {
    const activeTexts = (sel) =>
        Array.from(document.querySelectorAll(sel + ' .chip.active')).map((e) => e.textContent);
    return {
        nearMe: $('#nearMe').checked,
        inView: $('#inView').checked,
        sizeTags: activeTexts('#sizeChips'),
        parkingTags: activeTexts('#parkingChips'),
        freeOnly: $('#freeOnly').checked,
        wheel: $('#wheel').checked,
        elev: $('#elev').checked,
        pet: $('#pet').checked,
        kids: $('#kids').checked,
        wifi: $('#wifi').checked,
        power: $('#power').checked,
        shapes: activeTexts('#shapeChips'),
        heights: activeTexts('#heightChips'),
        pMin: +$('#pMin').value,
        pMax: +$('#pMax').value,
        dessert: $('#dessert').checked,
        wcClean: $('#wcClean').value,
        wcLoc: $('#wcLoc').value,
        openNow: $('#openNow').checked,
        updatedThisYear: $('#updatedThisYear').checked,
    };
}

function isOpenNow(json) {
    if (!json) return false;
    try {
        const d = typeof json === 'string' ? JSON.parse(json) : json;
        const now = dayjs();
        const key = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'][now.day()];
        const [o, c] = d.openHour?.[key] || [];
        if (!o || !c) return false;
        const t = now.format('HH:mm');
        return o <= t && t <= c;
    } catch {
        return false;
    }
}

function applyFilters() {
    const s = getState();
    const center = map.getCenter();
    const base = myLL || center;

    filtered = cafes.filter((c) => {
        if (!num(c.위도) || !num(c.경도)) return false;

        if (s.nearMe) {
            const d = getDistance(base.getLat(), base.getLng(), c.위도, c.경도);
            if (d > 2000) return false;
        }
        if (s.inView) {
            if (!map.getBounds().contain(new kakao.maps.LatLng(c.위도, c.경도))) return false;
        }
        if (s.sizeTags.length) {
            const tag = (c.간단크기비교 || toSizeTagFromPyeong(c.평수) || '').trim();
            if (!s.sizeTags.includes(tag)) return false;
        }
        if (s.parkingTags.length || s.freeOnly) {
            const p = String(c.주차타입 || '').replaceAll(' ', '');
            if (s.parkingTags.length && !s.parkingTags.some((t) => p.includes(t))) return false;
            if (s.freeOnly && !/무료/.test(p)) return false;
        }
        if (
            s.wheel &&
            !/가능|있음|true|o/i.test(String(c['휠체어/유모차 가능'] || c.휠체어유모차가능 || ''))
        )
            return false;
        if (
            s.elev &&
            !/가능|있음|true|o/i.test(String(c['엘레베이터유무'] || c.엘레베이터유무 || ''))
        )
            return false;
        if (
            s.pet &&
            !/가능|있음|true|o/i.test(String(c['애완동물동반 가능'] || c.애완동물동반가능 || ''))
        )
            return false;
        if (s.kids && !/가능|있음|true|o/i.test(String(c['키즈 가능'] || c.키즈가능 || '')))
            return false;
        if (s.wifi && !/가능|있음|true|o/i.test(String(c['와이파이'] || c.와이파이 || '')))
            return false;
        if (s.power && !/가능|있음|true|o/i.test(String(c['콘센트 유무'] || c.콘센트유무 || '')))
            return false;

        if (s.shapes.length) {
            const shape = String(c['테이블형태'] || '');
            if (!s.shapes.some((x) => shape.includes(x))) return false;
        }
        if (s.heights.length) {
            const h = normalizeHeight(String(c['테이블 높이'] || ''));
            if (!s.heights.some((x) => h.includes(x))) return false;
        }

        const price = num(c['기본커피가격'] || c['기본커피(아메리카노)가격'] || c.기본커피가격);
        if (price != null && (price < s.pMin || price > s.pMax)) return false;

        if (s.dessert && !/있음|y|true|o/i.test(String(c['디저트유무'] || c.디저트유무 || '')))
            return false;
        if (s.wcClean && String(c['화장실 청결도'] || '').trim() !== s.wcClean) return false;
        if (s.wcLoc && String(c['화장실 실내/야외'] || '').trim() !== s.wcLoc) return false;
        if (s.openNow && !isOpenNow(c['오픈시간'] || c['opening hour'])) return false;

        if (s.updatedThisYear) {
            const y = dayjs(String(c['최근 방문(업데이트일자)'] || c['updatedAt'] || '')).year();
            if (!y || y !== dayjs().year()) return false;
        }
        return true;
    });

    renderMarkers(map, clusterer, filtered);
    $('#stats').textContent = `${filtered.length} / ${cafes.length}`;
}

function bindUI() {
    // 패널 토글
    const panel = $('#panel');
    const open = () => panel.classList.add('open');
    const close = () => panel.classList.remove('open');
    $('#fabFilter').onclick = open;
    $('#btnClose').onclick = close;

    $('#apply').onclick = () => {
        applyFilters();
        close();
    };
    $('#btnReset').onclick = () => {
        panel.querySelectorAll('input[type=checkbox]').forEach((x) => (x.checked = false));
        panel.querySelectorAll('.chip.active').forEach((x) => x.classList.remove('active'));
        $('#pMin').value = 0;
        $('#pMax').value = 15000;
        $('#pMinLbl').textContent = '0';
        $('#pMaxLbl').textContent = '15,000';
        $('#wcClean').value = '';
        $('#wcLoc').value = '';
        applyFilters();
    };
    // 가격 라벨
    const syncLbl = () => {
        $('#pMinLbl').textContent = (+$('#pMin').value).toLocaleString();
        $('#pMaxLbl').textContent = (+$('#pMax').value).toLocaleString();
        if (+$('#pMin').value > +$('#pMax').value) $('#pMax').value = $('#pMin').value;
    };
    $('#pMin').oninput = () => {
        syncLbl();
        debounce(applyFilters, 80)();
    };
    $('#pMax').oninput = () => {
        syncLbl();
        debounce(applyFilters, 80)();
    };

    // 지도 이동 시 자동필터
    kakao.maps.event.addListener(
        map,
        'idle',
        debounce(() => {
            if ($('#inView').checked) applyFilters();
        }, 200)
    );
}

(async function bootstrap() {
    // 칩 UI 구성
    chips('#sizeChips', SIZE_TAGS);
    chips('#parkingChips', PARKING_TAGS);
    chips('#shapeChips', TABLE_SHAPES);
    chips('#heightChips', TABLE_HEIGHTS);

    // 카카오 로드 & 지도
    await loadKakao();
    await new Promise((r) => kakao.maps.load(r));
    await new Promise((res) => {
        navigator.geolocation.getCurrentPosition(
            (p) => {
                myLL = new kakao.maps.LatLng(p.coords.latitude, p.coords.longitude);
                const r = initMap(p.coords.latitude, p.coords.longitude);
                map = r.map;
                clusterer = r.clusterer;
                res();
            },
            () => {
                const r = initMap(37.5665, 126.978);
                map = r.map;
                clusterer = r.clusterer;
                res();
            }
        );
    });

    // 시트 로드
    cafes = await fetchCafes();

    // 숫자화 (위도/경도)
    cafes = cafes.map((c) => ({
        ...c,
        위도: num(c.위도 || c.lat),
        경도: num(c.경도 || c.lng),
    }));

    bindUI();
    applyFilters();
})();
