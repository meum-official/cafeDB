import Papa from 'papaparse';

/**
 * 공개된 시트를 CSV로 읽어옵니다.
 * 탭 이름은 VITE_SHEET_TAB 사용. (문자 그대로 시트 탭명)
 */
export async function fetchCafes() {
    const sheetId = import.meta.env.VITE_SHEET_ID;
    const tab = encodeURIComponent(import.meta.env.VITE_SHEET_TAB || 'cafe_db');
    const url = `https://docs.google.com/spreadsheets/d/${sheetId}/gviz/tq?tqx=out:csv&sheet=${tab}`;
    const res = await fetch(url, { cache: 'no-store' });
    if (!res.ok) throw new Error('Sheet fetch failed');
    const csv = await res.text();

    const parsed = Papa.parse(csv, { header: true, skipEmptyLines: true });
    return parsed.data; // [{카페명:..., 주소:..., 위도:..., 경도:..., ...}, ...]
}
