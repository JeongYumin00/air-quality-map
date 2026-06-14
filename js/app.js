/**
 * @file app.js
 * @description 서비스의 핵심 Orchestrator로, Geolocation을 획득하고 가장 인접한 측정소를 계산하며,
 *              API 연동, 지도 제어 및 UI 갱신 등의 이벤트를 전체 조율합니다.
 */

const App = {
  userCoords: { lat: 37.5665, lng: 126.9780 }, // 기본 위치: 서울시청
  currentSido: '서울',
  currentStation: null,
  activeStationsData: [], // 현재 선택된 시도의 실시간 대기 및 위치가 매핑된 측정소 배열
  isMapLoaded: false,

  // 시도별 대표 중심 좌표 정의 (지역 변경 시 지도 포커싱용)
  SIDO_COORDINATES: {
    '서울': { lat: 37.5665, lng: 126.9780, zoom: 6 },
    '경기': { lat: 37.2636, lng: 127.0286, zoom: 8 },
    '인천': { lat: 37.4563, lng: 126.7052, zoom: 7 },
    '부산': { lat: 35.1796, lng: 129.0756, zoom: 7 },
    '대구': { lat: 35.8711, lng: 128.6014, zoom: 7 },
    '광주': { lat: 35.1595, lng: 126.8526, zoom: 7 },
    '대전': { lat: 36.3504, lng: 127.3845, zoom: 7 },
    '울산': { lat: 35.5389, lng: 129.3114, zoom: 7 },
    '세종': { lat: 36.4801, lng: 127.2890, zoom: 6 },
    '강원': { lat: 37.8854, lng: 127.7298, zoom: 9 },
    '충북': { lat: 36.6357, lng: 127.4914, zoom: 8 },
    '충남': { lat: 36.6600, lng: 126.6728, zoom: 8 },
    '전북': { lat: 35.8242, lng: 127.1480, zoom: 8 },
    '전남': { lat: 34.8161, lng: 126.4629, zoom: 9 },
    '경북': { lat: 36.5760, lng: 128.5056, zoom: 9 },
    '경남': { lat: 35.2378, lng: 128.6919, zoom: 9 },
    '제주': { lat: 33.4996, lng: 126.5312, zoom: 7 }
  },

  // 시도 긴 명칭 -> 단축명 변환용 딕셔너리
  SIDO_NAME_MAP: {
    '서울특별시': '서울', '부산광역시': '부산', '대구광역시': '대구',
    '인천광역시': '인천', '광주광역시': '광주', '대전광역시': '대전',
    '울산광역시': '울산', '세종특별자치시': '세종', '경기도': '경기',
    '강원도': '강원', '강원특별자치도': '강원', '충청북도': '충북',
    '충청남도': '충남', '전라북도': '전북', '전라남도': '전남',
    '전북특별자치도': '전북', '경상북도': '경북', '경상남도': '경남',
    '제주특별자치도': '제주', '제주도': '제주'
  },

  /**
   * 애플리케이션 시작 진입점
   */
  async init() {
    this.bindEvents();

    UI.showLoading("시스템 설정을 불러오고 있습니다...");

    try {
      // 1. 카카오맵 SDK 동적 로딩 시도
      let isLoaded = false;
      try {
        isLoaded = await AppConfig.loadKakaoMapSDK();
      } catch (sdkErr) {
        console.error("Kakao SDK load error:", sdkErr);
        isLoaded = false;
      }
      this.isMapLoaded = isLoaded;
      
      if (!isLoaded) {
        // 카카오 JS Key가 저장되지 않았으면 로딩창을 걷어내고 설정 모달을 열어 키 입력을 유도
        UI.hideLoading();
        UI.showToast("카카오맵 API Key를 먼저 설정해주세요. 키가 유효한지도 확인해주세요.", true);
        UI.openSettingsModal();
        // 카카오맵 없이도 대기 데이터만이라도 불러오기 시도
        try {
          await this.loadSidoData(this.currentSido);
          const firstValid = this.activeStationsData.find(s => s.pm10Value && s.pm10Value !== '-');
          if (firstValid) UI.updateDashboard(firstValid);
        } catch (e) {
          console.warn("지도 없이 대기 데이터도 불러오기 실패:", e.message);
        }
        return;
      }

      // 2. 카카오 지도 및 Geocoder 초기화
      // 기본은 사용자 GPS 위치 탐색 전이므로 서울 시청을 임시 중심으로 둠
      KakaoMap.initMap('map', this.userCoords.lat, this.userCoords.lng);
      
      // 3. 사용자 위치 추적 및 대기질 분석 시작
      await this.loadDataWithUserLocation();
      
    } catch (err) {
      console.error("Initialization failed:", err);
      UI.showToast(`초기화 실패: ${err.message}`, true);
    } finally {
      // 어떤 경우든 로딩 오버레이는 반드시 해제
      UI.hideLoading();
    }
  },

  /**
   * 이벤트 리스너 바인딩
   */
  bindEvents() {
    // 1. 설정창 관련 이벤트
    UI.elements.btnOpenSettings.addEventListener('click', () => UI.openSettingsModal());
    UI.elements.btnCloseSettingsModal.addEventListener('click', () => UI.closeSettingsModal());
    UI.elements.btnSaveSettings.addEventListener('click', () => this.handleSaveSettings());
    
    // 2. 지역 선택 드롭다운 이벤트
    UI.elements.selectSido.addEventListener('change', (e) => {
      this.handleSidoChange(e.target.value);
    });

    // 3. 새로고침 버튼 이벤트
    UI.elements.btnRefresh.addEventListener('click', () => {
      this.handleRefresh();
    });

    // 4. 지도상 내 위치 이동 버튼 이벤트
    UI.elements.btnMyLocation.addEventListener('click', () => {
      if (!this.isMapLoaded) return;
      UI.showLoading("내 위치로 이동 중...");
      navigator.geolocation.getCurrentPosition(
        async (position) => {
          this.userCoords.lat = position.coords.latitude;
          this.userCoords.lng = position.coords.longitude;
          
          KakaoMap.moveTo(this.userCoords.lat, this.userCoords.lng);
          KakaoMap.drawUserMarker(this.userCoords.lat, this.userCoords.lng);
          
          // 내 위치 기반 주소 재분석 후 가장 가까운 측정소 정보 갱신
          await this.updateNearbyStation();
          UI.hideLoading();
        },
        (error) => {
          UI.hideLoading();
          UI.showToast("위치 권한을 획득할 수 없어 내 위치로 이동할 수 없습니다.", true);
        }
      );
    });
  },

  /**
   * API 설정 저장 처리
   */
  handleSaveSettings() {
    const kakaoKey = UI.elements.inputKakaoKey.value.trim();
    const publicKey = UI.elements.inputPublicKey.value.trim();
    
    const prevKakaoKey = AppConfig.getKakaoKey();

    // 로컬스토리지에 저장
    AppConfig.setKakaoKey(kakaoKey);
    AppConfig.setPublicKey(publicKey);

    UI.closeSettingsModal();
    UI.showToast("설정이 저장되었습니다.");

    // 카카오 키가 변경되었거나 새로 입력된 경우 페이지를 새로고침하여 지도를 재로드함
    if (kakaoKey !== prevKakaoKey) {
      UI.showLoading("지도를 초기화하기 위해 새로고침 중...");
      setTimeout(() => {
        window.location.reload();
      }, 1000);
    } else {
      // 대기오염 키만 바뀐 경우 데이터만 갱신
      this.handleRefresh();
    }
  },

  /**
   * 지역 변경 시 이벤트 처리
   * @param {string} sido - 단축 시도명
   */
  async handleSidoChange(sido) {
    this.currentSido = sido;
    UI.showLoading(`${sido} 지역 대기 상태 조회 중...`);
    
    try {
      // 1. 해당 시도 전체 데이터 로드 및 맵 갱신
      await this.loadSidoData(sido);
      
      // 2. 지도 중심을 해당 시도의 대표 청사 위치로 조율
      if (this.isMapLoaded && this.SIDO_COORDINATES[sido]) {
        const coord = this.SIDO_COORDINATES[sido];
        KakaoMap.moveToWithZoom(coord.lat, coord.lng, coord.zoom);
      }
      
      // 3. 해당 시도 데이터 중 첫 번째 정상 측정소를 대표로 임시 선택하여 대시보드 갱신
      const firstValid = this.activeStationsData.find(s => s.pm10Value && s.pm10Value !== '-');
      if (firstValid) {
        this.currentStation = firstValid;
        UI.updateDashboard(firstValid);
      }
      
      UI.showToast(`${sido} 지역 정보를 불러왔습니다.`);
    } catch (err) {
      UI.showToast(`데이터 로드 실패: ${err.message}`, true);
    } finally {
      UI.hideLoading();
    }
  },

  /**
   * 새로고침 버튼 이벤트 처리
   */
  async handleRefresh() {
    UI.showLoading("실시간 정보를 동기화하고 있습니다...");
    try {
      if (this.isMapLoaded) {
        await this.loadDataWithUserLocation();
      } else {
        await this.loadSidoData(this.currentSido);
        const firstValid = this.activeStationsData.find(s => s.pm10Value && s.pm10Value !== '-');
        if (firstValid) UI.updateDashboard(firstValid);
      }
      UI.showToast("정보가 갱신되었습니다.");
    } catch (err) {
      UI.showToast(`새로고침 실패: ${err.message}`, true);
    } finally {
      UI.hideLoading();
    }
  },

  /**
   * 사용자 GPS 위치를 읽어와 해당 시도 및 가까운 측정소 획득
   */
  async loadDataWithUserLocation() {
    UI.showLoading("사용자 GPS 탐색 및 주변 대기질 수집 중...");

    return new Promise((resolve) => {
      navigator.geolocation.getCurrentPosition(
        // 위치 획득 성공
        async (position) => {
          this.userCoords.lat = position.coords.latitude;
          this.userCoords.lng = position.coords.longitude;

          try {
            // 1. 내 위치 주소 가져오기
            const addrInfo = await KakaoMap.getAddressFromCoords(this.userCoords.lat, this.userCoords.lng);
            UI.updateUserAddress(addrInfo.fullAddress);

            // 2. 주소에 기반한 시도 한글 약식명 도출
            let sido = this.SIDO_NAME_MAP[addrInfo.sidoName] || '서울';
            this.currentSido = sido;
            
            // UI 드롭다운 값 동기화
            UI.elements.selectSido.value = sido;

            // 3. 지도에 내 위치 마커 그리기 및 이동
            KakaoMap.drawUserMarker(this.userCoords.lat, this.userCoords.lng);
            KakaoMap.moveTo(this.userCoords.lat, this.userCoords.lng);

            // 4. 해당 시도 대기 오염 정보 조회
            await this.loadSidoData(sido);

            // 5. 내 위치 기준 최단거리 측정소 산출 및 대시보드 갱신
            await this.updateNearbyStation();
            
          } catch (err) {
            console.error("GPS data mapping error:", err);
            UI.showToast(`위치 분석 중 오류가 발생하여 기본 지역으로 로드합니다.`, true);
            try {
              await this.loadFallbackData();
            } catch (fallbackErr) {
              console.error("Fallback data also failed:", fallbackErr);
              UI.showToast(`데이터 로드 실패: ${fallbackErr.message}`, true);
            }
          } finally {
            UI.hideLoading();
            resolve();
          }
        },
        // 위치 획득 거부 또는 오류 시 서울 시청 중심으로 폴백
        async (error) => {
          console.warn("Geolocation permission denied or failed. Falling back to Seoul Center.");
          UI.updateUserAddress("위치 권한 차단됨 (기본: 서울 시청 기준)");
          UI.showToast("GPS 수신 동의가 차단되어 기본 위치(서울) 데이터가 제공됩니다.", false);
          
          try {
            if (this.isMapLoaded) {
              KakaoMap.drawUserMarker(this.userCoords.lat, this.userCoords.lng);
            }
            await this.loadFallbackData();
          } catch (fallbackErr) {
            console.error("Fallback data failed:", fallbackErr);
            UI.showToast(`기본 데이터 로드 실패: ${fallbackErr.message}`, true);
          } finally {
            UI.hideLoading();
            resolve();
          }
        },
        { timeout: 7000, enableHighAccuracy: true }
      );
    });
  },

  /**
   * 위치 권한 획득 실패 시 수행할 기본 폴백 데이터 로딩
   */
  async loadFallbackData() {
    this.currentSido = '서울';
    UI.elements.selectSido.value = '서울';
    
    await this.loadSidoData('서울');
    
    // 서울 시청에서 가장 가까운 측정소 자동 지정 (기본 종로구 측정소 등이 지정됨)
    await this.updateNearbyStation();
  },

  /**
   * 특정 시도의 대기 정보 및 측정소 정보를 불러와 병합 및 매핑 수행
   * @param {string} sidoName - 시도 단축 한글명 (예: '서울', '경기')
   */
  async loadSidoData(sidoName) {
    // 1. 공공데이터포털에서 시도별 실시간 미세먼지 수치 조회
    const airQualityList = await AirApi.getSidoAirQuality(sidoName);
    
    // 2. 공공데이터포털에서 해당 시도의 측정소 위치 목록(주소/TM좌표) 조회
    let stationsInfo = [];
    try {
      stationsInfo = await AirApi.getStationList(sidoName);
    } catch (stErr) {
      console.warn("측정소 위치 데이터 조회 실패 (대기 수치만 사용):", stErr.message);
    }

    // 3. 두 데이터 병합 (Join Key: stationName)
    // 조인 결과를 임시 보관
    const mergedList = [];
    
    airQualityList.forEach(airItem => {
      const matchedStation = stationsInfo.find(info => info.stationName === airItem.stationName);
      if (matchedStation) {
        mergedList.push({
          ...airItem,
          addr: matchedStation.addr,
          tmX: matchedStation.tmX,
          tmY: matchedStation.tmY
        });
      } else {
        // 매칭되는 위치 정보가 없을 경우 주소 없이 대기 데이터만 담음
        mergedList.push({
          ...airItem,
          addr: null
        });
      }
    });

    // 4. 지도에 표시할 마커 위경도 파싱 (카카오맵 로드 시에만 수행)
    const validMergedList = mergedList.filter(item => item.addr && item.pm10Value && item.pm10Value !== '-');
    const displayList = validMergedList.slice(0, 25); // 최대 25개로 제한

    // 카카오맵이 로드되지 않았으면 지오코딩을 건너뛰고 대기 데이터만 사용
    if (this.isMapLoaded && KakaoMap.geocoder) {
      const geocodingPromises = displayList.map(async (station) => {
        try {
          // 주소 텍스트 기반 위경도 검색
          const coords = await KakaoMap.getCoordsFromAddress(station.addr);
          return {
            ...station,
            lat: coords.lat,
            lng: coords.lng
          };
        } catch (e) {
          // 지오코딩 실패 시 로그 남기고 제외
          console.warn(`Geocoding failed for station ${station.stationName}: ${station.addr}`);
          return null;
        }
      });

      // 병렬 지오코딩 대기
      const resolvedStations = await Promise.all(geocodingPromises);
      
      // 유효한 결과만 필터링하여 멤버 변수에 할당
      this.activeStationsData = resolvedStations.filter(s => s !== null);

      // 5. 지도에 측정소 마커 표시
      KakaoMap.drawStationMarkers(this.activeStationsData, (selectedStation) => {
        // 마커 클릭 시 발생하는 콜백: 대시보드 및 중심 변경 연동
        this.currentStation = selectedStation;
        UI.updateDashboard(selectedStation);
      });
    } else {
      // 지도 미로드 시: 위경도 없이 대기 데이터만으로 activeStationsData 구성
      this.activeStationsData = mergedList.filter(item => item.pm10Value && item.pm10Value !== '-');
    }
  },

  /**
   * 사용자 현재 좌표와 가장 근접한 측정소 탐색 후 대시보드 동기화
   */
  async updateNearbyStation() {
    if (this.activeStationsData.length === 0) {
      console.warn("No active station coordinate data for distance mapping.");
      return;
    }

    let minDistance = Infinity;
    let closestStation = null;

    // 하버사인 공식을 활용해 사용자 좌표와 모든 측정소 좌표 사이의 거리를 계산
    this.activeStationsData.forEach(station => {
      if (!station.lat || !station.lng) return;
      
      const distance = this.calculateDistance(
        this.userCoords.lat, this.userCoords.lng,
        station.lat, station.lng
      );

      if (distance < minDistance) {
        minDistance = distance;
        closestStation = station;
      }
    });

    if (closestStation) {
      console.log(`Closest station mapped: ${closestStation.stationName} (Distance: ${minDistance.toFixed(2)}km)`);
      this.currentStation = closestStation;
      
      // 대시보드 갱신
      UI.updateDashboard(closestStation);

      // 지도에 해당 측정소 중심 인포윈도우 자동 활성화
      if (this.isMapLoaded) {
        const position = new kakao.maps.LatLng(closestStation.lat, closestStation.lng);
        KakaoMap._showInfoWindow(closestStation, position);
      }
    }
  },

  /**
   * 두 위경도 좌표 사이의 거리를 km 단위로 계산하는 하버사인(Haversine) 공식 함수
   * @param {number} lat1 - 위도 1
   * @param {number} lon1 - 경도 1
   * @param {number} lat2 - 위도 2
   * @param {number} lon2 - 경도 2
   * @returns {number} 거리 (km)
   */
  calculateDistance(lat1, lon1, lat2, lon2) {
    const R = 6371; // 지구 평균 반경 (km)
    const dLat = this.deg2rad(lat2 - lat1);
    const dLon = this.deg2rad(lon2 - lon1);
    
    const a = 
      Math.sin(dLat / 2) * Math.sin(dLat / 2) +
      Math.cos(this.deg2rad(lat1)) * Math.cos(this.deg2rad(lat2)) * 
      Math.sin(dLon / 2) * Math.sin(dLon / 2);
    
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return R * c;
  },

  /**
   * 각도를 라디안으로 변환
   */
  deg2rad(deg) {
    return deg * (Math.PI / 180);
  }
};

// 페이지 로드 시 앱 초기화 실행
window.addEventListener('DOMContentLoaded', () => {
  App.init();
});
