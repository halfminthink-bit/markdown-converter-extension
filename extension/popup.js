// ポップアップが開かれたときの初期化
document.addEventListener('DOMContentLoaded', async () => {
  const convertBtn = document.getElementById('convertBtn');
  const undoBtn = document.getElementById('undoBtn');
  const btnText = document.getElementById('btnText');
  const undoBtnText = document.getElementById('undoBtnText');
  const statusDiv = document.getElementById('status');
  const resultDiv = document.getElementById('result');

  // 現在のタブがGoogle Docsかチェック
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  
  if (!tab.url || !tab.url.includes('docs.google.com/document')) {
    resultDiv.textContent = '⚠️ Google Docsで開いてください';
    resultDiv.classList.remove('hidden');
    resultDiv.classList.add('error');
    convertBtn.disabled = true;
    return;
  }

  // ドキュメントIDを取得
  const docIdMatch = tab.url.match(/\/document\/d\/([a-zA-Z0-9-_]+)/);
  const documentId = docIdMatch ? docIdMatch[1] : null;

  // 保存されたバックアップがあるかチェック
  if (documentId) {
    chrome.storage.local.get([`backup_${documentId}`], (result) => {
      if (result[`backup_${documentId}`]) {
        undoBtn.classList.remove('hidden');
      }
    });
  }

  // 変換ボタンのクリックイベント
  convertBtn.addEventListener('click', async () => {
    console.log('🔵 変換ボタンがクリックされました');
    
    // ボタンを無効化してローディング表示
    convertBtn.disabled = true;
    btnText.innerHTML = '<span class="loading-spinner"></span>変換中...';
    statusDiv.textContent = '🔐 認証中...';
    statusDiv.classList.remove('hidden');
    resultDiv.classList.add('hidden');

    try {
      // Background Service Workerにメッセージを送信
      const response = await chrome.runtime.sendMessage({
        action: 'convertMarkdown'
      });
      
      console.log('🔵 レスポンス受信:', response);

      if (response.success) {
        statusDiv.classList.add('hidden');
        resultDiv.textContent = `✅ ${response.message}`;
        resultDiv.classList.remove('hidden', 'error');
        
        // 詳細情報があれば表示
        if (response.details) {
          resultDiv.innerHTML = `
            <div style="margin-bottom: 8px;">✅ 変換が完了しました！</div>
            <div style="font-size: 11px; opacity: 0.8;">
              見出し: ${response.details.headings || 0}個<br>
              リスト: ${response.details.lists || 0}個<br>
              太字: ${response.details.bold || 0}個
            </div>
          `;
        }

        // 元に戻すボタンを表示
        undoBtn.classList.remove('hidden');
      } else {
        throw new Error(response.message || '変換に失敗しました');
      }
    } catch (error) {
      console.error('🔴 変換エラー:', error);
      statusDiv.classList.add('hidden');
      resultDiv.innerHTML = `
        <div style="margin-bottom: 8px;">❌ エラー: ${error.message}</div>
        <div style="font-size: 10px; opacity: 0.7;">
          F12 → Console でデバッグ情報を確認してください
        </div>
      `;
      resultDiv.classList.remove('hidden');
      resultDiv.classList.add('error');
    } finally {
      // ボタンを元に戻す
      convertBtn.disabled = false;
      btnText.textContent = '変換実行';
    }
  });

  // 元に戻すボタンのクリックイベント
  undoBtn.addEventListener('click', async () => {
    console.log('🔵 元に戻すボタンがクリックされました');
    
    // ボタンを無効化してローディング表示
    undoBtn.disabled = true;
    convertBtn.disabled = true;
    undoBtnText.innerHTML = '<span class="loading-spinner"></span>復元中...';
    statusDiv.textContent = '📥 元に戻しています...';
    statusDiv.classList.remove('hidden');
    resultDiv.classList.add('hidden');

    try {
      // Background Service Workerにメッセージを送信
      const response = await chrome.runtime.sendMessage({
        action: 'undoConversion'
      });
      
      console.log('🔵 レスポンス受信:', response);

      if (response.success) {
        statusDiv.classList.add('hidden');
        resultDiv.textContent = `✅ ${response.message}`;
        resultDiv.classList.remove('hidden', 'error');
        
        // 元に戻すボタンを非表示
        undoBtn.classList.add('hidden');
      } else {
        throw new Error(response.message || '復元に失敗しました');
      }
    } catch (error) {
      console.error('🔴 復元エラー:', error);
      statusDiv.classList.add('hidden');
      resultDiv.innerHTML = `
        <div style="margin-bottom: 8px;">❌ エラー: ${error.message}</div>
      `;
      resultDiv.classList.remove('hidden');
      resultDiv.classList.add('error');
    } finally {
      // ボタンを元に戻す
      undoBtn.disabled = false;
      convertBtn.disabled = false;
      undoBtnText.textContent = '⬅️ 元に戻す';
    }
  });
});