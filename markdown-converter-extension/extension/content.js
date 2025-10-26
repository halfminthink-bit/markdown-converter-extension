// Google Docs Markdown Converter - クリップボード版

console.log('✅ Google Docs Markdown Converter loaded (クリップボード版)');

// Markdownを変換する関数
function convertMarkdownToGoogleDocs(text) {
  console.log('\n=== Markdown変換開始 ===');
  console.log('入力テキスト（最初の200文字）:', text.substring(0, 200));
  console.log('テキスト長:', text.length);
  
  const lines = text.split(/\r?\n/);
  console.log('行数:', lines.length);
  
  let conversions = {
    headings: 0,
    lists: 0,
    bold: 0
  };
  
  // 変換後のテキストを格納
  let convertedLines = [];
  
  console.log('\n--- 行ごとの変換 ---');
  
  for (let i = 0; i < lines.length; i++) {
    let line = lines[i];
    let originalLine = line;
    let converted = false;
    
    // 見出し3の変換 (### )
    if (line.match(/^###\s+(.+)/)) {
      line = line.replace(/^###\s+/, '');
      conversions.headings++;
      converted = true;
      console.log(`[${i+1}] 見出し3: "${originalLine}" → "${line}"`);
    }
    // 見出し2の変換 (## )
    else if (line.match(/^##\s+(.+)/)) {
      line = line.replace(/^##\s+/, '');
      conversions.headings++;
      converted = true;
      console.log(`[${i+1}] 見出し2: "${originalLine}" → "${line}"`);
    }
    // 見出し1の変換 (# )
    else if (line.match(/^#\s+(.+)/)) {
      line = line.replace(/^#\s+/, '');
      conversions.headings++;
      converted = true;
      console.log(`[${i+1}] 見出し1: "${originalLine}" → "${line}"`);
    }
    
    // 箇条書きリストの変換 (- または *)
    if (line.match(/^[-*]\s+(.+)/)) {
      line = line.replace(/^[-*]\s+/, '• ');
      conversions.lists++;
      converted = true;
      console.log(`[${i+1}] 箇条書き: "${originalLine}" → "${line}"`);
    }
    // 番号付きリストの変換 (1. 2. など)
    else if (line.match(/^\d+\.\s+(.+)/)) {
      // 番号はそのまま維持
      conversions.lists++;
      converted = true;
      console.log(`[${i+1}] 番号リスト: "${originalLine}"`);
    }
    
    // 太字の変換 (**text**)
    const boldMatches = line.match(/\*\*(.+?)\*\*/g);
    if (boldMatches) {
      boldMatches.forEach(match => {
        const innerText = match.replace(/\*\*/g, '');
        // 太字マークを除去（Google Docsでは貼り付け後に手動で太字化が必要）
        line = line.replace(match, innerText);
        conversions.bold++;
      });
      converted = true;
      console.log(`[${i+1}] 太字: "${originalLine}" → "${line}"`);
    }
    
    convertedLines.push(line);
  }
  
  const convertedText = convertedLines.join('\n');
  
  console.log('\n=== 変換結果 ===');
  console.log('見出し:', conversions.headings + '個');
  console.log('リスト:', conversions.lists + '個');
  console.log('太字:', conversions.bold + '個');
  console.log('合計:', (conversions.headings + conversions.lists + conversions.bold) + '個');
  console.log('\n変換後テキスト（最初の200文字）:', convertedText.substring(0, 200));
  console.log('=== 変換完了 ===\n');
  
  return {
    text: convertedText,
    conversions: conversions
  };
}

// メッセージリスナー
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === 'convertMarkdown') {
    handleConversion()
      .then(result => sendResponse(result))
      .catch(error => {
        console.error('エラー:', error);
        sendResponse({ 
          success: false, 
          message: 'エラーが発生しました: ' + error.message 
        });
      });
    return true; // 非同期レスポンスを示す
  }
});

// 変換処理のメインロジック
async function handleConversion() {
  console.log('\n🚀 変換処理開始');
  
  try {
    // クリップボードからテキストを読み取る
    console.log('📋 クリップボードからテキストを読み取り中...');
    const clipboardText = await navigator.clipboard.readText();
    
    if (!clipboardText || clipboardText.trim() === '') {
      return {
        success: false,
        message: 'クリップボードが空です。テキストを選択してコピー（Ctrl+C）してください。'
      };
    }
    
    console.log('✅ クリップボードからテキストを取得しました');
    console.log('文字数:', clipboardText.length);
    
    // Markdown記法が含まれているかチェック
    const hasMarkdown = 
      clipboardText.includes('#') ||
      clipboardText.includes('- ') ||
      clipboardText.includes('* ') ||
      clipboardText.includes('**');
    
    if (!hasMarkdown) {
      return {
        success: false,
        message: 'Markdown記法が見つかりません。#, -, *, ** などを含むテキストをコピーしてください。'
      };
    }
    
    // Markdown変換
    const result = convertMarkdownToGoogleDocs(clipboardText);
    
    if (result.conversions.headings === 0 && 
        result.conversions.lists === 0 && 
        result.conversions.bold === 0) {
      return {
        success: false,
        message: 'Markdown記法が検出されませんでした。記号の後にスペースを入れてください（例: "# 見出し"）'
      };
    }
    
    // 変換後のテキストをクリップボードに書き込む
    console.log('📋 変換後のテキストをクリップボードに書き込み中...');
    await navigator.clipboard.writeText(result.text);
    console.log('✅ クリップボードに書き込み完了');
    
    return {
      success: true,
      message: '変換完了！ Ctrl+V で貼り付けてください。',
      details: result.conversions
    };
    
  } catch (error) {
    console.error('❌ エラー:', error);
    
    if (error.name === 'NotAllowedError') {
      return {
        success: false,
        message: 'クリップボードへのアクセスが拒否されました。ブラウザの設定を確認してください。'
      };
    }
    
    throw error;
  }
}

// ページ読み込み時の初期化
console.log('💡 使い方:');
console.log('1. Markdownテキストを選択');
console.log('2. Ctrl+C でコピー');
console.log('3. 拡張機能のボタンをクリック');
console.log('4. Ctrl+V で貼り付け');