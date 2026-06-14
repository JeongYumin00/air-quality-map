/**
 * @file ui.js
 * @description 대시보드 UI 요소를 조작하고, 미세먼지 수치 정보 렌더링, 공기 등급별 동적 CSS 테마 적용,
 *              로딩 오버레이 제어 및 토스트 알림 기능을 제공합니다.
 */

const UI = {
  // DOM 요소 참조 캐싱
  elements: {
    body: document.body,
    stationName: document.getElementById('txt-station-name'),
    measureTime: document.getElementById('txt-measure-time'),
    airGrade: document.getElementById('txt-air-grade'),
    statusDesc: document.getElementById('txt-status-desc'),
    statusIcon: document.getElementById('img-status-icon'),
    userAddress: document.getElementById('txt-user-address'),

    pm10Value: document.getElementById('txt-pm10-value'),
    pm10Bar: document.getElementById('bar-pm10'),
    pm10Grade: document.getElementById('txt-pm10-grade'),

    pm25Value: document.getElementById('txt-pm25-value'),
    pm25Bar: document.getElementById('bar-pm25'),
    pm25Grade: document.getElementById('txt-pm25-grade'),

    o3: document.getElementById('txt-o3'),
    no2: document.getElementById('txt-no2'),
    co: document.getElementById('txt-co'),
    so2: document.getElementById('txt-so2'),

    selectSido: document.getElementById('select-sido'),
    btnRefresh: document.getElementById('btn-refresh'),

    loadingOverlay: document.getElementById('loading-overlay'),
    loadingMessage: document.getElementById('txt-loading-message'),
    toastContainer: document.getElementById('toast-container'),

    settingsModal: document.getElementById('settings-modal'),
    btnOpenSettings: document.getElementById('btn-open-settings'),
    btnCloseSettingsModal: document.getElementById('btn-close-settings-modal'),
    btnSaveSettings: document.getElementById('btn-save-settings'),
    btnMyLocation: document.getElementById('btn-my-location'),
    inputKakaoKey: document.getElementById('input-kakao-key'),
    inputPublicKey: document.getElementById('input-public-key'),

    mapSummaryChip: document.getElementById('map-summary-chip'),
    chipStationName: document.getElementById('chip-station-name'),
    chipStationGrade: document.getElementById('chip-station-grade')
  },

  /**
   * 로딩 스피너 오버레이 표시
   * @param {string} message - 로딩 창에 보여줄 메시지
   */
  showLoading(message) {
    this.elements.loadingMessage.innerText = message || '데이터를 가져오고 있습니다...';
    this.elements.loadingOverlay.classList.add('active');
  },

  /**
   * 로딩 스피너 오버레이 숨김
   */
  hideLoading() {
    this.elements.loadingOverlay.classList.remove('active');
  },

  /**
   * 토스트 형태의 알림 메시지 띄우기
   * @param {string} message - 알림 내용
   * @param {boolean} isError - 에러 타입 여부 (true 시 빨간색 테두리)
   */
  showToast(message, isError = false) {
    const toast = document.createElement('div');
    toast.className = `toast ${isError ? 'toast-error' : ''}`;

    const icon = document.createElement('i');
    icon.className = isError ? 'fa-solid fa-circle-exclamation toast-icon' : 'fa-solid fa-circle-check toast-icon';

    const textNode = document.createTextNode(message);

    toast.appendChild(icon);
    toast.appendChild(textNode);
    this.elements.toastContainer.appendChild(toast);

    // 부드러운 페이드인
    setTimeout(() => toast.classList.add('show'), 50);

    // 3.5초 뒤 자동 파괴
    setTimeout(() => {
      toast.classList.remove('show');
      setTimeout(() => toast.remove(), 300);
    }, 3500);
  },

  /**
   * 설정 모달 창 열기
   */
  openSettingsModal() {
    // 저장되어 있는 기존 키들을 입력란에 미리 매핑
    this.elements.inputKakaoKey.value = AppConfig.getKakaoKey() || '';
    // 공공데이터 키는 기본제공 키가 아닌 로컬스토리지에 본인이 따로 저장한 키만 보여줌
    const storedPublicKey = localStorage.getItem(AppConfig.STORAGE_KEYS.PUBLIC_DATA_KEY);
    this.elements.inputPublicKey.value = storedPublicKey || '';

    this.elements.settingsModal.classList.add('active');
  },

  /**
   * 설정 모달 창 닫기
   */
  closeSettingsModal() {
    this.elements.settingsModal.classList.remove('active');
  },

  /**
   * 대기질 데이터 바탕으로 대시보드 카드 전체 정보 갱신
   * @param {Object} data - 미세먼지 수치가 포함된 측정소 정보 객체
   */
  updateDashboard(data) {
    if (!data) return;

    // 1. 측정소명 및 측정 시간 갱신
    this.elements.stationName.innerText = `${data.stationName} 측정소`;
    this.elements.measureTime.innerText = data.dataTime ? `${data.dataTime.substring(11, 16)} 기준` : '--:-- 기준';

    // 2. 미세먼지 및 초미세먼지 수치/프로그레스 바 갱신
    const pm10Val = this._parseValue(data.pm10Value);
    const pm25Val = this._parseValue(data.pm25Value);

    this.elements.pm10Value.innerHTML = pm10Val !== null ? `${pm10Val} <span>㎍/㎥</span>` : `-- <span>㎍/㎥</span>`;
    this.elements.pm25Value.innerHTML = pm25Val !== null ? `${pm25Val} <span>㎍/㎥</span>` : `-- <span>㎍/㎥</span>`;

    // 3. 수치 게이지 바 퍼센트 제어 및 색상 바인딩
    // PM10 기준치: 좋음(30이하), 보통(80이하), 나쁨(150이하), 매우나쁨(151이상)
    // 최대 기준 160 기준으로 백분율 환산
    const pm10Percent = pm10Val !== null ? Math.min(100, (pm10Val / 160) * 100) : 0;
    this.elements.pm10Bar.style.width = `${pm10Percent}%`;
    this._setProgressBarColor(this.elements.pm10Bar, data.pm10Grade);
    this.elements.pm10Grade.innerText = this._getGradeText(data.pm10Grade);
    this.elements.pm10Grade.className = `pollutant-status-label ${this._getGradeColorClass(data.pm10Grade)}`;

    // PM2.5 기준치: 좋음(15이하), 보통(35이하), 나쁨(75이하), 매우나쁨(76이상)
    // 최대 기준 85 기준으로 백분율 환산
    const pm25Percent = pm25Val !== null ? Math.min(100, (pm25Val / 85) * 100) : 0;
    this.elements.pm25Bar.style.width = `${pm25Percent}%`;
    this._setProgressBarColor(this.elements.pm25Bar, data.pm25Grade);
    this.elements.pm25Grade.innerText = this._getGradeText(data.pm25Grade);
    this.elements.pm25Grade.className = `pollutant-status-label ${this._getGradeColorClass(data.pm25Grade)}`;

    // 4. 대표 통합 등급 산출 (PM10 등급과 PM2.5 등급 중 더 나쁜 등급을 대표 등급으로 선정)
    const pm10GradeNum = parseInt(data.pm10Grade) || 0;
    const pm25GradeNum = parseInt(data.pm25Grade) || 0;
    const maxGrade = Math.max(pm10GradeNum, pm25GradeNum);
    const representativeGrade = maxGrade > 0 ? String(maxGrade) : '0';

    // 5. 대표 등급에 따른 동적 테마 스위칭 및 상태 메시지 렌더링
    this._updateThemeAndMessages(representativeGrade);

    // 6. 기타 대기 가스 오염 물질 갱신
    this.elements.o3.innerText = data.o3Value && data.o3Value !== '-' ? `${data.o3Value} ppm` : '-- ppm';
    this.elements.no2.innerText = data.no2Value && data.no2Value !== '-' ? `${data.no2Value} ppm` : '-- ppm';
    this.elements.co.innerText = data.coValue && data.coValue !== '-' ? `${data.coValue} ppm` : '-- ppm';
    this.elements.so2.innerText = data.so2Value && data.so2Value !== '-' ? `${data.so2Value} ppm` : '-- ppm';

    // 7. 지도 칩 상단 간편 대기 정보 동기화
    this._updateMapSummaryChip(data.stationName, representativeGrade);
  },

  /**
   * 지도 상단 칩 정보 갱신
   */
  _updateMapSummaryChip(stationName, grade) {
    this.elements.chipStationName.innerText = stationName;

    // 등급 스타일 초기화 후 신규 반영
    this.elements.chipStationGrade.className = 'chip-badge';
    this.elements.chipStationGrade.classList.add(this._getBadgeClass(grade));
    this.elements.chipStationGrade.innerText = this._getGradeText(grade);

    this.elements.mapSummaryChip.classList.remove('hide');
  },

  /**
   * 주소 텍스트 갱신 (예: '서울특별시 종로구 혜화동')
   * @param {string} address 
   */
  updateUserAddress(address) {
    this.elements.userAddress.innerText = address || '주소를 식별할 수 없습니다.';
  },

  /**
   * 등급에 맞춰 테마 전환 및 대시보드 코멘트 업데이트
   * @param {string} grade - 등급 코드 ('1' ~ '4')
   */
  _updateThemeAndMessages(grade) {
    // 1. 바디 테마 클래스 스위칭
    this.elements.body.className = ''; // 초기화

    let themeClass = 'theme-unknown';
    let gradeText = '점검 중';
    let desc = '측정기 점검 또는 통신 지연 상태입니다.';
    let iconClass = 'fa-solid fa-circle-question';

    switch (grade) {
      case '1':
        themeClass = 'theme-good';
        gradeText = '매우 좋음';
        desc = '오늘은 공기가 아주 맑아요! 마음껏 환기하고 야외 활동을 만끽하세요. 🌲';
        iconClass = 'fa-solid fa-face-laugh-beam';
        break;
      case '2':
        themeClass = 'theme-normal';
        gradeText = '보통';
        desc = '일상적인 야외 활동과 환기가 가능해요. 평온하고 상쾌한 하루 보내세요! 😊';
        iconClass = 'fa-solid fa-face-smile';
        break;
      case '3':
        themeClass = 'theme-bad';
        gradeText = '나쁨';
        desc = '대기가 탁하네요. 호흡기 보호를 위해 외출 시 보건용 마스크를 꼭 착용하세요. 😷';
        iconClass = 'fa-solid fa-face-frown-open';
        break;
      case '4':
        themeClass = 'theme-verybad';
        gradeText = '매우 나쁨';
        desc = '대기질이 매우 심각합니다! 환기를 삼가고 가급적 야외 활동을 제한해 주세요. 🚨';
        iconClass = 'fa-solid fa-face-dizzy';
        break;
    }

    this.elements.body.classList.add(themeClass);
    this.elements.airGrade.innerText = gradeText;
    this.elements.statusDesc.innerText = desc;

    // 아이콘 클래스 스무스 교체
    this.elements.statusIcon.className = `status-big-icon ${iconClass}`;
  },

  /**
   * 게이지 프로그레스 바의 배경색 제어
   */
  _setProgressBarColor(progressBar, grade) {
    let color = '#64748b'; // unknown
    switch (grade) {
      case '1': color = '#3b82f6'; break; // 좋음 (블루)
      case '2': color = '#10b981'; break; // 보통 (그린)
      case '3': color = '#f97316'; break; // 나쁨 (오렌지)
      case '4': color = '#ef4444'; break; // 매우나쁨 (레드)
    }
    progressBar.style.backgroundColor = color;
  },

  /**
   * 등급에 어울리는 색상 글자 클래스명 반환 (PM10/PM2.5 라벨용)
   */
  _getGradeColorClass(grade) {
    switch (grade) {
      case '1': return 'text-good';
      case '2': return 'text-normal';
      case '3': return 'text-bad';
      case '4': return 'text-verybad';
      default: return 'text-muted';
    }
  },

  /**
   * 등급에 매칭되는 뱃지 클래스명 반환
   */
  _getBadgeClass(grade) {
    switch (grade) {
      case '1': return 'badge-good';
      case '2': return 'badge-normal';
      case '3': return 'badge-bad';
      case '4': return 'badge-verybad';
      default: return 'badge-unknown';
    }
  },

  /**
   * 등급 코드 한글 텍스트 반환
   */
  _getGradeText(grade) {
    switch (grade) {
      case '1': return '좋음';
      case '2': return '보통';
      case '3': return '나쁨';
      case '4': return '매우 나쁨';
      default: return '점검중';
    }
  },

  /**
   * 수치 원시값 파싱
   */
  _parseValue(val) {
    if (!val || val === '-' || isNaN(val)) return null;
    return parseInt(val);
  }
};
