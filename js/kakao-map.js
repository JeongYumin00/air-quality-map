/**
 * @file kakao-map.js
 * @description 카카오 지도 생성 및 제어, 마커 표시, 역지오코딩(좌표->주소), 주소->좌표 변환 등 지도와 관련된 기능을 전담합니다.
 */

const KakaoMap = {
  mapInstance: null,
  geocoder: null,
  markers: [],         // 현재 지도에 표시된 측정소 마커(CustomOverlay)들
  userMarker: null,     // 사용자 위치 마커(CustomOverlay)
  activeInfoWindow: null, // 현재 열려있는 커스텀 오버레이 정보창

  /**
   * 지도 초기화
   * @param {string} containerId - 지도를 담을 HTML 요소 ID
   * @param {number} lat - 중심 위도
   * @param {number} lng - 중심 경도
   */
  initMap(containerId, lat, lng) {
    if (!window.kakao || !window.kakao.maps) {
      console.warn("Kakao Map SDK is not loaded. Cannot initialize map.");
      return false;
    }

    const container = document.getElementById(containerId);
    if (!container) return false;

    const options = {
      center: new kakao.maps.LatLng(lat, lng),
      level: 6 // 동네 규모가 한 눈에 들어오는 적절한 줌 레벨
    };

    this.mapInstance = new kakao.maps.Map(container, options);
    this.geocoder = new kakao.maps.services.Geocoder();
    
    // 일반 지도/스카이뷰 토글 및 줌 컨트롤러 추가
    const mapTypeControl = new kakao.maps.MapTypeControl();
    this.mapInstance.addControl(mapTypeControl, kakao.maps.ControlPosition.TOPRIGHT);
    
    const zoomControl = new kakao.maps.ZoomControl();
    this.mapInstance.addControl(zoomControl, kakao.maps.ControlPosition.RIGHT);

    console.log("Map initialized successfully.");
    return true;
  },

  /**
   * 지도 중심 이동
   * @param {number} lat - 위도
   * @param {number} lng - 경도
   */
  moveTo(lat, lng) {
    if (!this.mapInstance) return;
    const moveLatLng = new kakao.maps.LatLng(lat, lng);
    this.mapInstance.setCenter(moveLatLng);
  },

  /**
   * 지도 중심 이동 및 줌 레벨 설정 (시도 단위 이동 시 사용)
   * @param {number} lat 
   * @param {number} lng 
   * @param {number} level 
   */
  moveToWithZoom(lat, lng, level) {
    if (!this.mapInstance) return;
    const moveLatLng = new kakao.maps.LatLng(lat, lng);
    this.mapInstance.setCenter(moveLatLng);
    this.mapInstance.setLevel(level);
  },

  /**
   * 모든 마커 제거
   */
  clearMarkers() {
    this.markers.forEach(marker => marker.setMap(null));
    this.markers = [];
    if (this.activeInfoWindow) {
      this.activeInfoWindow.setMap(null);
      this.activeInfoWindow = null;
    }
  },

  /**
   * 사용자 현재 위치 마커 그리기 (펄싱 애니메이션 효과 내장)
   * @param {number} lat - 위도
   * @param {number} lng - 경도
   */
  drawUserMarker(lat, lng) {
    if (!this.mapInstance) return;

    if (this.userMarker) {
      this.userMarker.setMap(null);
    }

    const position = new kakao.maps.LatLng(lat, lng);

    // CSS 펄스 애니메이션이 적용된 엘리먼트 생성
    const content = document.createElement('div');
    content.className = 'user-marker-pulse';
    content.title = '내 현재 위치';

    // 커스텀 오버레이 생성
    this.userMarker = new kakao.maps.CustomOverlay({
      position: position,
      content: content,
      yAnchor: 0.5,
      xAnchor: 0.5
    });

    this.userMarker.setMap(this.mapInstance);
  },

  /**
   * 좌표(WGS84)로 주소 정보 가져오기 (역지오코딩)
   * @param {number} lat 
   * @param {number} lng 
   * @returns {Promise<Object>} 주소 결과 객체 (시도명, 구군명 등)
   */
  getAddressFromCoords(lat, lng) {
    return new Promise((resolve, reject) => {
      if (!this.geocoder) {
        return reject(new Error("Geocoder is not initialized."));
      }

      this.geocoder.coord2RegionCode(lng, lat, (result, status) => {
        if (status === kakao.maps.services.Status.OK) {
          // 법정동/행정동 정보 중 행정동 정보 우선 활용 (result[0]이 보통 법정동, result[1]이 행정동)
          const info = result[0];
          resolve({
            sidoName: info.region_1depth_name,       // 예: 서울특별시, 경기도
            sigunguName: info.region_2depth_name,    // 예: 종로구, 성남시 분당구
            dongName: info.region_3depth_name,       // 예: 혜화동, 삼평동
            fullAddress: `${info.region_1depth_name} ${info.region_2depth_name} ${info.region_3depth_name}`
          });
        } else {
          reject(new Error("Reverse geocoding failed."));
        }
      });
    });
  },

  /**
   * 한글 주소로 좌표(WGS84) 가져오기 (지오코딩)
   * @param {string} address - 한글 주소
   * @returns {Promise<{lat: number, lng: number}>} 위경도 좌표 객체
   */
  getCoordsFromAddress(address) {
    return new Promise((resolve, reject) => {
      if (!this.geocoder) {
        return reject(new Error("Geocoder is not initialized."));
      }

      this.geocoder.addressSearch(address, (result, status) => {
        if (status === kakao.maps.services.Status.OK && result.length > 0) {
          resolve({
            lat: parseFloat(result[0].y),
            lng: parseFloat(result[0].x)
          });
        } else {
          reject(new Error(`Failed to find coordinates for address: ${address}`));
        }
      });
    });
  },

  /**
   * 측정소 마커들 그리기
   * @param {Array} stations - 대기질 및 주소 정보가 병합된 측정소 리스트
   * @param {Function} onMarkerClick - 마커 클릭 시 실행할 콜백 함수 (인자: 해당 측정소 객체)
   */
  drawStationMarkers(stations, onMarkerClick) {
    if (!this.mapInstance) return;
    this.clearMarkers();

    stations.forEach(station => {
      // 위경도 좌표가 결여된 측정소는 건너뜀
      if (!station.lat || !station.lng) return;

      const position = new kakao.maps.LatLng(station.lat, station.lng);
      const gradeClass = this._getGradeClass(station.pm10Grade || station.pm25Grade || '1');
      const pm10Value = station.pm10Value || '--';

      // 1. 커스텀 엘리먼트 마커 디자인 생성
      // 원형 핀 내부에 미세먼지 수치를 직접 표기하여 지도를 훑기만 해도 대략적인 오염도를 파악할 수 있는 프리미엄 레이아웃 구현
      const markerElement = document.createElement('div');
      markerElement.style.cssText = `
        display: flex;
        align-items: center;
        justify-content: center;
        font-family: var(--font-numbers);
        font-size: 11px;
        font-weight: 700;
        color: #ffffff;
        width: 30px;
        height: 30px;
        border-radius: 50% 50% 50% 0;
        transform: rotate(-45deg);
        cursor: pointer;
        box-shadow: 0 4px 10px rgba(0,0,0,0.3);
        transition: transform 0.2s ease, box-shadow 0.2s ease;
      `;
      // 테마 클래스별 색상을 동적으로 매핑하기 위해 배경색을 인라인으로 직접 제어
      let bgColor = '#64748b'; // unknown
      if (gradeClass === 'badge-good') bgColor = '#3b82f6';
      else if (gradeClass === 'badge-normal') bgColor = '#10b981';
      else if (gradeClass === 'badge-bad') bgColor = '#f97316';
      else if (gradeClass === 'badge-verybad') bgColor = '#ef4444';

      markerElement.style.backgroundColor = bgColor;
      markerElement.style.border = '2px solid rgba(255,255,255,0.8)';

      // 핀 내부 텍스트는 바로 세워지도록 45도 역회전 적용
      const innerText = document.createElement('span');
      innerText.style.cssText = 'transform: rotate(45deg); display: block;';
      innerText.innerText = pm10Value;
      markerElement.appendChild(innerText);

      // 마커 마우스 호버 및 클릭 시 동적 스케일 애니메이션 추가
      markerElement.addEventListener('mouseenter', () => {
        markerElement.style.transform = 'rotate(-45deg) scale(1.15)';
        markerElement.style.boxShadow = `0 6px 14px ${bgColor}44`;
      });
      markerElement.addEventListener('mouseleave', () => {
        markerElement.style.transform = 'rotate(-45deg) scale(1.0)';
        markerElement.style.boxShadow = '0 4px 10px rgba(0,0,0,0.3)';
      });

      // 커스텀 오버레이 형태의 마커 객체 생성
      const marker = new kakao.maps.CustomOverlay({
        position: position,
        content: markerElement,
        yAnchor: 0.95, // 핀 끝점이 좌표에 일치하도록 정렬
        xAnchor: 0.4
      });

      // 마커 클릭 시 정보 윈도우 생성 및 사이드바 바인딩 콜백 트리거
      markerElement.addEventListener('click', (e) => {
        e.stopPropagation();
        this._showInfoWindow(station, position);
        if (onMarkerClick) {
          onMarkerClick(station);
        }
      });

      marker.setMap(this.mapInstance);
      this.markers.push(marker);
    });
  },

  /**
   * 마커 클릭 시 지도 상에 띄울 인포윈도우(CustomOverlay) 생성
   * @param {Object} station 
   * @param {kakao.maps.LatLng} position 
   */
  _showInfoWindow(station, position) {
    if (this.activeInfoWindow) {
      this.activeInfoWindow.setMap(null);
    }

    const gradeClass = this._getGradeClass(station.pm10Grade || station.pm25Grade || '1');
    const gradeText = this._getGradeText(station.pm10Grade || station.pm25Grade || '1');
    const pm10Text = station.pm10Value === '-' || !station.pm10Value ? '--' : station.pm10Value;
    const pm25Text = station.pm25Value === '-' || !station.pm25Value ? '--' : station.pm25Value;

    const content = document.createElement('div');
    content.className = 'custom-overlay-wrap';
    
    // 클릭 시 인포윈도우가 꺼질 수 있는 닫기 액션도 함께 제공
    content.innerHTML = `
      <span class="overlay-station">${station.stationName}</span>
      <span class="overlay-grade ${gradeClass}">${gradeText}</span>
      <span class="overlay-pm10">미세: <span>${pm10Text}</span> | 초미세: <span>${pm25Text}</span></span>
    `;

    // 맵을 클릭하면 인포윈도우가 닫히도록 맵 이벤트 리스너 연계
    const closeOverlay = () => {
      this.activeInfoWindow.setMap(null);
      this.activeInfoWindow = null;
      kakao.maps.event.removeListener(this.mapInstance, 'click', closeOverlay);
    };

    // 약간의 시간차를 두어 현재 마커 클릭 이벤트에 의해 바로 닫히지 않도록 조율
    setTimeout(() => {
      kakao.maps.event.addListener(this.mapInstance, 'click', closeOverlay);
    }, 100);

    this.activeInfoWindow = new kakao.maps.CustomOverlay({
      position: position,
      content: content,
      yAnchor: 2.1, // 마커 핀보다 넉넉하게 위에 뜨도록 고정
      xAnchor: 0.5
    });

    this.activeInfoWindow.setMap(this.mapInstance);
  },

  /**
   * 등급 코드에 매핑되는 CSS 클래스명 반환
   */
  _getGradeClass(grade) {
    switch (grade) {
      case '1': return 'badge-good';
      case '2': return 'badge-normal';
      case '3': return 'badge-bad';
      case '4': return 'badge-verybad';
      default: return 'badge-unknown';
    }
  },

  /**
   * 등급 코드에 매핑되는 등급 텍스트 반환
   */
  _getGradeText(grade) {
    switch (grade) {
      case '1': return '좋음';
      case '2': return '보통';
      case '3': return '나쁨';
      case '4': return '매우 나쁨';
      default: return '점검중';
    }
  }
};
