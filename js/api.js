/**
 * @file api.js
 * @description 공공데이터포털의 대기오염정보 및 측정소 정보 API와의 비동기 통신을 처리하며,
 *              CORS 제한을 극복하기 위한 Proxy Fallback 메커니즘을 포함합니다.
 */

const AirApi = {
  // 기본 엔드포인트 설정
  AIR_POLLUTION_ENDPOINT: 'https://apis.data.go.kr/B552584/ArpltnInforInqireSvc',
  STATION_INFO_ENDPOINT: 'https://apis.data.go.kr/B552584/MsrstnInfoInqireSvc',

  /**
   * CORS 프록시를 포함한 지능형 fetch 함수
   * @param {string} url - 요청할 공공데이터 API 절대 경로
   * @returns {Promise<any>} JSON 결과 데이터
   */
  async fetchWithProxy(url) {
    try {
      console.log(`[API Request] Direct calling: ${url}`);
      const response = await fetch(url);
      
      if (!response.ok) {
        throw new Error(`Direct Fetch Failed (Status: ${response.status})`);
      }

      const text = await response.text();
      
      // 공공데이터 API의 에러(키 오류, 세션 만료 등)가 간혹 XML 형태로 전달되는 경우 에러 처리
      if (text.trim().startsWith('<?xml') || text.trim().startsWith('<response>')) {
        // XML 에러 메시지를 파싱하여 오류 원인 검출
        const parser = new DOMParser();
        const xmlDoc = parser.parseFromString(text, 'text/xml');
        const resultCode = xmlDoc.getElementsByTagName('returnReasonCode')[0]?.textContent || '';
        const errMsg = xmlDoc.getElementsByTagName('returnAuthMsg')[0]?.textContent
                       || xmlDoc.getElementsByTagName('returnResultMessage')[0]?.textContent 
                       || xmlDoc.getElementsByTagName('errMsg')[0]?.textContent 
                       || '알 수 없는 공공데이터포털 API 내부 오류가 발생했습니다.';
        
        // 일반적인 공공데이터 API 에러 코드에 대한 친절한 안내 추가
        let helpMsg = '';
        if (resultCode === '20' || errMsg.includes('SERVICE_KEY_IS_NOT_REGISTERED_ERROR')) {
          helpMsg = ' (API 키가 등록되지 않았거나, 활용 신청이 완료되지 않았습니다. 공공데이터포털에서 승인 상태를 확인하세요.)';
        } else if (resultCode === '22' || errMsg.includes('SERVICE_ACCESS_DENIED_ERROR')) {
          helpMsg = ' (해당 서비스에 대한 접근 권한이 없습니다. 공공데이터포털에서 대기오염정보 API 활용 신청을 확인하세요.)';
        } else if (resultCode === '30' || errMsg.includes('LIMITED_NUMBER_OF_SERVICE_REQUESTS_EXCEEDS_ERROR')) {
          helpMsg = ' (오늘 API 호출 한도가 초과되었습니다. 내일 다시 시도하거나 설정에서 개인 키를 입력하세요.)';
        } else if (resultCode === '12' || errMsg.includes('NO_OPENAPI_SERVICE_ERROR')) {
          helpMsg = ' (해당 API 서비스가 존재하지 않거나 일시 중단되었습니다.)';
        }
        
        console.error(`[API XML Error] Code: ${resultCode}, Message: ${errMsg}`);
        throw new Error(`[API 오류] ${errMsg}${helpMsg}`);
      }

      return JSON.parse(text);
    } catch (err) {
      console.warn(`[CORS/Network Issue] Direct call to API failed. Attempting proxy bypass...`, err.message);
      
      // AllOrigins CORS Proxy 서비스 이용 (경유 요청)
      // allorigins.win의 /raw 엔드포인트는 전달된 URL의 응답을 가공 없이 원시 문자열로 그대로 제공해 주어 CORS 우회에 최적입니다.
      const proxyUrl = `https://api.allorigins.win/raw?url=${encodeURIComponent(url)}`;
      
      try {
        console.log(`[API Request] Proxy calling via AllOrigins: ${proxyUrl}`);
        const proxyResponse = await fetch(proxyUrl);
        if (!proxyResponse.ok) {
          throw new Error(`Proxy Request Failed (Status: ${proxyResponse.status})`);
        }
        
        const proxyText = await proxyResponse.text();
        if (proxyText.trim().startsWith('<?xml') || proxyText.trim().startsWith('<response>')) {
          const parser = new DOMParser();
          const xmlDoc = parser.parseFromString(proxyText, 'text/xml');
          const errMsg = xmlDoc.getElementsByTagName('returnResultMessage')[0]?.textContent 
                         || xmlDoc.getElementsByTagName('errMsg')[0]?.textContent 
                         || '프록시를 경유했으나 API 내부 오류 응답을 수신했습니다.';
          throw new Error(`[API XML Error via Proxy] ${errMsg}`);
        }

        return JSON.parse(proxyText);
      } catch (proxyErr) {
        console.error(`[API Critical Error] All fetch attempts failed.`, proxyErr);
        throw new Error(proxyErr.message || '네트워크 연결이 끊겼거나 API 호출 한도를 초과했습니다.');
      }
    }
  },

  /**
   * 1. 시도별 실시간 대기 정보 조회 (getCtprvnRltmMesureDnsty)
   * @param {string} sidoName - 시도 한글명 (예: '서울', '경기', '인천' 등)
   * @returns {Promise<Array>} 측정소별 미세먼지 수치 배열
   */
  async getSidoAirQuality(sidoName) {
    const serviceKey = AppConfig.getPublicKey();
    // ver=1.3 파라미터를 주어 미세먼지, 초미세먼지 예보와 수치 단위를 최신 정보로 받음
    const params = new URLSearchParams({
      serviceKey: serviceKey,
      returnType: 'json',
      numOfRows: '100', // 한 번에 해당 시도의 모든 측정소 조회를 위해 100 설정
      pageNo: '1',
      sidoName: sidoName,
      ver: '1.3'
    });

    const url = `${this.AIR_POLLUTION_ENDPOINT}/getCtprvnRltmMesureDnsty?${params.toString()}`;
    const data = await this.fetchWithProxy(url);
    
    if (data?.response?.header?.resultCode !== '00') {
      throw new Error(data?.response?.header?.resultMsg || '시도별 대기 데이터를 가져오는 데 실패했습니다.');
    }
    
    return data?.response?.body?.items || [];
  },

  /**
   * 2. 특정 측정소의 실시간 정보 조회 (getMsrstnAcctoRltmMesureDnsty)
   * @param {string} stationName - 측정소명 (예: '종로구')
   * @returns {Promise<Object|null>} 특정 측정소의 실시간 정보 상세 객체
   */
  async getStationAirQuality(stationName) {
    const serviceKey = AppConfig.getPublicKey();
    const params = new URLSearchParams({
      serviceKey: serviceKey,
      returnType: 'json',
      numOfRows: '1', // 가장 최신의 측정값 1건만 필요
      pageNo: '1',
      stationName: stationName,
      dataTerm: 'DAILY',
      ver: '1.3'
    });

    const url = `${this.AIR_POLLUTION_ENDPOINT}/getMsrstnAcctoRltmMesureDnsty?${params.toString()}`;
    const data = await this.fetchWithProxy(url);

    if (data?.response?.header?.resultCode !== '00') {
      throw new Error(data?.response?.header?.resultMsg || '측정소 상세 대기 데이터를 가져오는 데 실패했습니다.');
    }

    const items = data?.response?.body?.items || [];
    return items.length > 0 ? items[0] : null;
  },

  /**
   * 3. 측정소 목록 조회 (getMsrstnList) - 위치 주소 정보 획득 목적
   * @param {string} sidoName - 시도 한글명 (예: '서울', '경기' 등)
   * @returns {Promise<Array>} 측정소 주소 및 좌표(TM) 정보 배열
   */
  async getStationList(sidoName) {
    const serviceKey = AppConfig.getPublicKey();
    // 주소 일부(시도 한글명)로 필터링하여 해당 시도의 측정소 목록을 가져옵니다.
    const params = new URLSearchParams({
      serviceKey: serviceKey,
      returnType: 'json',
      numOfRows: '500', // 시도 전체 측정소를 넉넉하게 불러오기 위해 500 지정
      pageNo: '1',
      addr: sidoName
    });

    const url = `${this.STATION_INFO_ENDPOINT}/getMsrstnList?${params.toString()}`;
    const data = await this.fetchWithProxy(url);

    if (data?.response?.header?.resultCode !== '00') {
      throw new Error(data?.response?.header?.resultMsg || '측정소 위치 데이터를 가져오는 데 실패했습니다.');
    }

    return data?.response?.body?.items || [];
  }
};
