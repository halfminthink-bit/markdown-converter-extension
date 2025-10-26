// ポップアップが開かれたときの初期化
document.addEventListener('DOMContentLoaded', async () => {
  const convertBtn = document.getElementById('convertBtn');
  const btnText = document.getElementById('btnText');
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

  // 変換ボタンのクリックイベント
  convertBtn.addEventListener('click', async () => {
    const mode = document.querySelector('input[name="mode"]:checked').value;
    
    if (mode !== 'markdown') {
      resultDiv.textContent = '⚠️ このモードは近日公開予定です';
      resultDiv.classList.remove('hidden');
      resultDiv.classList.add('error');
      return;
    }

    // ボタンを無効化してローディング表示
    convertBtn.disabled = true;
    btnText.innerHTML = '<span class="loading-spinner"></span>変換中...';
    statusDiv.textContent = '📝 文書を解析しています...';
    statusDiv.classList.remove('hidden');
    resultDiv.classList.add('hidden');

    try {
      // Content scriptにメッセージを送信
      const response = await chrome.tabs.sendMessage(tab.id, {
        action: 'convertMarkdown'
      });

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
      } else {
        throw new Error(response.message || '変換に失敗しました');
      }
    } catch (error) {
      console.error('変換エラー:', error);
      statusDiv.classList.add('hidden');
      resultDiv.textContent = `❌ エラー: ${error.message}`;
      resultDiv.classList.remove('hidden');
      resultDiv.classList.add('error');
    } finally {
      // ボタンを元に戻す
      convertBtn.disabled = false;
      btnText.textContent = '変換実行';
    }
  });
});
