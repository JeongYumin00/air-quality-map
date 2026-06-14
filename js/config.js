/**
 * @file config.js
 * @description 웹 서비스의 전역 설정 관리 및 API Key 로컬 스토리지 연동, 카카오맵 SDK 동적 로딩을 수행합니다.
 */

const AppConfig = {
  // 기본 공공데이터 API Key (사용자 제공 키)
  DEFAULT_PUBLIC_DATA_KEY: 'c769543a0b7282cb49915d9717da20ab2122049097023f6b8863ae674cef5140',
  
  // LocalStorage Key 정의
  STORAGE_KEYS: {
    KAKAO_MAP_KEY: 'aeropulse_kakao_key',
    PUBLIC_DATA_KEY: 'aeropulse_public_key'
  },

  /**
   * 카카오맵 JS API 키 획득
   * @returns {string|null} 저장된 카카오맵 API 키
   */
  getKakaoKey() {
    return localStorage.getItem(this.STORAGE_KEYS.KAKAO_MAP_KEY) || null;
  },

  /**
   * 카카오맵 JS API 키 저장
   * @param {string} key 
   */
  setKakaoKey(key) {
    if (key) {
      localStorage.setItem(this.STORAGE_KEYS.KAKAO_MAP_KEY, key.trim());
    } else {
      localStorage.removeItem(this.STORAGE_KEYS.KAKAO_MAP_KEY);
    }
  },

  /**
   * 공공데이터포털 API 키 획득 (사용자 지정 키가 없으면 기본 제공 키 반환)
   * @returns {string} 사용할 공공데이터 API 키
   */
  getPublicKey() {
    const userKey = localStorage.getItem(this.STORAGE_KEYS.PUBLIC_DATA_KEY);
    return userKey ? userKey.trim() : this.DEFAULT_PUBLIC_DATA_KEY;
  },

  /**
   * 공공데이터포털 API 키 저장
   * @param {string} key 
   */
  setPublicKey(key) {
    if (key && key.trim() !== '') {
      localStorage.setItem(this.STORAGE_KEYS.PUBLIC_DATA_KEY, key.trim());
    } else {
      localStorage.removeItem(this.STORAGE_KEYS.PUBLIC_DATA_KEY);
    }
  },

  /**
   * 카카오 지도 SDK를 동적으로 HTML에 삽입하고 로드가 완료되면 Resolve하는 Promise 반환
   * @returns {Promise<boolean>} 로드 성공 여부
   */
  loadKakaoMapSDK() {
    return new Promise((resolve, reject) => {
      const appKey = this.getKakaoKey();
      
      // 카카오 맵 키가 없으면 로드할 수 없으므로 false 반환
      if (!appKey) {
        console.warn("Kakao Map JavaScript Key is not configured yet.");
        return resolve(false);
      }

      // 이미 스크립트가 로드되었는지 체크
      if (window.kakao && window.kakao.maps) {
        return resolve(true);
      }

      // 동적 스크립트 요소 생성
      const script = document.createElement('script');
      // 카카오맵 SDK 로드 시 libraries 파라미터로 services(주소 변환/좌표 변환용)를 함께 로드합니다.
      // autoload=false로 설정하여 스크립트 로딩 완료 후 kakao.maps.load 콜백을 호출하게 합니다.
      script.src = `https://dapi.kakao.com/v2/maps/sdk.js?appkey=${appKey}&libraries=services&autoload=false`;
      script.async = true;
      script.defer = true;

      script.onload = () => {
        // autoload=false에 의해 수동으로 로드해 주어야 안전하게 초기화 완료됩니다.
        if (window.kakao && window.kakao.maps) {
          window.kakao.maps.load(() => {
            console.log("Kakao Map SDK loaded successfully.");
            resolve(true);
          });
        } else {
          reject(new Error("Kakao Map object is not available after script load."));
        }
      };

      script.onerror = (err) => {
        console.error("Failed to load Kakao Map SDK script:", err);
        reject(err);
      };

      document.head.appendChild(script);
    });
  }
};
