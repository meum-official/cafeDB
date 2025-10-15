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
    userLL,
    searchCenter,
    activeBounds = null,
    cafes = [],
    filtered = [],
    mapDragged = false;

let searchBtn;

const SEARCH_HERE_THRESHOLD_M = 150;

const $ = (sel) => document.querySelector(sel);
const chips = (id, arr) => {
    const el = $(id);
    el.innerHTML = arr.map((x) => `<button type="button" class="chip">${x}</button>`).join('');
    el.querySelectorAll('.chip').forEach((c) => (c.onclick = () => c.classList.toggle('active')));
};
const panelOpen = () => $('#panel')?.classList.contains('open') ?? false;
const captureBounds = (bounds) => {
    if (!bounds) return null;
    const sw = bounds.getSouthWest();
    const ne = bounds.getNorthEast();
    return { swLat: sw.getLat(), swLng: sw.getLng(), neLat: ne.getLat(), neLng: ne.getLng() };
};
const boundsChanged = (prev, next) => {
    if (!prev || !next) return true;
    const tol = 0.0003;
    return (
        Math.abs(prev.swLat - next.swLat) > tol ||
        Math.abs(prev.swLng - next.swLng) > tol ||
        Math.abs(prev.neLat - next.neLat) > tol ||
        Math.abs(prev.neLng - next.neLng) > tol
    );
};
const syncActiveAreaWithMap = () => {
    if (!map) return;
    activeBounds = captureBounds(map.getBounds());
    searchCenter = map.getCenter();
};

function getState() {
    const activeTexts = (sel) =>
        Array.from(document.querySelectorAll(sel + ' .chip.active')).map((e) => e.textContent);
    return {
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
        priceMin: +$('#priceMin').value,
        priceMax: +$('#priceMax').value,
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

function applyFilters({ ignoreConditions = false } = {}) {
    const s = getState();
    if (!map) return;
    const bounds = activeBounds;
    const truthy = (v) => /true|y|yes|가능|있음|o/i.test(String(v || '').trim());

    filtered = cafes.filter((c) => {
        const { lat, lng } = c;
        if (lat == null || lng == null) return false;

        if (bounds) {
            if (
                lat < bounds.swLat ||
                lat > bounds.neLat ||
                lng < bounds.swLng ||
                lng > bounds.neLng
            )
                return false;
        }
        if (ignoreConditions) return true;

        if (s.sizeTags.length) {
            const tag = (c.size_tag || toSizeTagFromPyeong(c.pyeong) || '').trim();
            if (!s.sizeTags.includes(tag)) return false;
        }
        if (s.freeOnly) {
            const fee = String(c.parking_fee || '').trim();
            if (!/무료|free|0원/i.test(fee)) return false;
        } else if (s.parkingTags.length) {
            const pt = String(c.parking_type || '').replaceAll(' ', '');
            const fee = String(c.parking_fee || '').replaceAll(' ', '');
            const matchTag = (t) => {
                switch (t) {
                    case '주차불가':
                        return /주차불가/.test(pt);
                    case '자체주차장':
                        return /자체주차장|자체/.test(pt);
                    case '외부주차장':
                        return /외부주차장|외부/.test(pt);
                    case '조건부주차장':
                        return /조건부주차장|조건부/.test(pt);
                    case '지하':
                        return /지하/.test(pt);
                    case '무료':
                        return /무료|free|0원/i.test(fee) || /무료|free/i.test(pt);
                    case '유료가능':
                        return !/무료|free|0원/i.test(fee) && !/주차불가/.test(pt);
                    default:
                        return pt.includes(t);
                }
            };
            if (!s.parkingTags.some(matchTag)) return false;
        }
        if (s.wheel && !truthy(c.wheel)) return false;
        if (s.elev && !truthy(c.elevator)) return false;
        if (s.pet && !truthy(c.pet_allowed)) return false;
        if (s.kids && !truthy(c.kids_allowed)) return false;
        if (s.wifi && !truthy(c.wifi)) return false;
        if (s.power && !truthy(c.outlet)) return false;

        if (s.shapes.length) {
            const shape = String(c.table_shape || '');
            if (!s.shapes.some((x) => shape.includes(x))) return false;
        }
        if (s.heights.length) {
            const h = normalizeHeight(String(c.table_height || ''));
            if (!s.heights.some((x) => h.includes(x))) return false;
        }

        const price = num(c.price);
        if (price != null && (price < s.priceMin || price > s.priceMax)) return false;

        if (s.dessert && !truthy(c.dessert)) return false;
        if (s.wcClean && String(c.toilet_cleaning || '').trim() !== s.wcClean) return false;
        if (s.wcLoc && String(c.toilet_indoor_outdoor || '').trim() !== s.wcLoc) return false;
        if (s.openNow && !isOpenNow(c.opening_hour)) return false;
        if (s.updatedThisYear) {
            const y = dayjs(String(c.last_visit || c.updatedAt || '')).year();
            if (!y || y !== dayjs().year()) return false;
        }
        return true;
    });

    renderMarkers(map, clusterer, filtered);
    $('#stats').textContent = `${filtered.length} / ${cafes.length}`;
    updateSearchHereButton();
}

function hideSearchHereButton() {
    if (searchBtn) searchBtn.classList.remove('show');
}

function updateSearchHereButton() {
    if (!searchBtn || !map) return;
    if (panelOpen()) {
        hideSearchHereButton();
        return;
    }
    if (!mapDragged) {
        hideSearchHereButton();
        return;
    }
    const center = map.getCenter();
    const dist = searchCenter
        ? getDistance(
              center.getLat(),
              center.getLng(),
              searchCenter.getLat(),
              searchCenter.getLng()
          )
        : Infinity;
    const currentBounds = captureBounds(map.getBounds());
    const changed = boundsChanged(activeBounds, currentBounds);
    if (dist > SEARCH_HERE_THRESHOLD_M || changed) searchBtn.classList.add('show');
    else hideSearchHereButton();
}

function bindUI() {
    const panel = $('#panel');
    const open = () => {
        panel.classList.add('open');
        hideSearchHereButton();
    };
    const close = () => {
        panel.classList.remove('open');
        updateSearchHereButton();
    };
    $('#fabFilter').onclick = open;
    $('#btnClose').onclick = close;

    searchBtn = $('#btnSearchHere');
    if (searchBtn) {
        searchBtn.onclick = () => {
            if (!map) return;
            syncActiveAreaWithMap();
            applyFilters();
            mapDragged = false;
            hideSearchHereButton();
        };
    }

    const showAllBtn = document.getElementById('btnShowAll');
    if (showAllBtn) {
        showAllBtn.onclick = () => {
            syncActiveAreaWithMap();
            applyFilters({ ignoreConditions: true });
            mapDragged = false;
            hideSearchHereButton();
            close();
        };
    }

    const priceMinInput = $('#priceMin');
    const priceMaxInput = $('#priceMax');
    const priceLabel = $('#priceRangeLbl');
    const updatePriceUI = () => {
        const min = +priceMinInput.value;
        const max = +priceMaxInput.value;
        priceLabel.textContent = `${min.toLocaleString()} ~ ${max.toLocaleString()}`;
        const range = priceMaxInput.max - priceMinInput.min;
        const start = ((min - priceMinInput.min) / range) * 100;
        const end = ((max - priceMinInput.min) / range) * 100;
        const track = `linear-gradient(90deg, #e2e8f0 ${start}%, #f97316 ${start}%, #f97316 ${end}%, #e2e8f0 ${end}%)`;
        priceMinInput.style.background = track;
        priceMaxInput.style.background = track;
        priceMinInput.style.setProperty('--range-track', track);
        priceMaxInput.style.setProperty('--range-track', track);
    };
    const applyFiltersDebounced = debounce(applyFilters, 120);
    // ensure active thumb is always on top
    const bringToFront = (which) => {
        if (which === 'min') {
            priceMinInput.style.zIndex = 3;
            priceMaxInput.style.zIndex = 2;
        } else {
            priceMinInput.style.zIndex = 2;
            priceMaxInput.style.zIndex = 3;
        }
    };

    const parkingChips = $('#parkingChips');

    priceMinInput.oninput = () => {
        if (+priceMinInput.value > +priceMaxInput.value) priceMaxInput.value = priceMinInput.value;
        updatePriceUI();
        applyFiltersDebounced();
    };
    priceMinInput.onpointerdown = () => bringToFront('min');
    priceMinInput.onfocus = () => bringToFront('min');
    $('#freeOnly').onchange = () => {
        if (parkingChips) parkingChips.style.display = $('#freeOnly').checked ? 'none' : '';
        applyFiltersDebounced();
    };
    priceMaxInput.oninput = () => {
        if (+priceMaxInput.value < +priceMinInput.value) priceMinInput.value = priceMaxInput.value;
        updatePriceUI();
        applyFiltersDebounced();
    };
    priceMaxInput.onpointerdown = () => bringToFront('max');
    priceMaxInput.onfocus = () => bringToFront('max');
    $('#apply').onclick = () => {
        applyFilters();
        close();
    };

    const resetFilters = () => {
        panel.querySelectorAll('.chip.active').forEach((x) => x.classList.remove('active'));
        panel.querySelectorAll('input[type=checkbox]').forEach((x) => {
            x.checked = x.id === 'openNow';
        });
        priceMinInput.value = priceMinInput.min;
        priceMaxInput.value = priceMaxInput.max;
        updatePriceUI();
        $('#wcClean').value = '';
        $('#wcLoc').value = '';
    };

    $('#btnReset').onclick = () => {
        resetFilters();
        syncActiveAreaWithMap();
        applyFilters();
        mapDragged = false;
        hideSearchHereButton();
    };

    updatePriceUI();
    $('#openNow').checked = true;

    const onIdle = debounce(() => {
        updateSearchHereButton();
    }, 200);
    kakao.maps.event.addListener(map, 'idle', onIdle);
    kakao.maps.event.addListener(map, 'dragstart', () => {
        mapDragged = true;
        updateSearchHereButton();
    });
    kakao.maps.event.addListener(map, 'zoom_changed', () => {
        mapDragged = true;
        updateSearchHereButton();
    });
}

(async function bootstrap() {
    chips('#sizeChips', SIZE_TAGS);
    chips('#parkingChips', PARKING_TAGS);
    chips('#shapeChips', TABLE_SHAPES);
    chips('#heightChips', TABLE_HEIGHTS);

    await loadKakao();
    await new Promise((r) => kakao.maps.load(r));
    await new Promise((res) => {
        navigator.geolocation.getCurrentPosition(
            (p) => {
                userLL = new kakao.maps.LatLng(p.coords.latitude, p.coords.longitude);
                const r = initMap(p.coords.latitude, p.coords.longitude);
                map = r.map;
                clusterer = r.clusterer;
                syncActiveAreaWithMap();
                res();
            },
            () => {
                const r = initMap(37.5665, 126.978);
                map = r.map;
                clusterer = r.clusterer;
                syncActiveAreaWithMap();
                res();
            }
        );
    });

    cafes = await fetchCafes();

    const pick = (obj, keys) => {
        for (const k of keys) {
            const v = obj?.[k];
            if (v != null && v !== '') return v;
        }
        return null;
    };
    cafes = cafes.map((c) => {
        const lat = num(pick(c, ['lng Y', 'Y', 'lat', '위도']));
        const lng = num(pick(c, ['lat X', 'X', 'lng', '경도']));

        const name = pick(c, ['name', 'name 카페 이름', '카페 이름', '카페명']);
        const address = pick(c, ['address', 'address 주소', '주소']);

        const pyeong = num(pick(c, ['scale 평수', 'scale']));
        const size_tag = pick(c, ['간단크기비교']);

        const parking_type = pick(c, ['parking_type', 'parking_type 주차타입', '주차타입']);
        const parking_fee = pick(c, [
            'parking_fee',
            'parking_fee 주차요금(이용시)',
            '주차요금(이용시)',
        ]);

        const wheel = pick(c, [
            'wheelchair/stroller',
            'wheelchair/stroller 휠체어/유모차 가능',
            '휠체어/유모차 가능',
        ]);
        const elevator = pick(c, ['elevator', 'elevator 엘레베이터유무', '엘레베이터유무']);
        const pet_allowed = pick(c, [
            'pet_allowed',
            'pet_allowed 애완동물동반 가능',
            '애완동물동반 가능',
        ]);
        const kids_allowed = pick(c, ['kids_allowed', 'kids_allowed 키즈 가능', '키즈 가능']);
        const wifi = pick(c, ['wifi', 'wifi 와이파이', '와이파이']);
        const outlet = pick(c, ['outlet', 'outlet 콘센트 유무', '콘센트 유무']);

        const table_shape = pick(c, ['table_shape', 'table_shape 테이블형태', '테이블형태']);
        const table_height = pick(c, ['table_height', 'table_height 테이블 높이', '테이블 높이']);

        const price = pick(c, [
            'caffee_price',
            'caffe_price',
            'coffee_price',
            'americano/latte_price',
            'americano_price',
            'latte_price',
            '기본커피가격',
            '기본커피가격',
            '기본커피(아메리카노)가격',
        ]);
        const dessert = pick(c, ['dessert', 'dessert 디저트유무', '디저트유무']);
        const rating = pick(c, ['rating', 'rating 별점', '별점']);

        const toilet_cleaning = pick(c, [
            'toilet cleaning',
            'toilet cleaning 화장실 청결도',
            '화장실 청결도',
        ]);
        const toilet_indoor_outdoor = pick(c, [
            'toilet indoor/outdoor',
            'toilet indoor/outdoor 화장실 실내/야외',
            '화장실 실내/야외',
        ]);
        const opening_hour = JSON.parse(
            pick(c, ['opening hour', 'opening hour 오픈시간', '오픈시간'])
        );
        const last_visit = pick(c, [
            'last_visit',
            'last_visit 최근 방문(업데이트일자)',
            '최근 방문(업데이트일자)',
        ]);

        return {
            id: pick(c, ['id', 'id ']) ?? undefined,
            name,
            address,
            pyeong,
            size_tag,
            parking_type,
            parking_fee,
            wheel,
            elevator,
            pet_allowed,
            kids_allowed,
            wifi,
            outlet,
            table_shape,
            table_height,
            price: num(price),
            dessert,
            rating,
            toilet_cleaning,
            toilet_indoor_outdoor,
            opening_hour,
            last_visit,
            lat,
            lng,
        };
    });
    console.log(cafes);
    bindUI();
    applyFilters();
})();
