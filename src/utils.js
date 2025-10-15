export const SIZE_TAGS = ['초소형', '소형', '중형', '대형', '초대형'];
export const PARKING_TAGS = [
    '자체주차장',
    '외부주차장',
    '조건부주차장',
    '주차불가',
    '지하',
    '무료',
    '유료가능',
];
export const TABLE_SHAPES = ['네모', '원형', '비정형'];
export const TABLE_HEIGHTS = ['낮은', '중간', '높은'];

export const esc = (s) =>
    String(s || '').replace(
        /[&<>"']/g,
        (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]
    );
export const num = (v) => {
    if (v == null || v === '') return null;
    const n = Number(String(v).replace(/[^0-9.-]/g, ''));
    return Number.isNaN(n) ? null : n;
};
export const debounce = (fn, wait = 120) => {
    let t;
    return (...a) => {
        clearTimeout(t);
        t = setTimeout(() => fn(...a), wait);
    };
};
export const getDistance = (lat1, lng1, lat2, lng2) => {
    const R = 6371e3,
        rad = Math.PI / 180,
        dLat = (lat2 - lat1) * rad,
        dLng = (lng2 - lng1) * rad;
    const a =
        Math.sin(dLat / 2) ** 2 +
        Math.cos(lat1 * rad) * Math.cos(lat2 * rad) * Math.sin(dLng / 2) ** 2;
    return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
};
export const normalizeHeight = (s) => {
    s = String(s || '');
    if (/작업|70~85|높/i.test(s)) return '높은';
    if (/중간|일반/i.test(s)) return '중간';
    if (/낮|소파|로우/i.test(s)) return '낮은';
    return s.trim();
};
export const toSizeTagFromPyeong = (p) => {
    const v = num(p);
    if (v == null) return '';
    if (v < 10) return '초소형';
    if (v < 20) return '소형';
    if (v < 40) return '중형';
    if (v < 70) return '대형';
    return '초대형';
};
