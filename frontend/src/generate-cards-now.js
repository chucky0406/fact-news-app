const axios = require('axios');

const generateNow = async () => {
  try {
    const response = await axios.post('http://localhost:3001/api/generate-now');
    console.log('✅ 카드 생성 요청 완료!');
    console.log('데이터는 data/cards.json에 저장됩니다.');
  } catch (error) {
    console.error('❌ 오류:', error.message);
  }
};

generateNow();