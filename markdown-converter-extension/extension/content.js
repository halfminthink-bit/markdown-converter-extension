// Google Docs のエディタ要素を取得
function getDocsEditor() {
  return document.querySelector('.kix-appview-editor');
}

// Google Docs のメニューボタンをクリックして書式を適用
function applyFormatting(formattingType) {
  const formatButtons = {
    'heading1': () => {
      // Ctrl+Alt+1 のショートカットをシミュレート
      simulateKeyPress(49, true, true); // 49 = '1'
    },
    'heading2': () => {
      simulateKeyPress(50, true, true); // 50 = '2'
    },
    'heading3': () => {
      simulateKeyPress(51, true, true); // 51 = '3'
    },
    'bulletList': () => {
      simulateKeyPress(56, true, true); // 56 = '8' (Ctrl+Shift+8)
    },
    'numberedList': () => {
      simulateKeyPress(55, true, true); // 55 = '7' (Ctrl+Shift+7)
    },
    'bold': () => {
      simulateKeyPress(66, true, false); // 66 = 'B' (Ctrl+B)
    }
  };

  if (formatButtons[formattingType]) {
    formatButtons[formattingType]();
  }
}

// キーボードショートカットをシミュレート
function simulateKeyPress(keyCode, ctrlKey = false, altKey = false, shiftKey = false) {
  const editor = getDocsEditor();
  if (!editor) return;

  const event = new KeyboardEvent('keydown', {
    bubbles: true,
    cancelable: true,
    keyCode: keyCode,
    which: keyCode,
    ctrlKey: ctrlKey,
    altKey: altKey,
    shiftKey: shiftKey,
    metaKey: false
  });

  editor.dispatchEvent(event);
}

// テキストを選択
function selectText(node, startOffset, endOffset) {
  const selection = window.getSelection();
  const range = document.createRange();
  
  try {
    range.setStart(node, startOffset);
    range.setEnd(node, endOffset);
    selection.removeAllRanges();
    selection.addRange(range);
    return true;
  } catch (e) {
    console.error('選択エラー:', e);
    return false;
  }
}

// テキストを削除
function deleteSelectedText() {
  document.execCommand('delete', false, null);
}

// テキストを挿入
function insertText(text) {
  document.execCommand('insertText', false, text);
}

// Markdown記法を検出して変換
async function convertMarkdown() {
  const editor = getDocsEditor();
  if (!editor) {
    return { success: false, message: 'Google Docsのエディタが見つかりません' };
  }

  let conversions = {
    headings: 0,
    lists: 0,
    bold: 0
  };

  // エディタ内のすべてのテキストを取得
  const paragraphs = editor.querySelectorAll('.kix-paragraphrenderer');
  
  for (let para of paragraphs) {
    const textContent = para.textContent;
    
    // 見出しの検出と変換
    if (textContent.match(/^###\s+(.+)/)) {
      await convertHeading(para, 3);
      conversions.headings++;
    } else if (textContent.match(/^##\s+(.+)/)) {
      await convertHeading(para, 2);
      conversions.headings++;
    } else if (textContent.match(/^#\s+(.+)/)) {
      await convertHeading(para, 1);
      conversions.headings++;
    }
    
    // リストの検出と変換
    if (textContent.match(/^[-*]\s+(.+)/)) {
      await convertBulletList(para);
      conversions.lists++;
    } else if (textContent.match(/^\d+\.\s+(.+)/)) {
      await convertNumberedList(para);
      conversions.lists++;
    }
    
    // 太字の検出と変換
    const boldMatches = textContent.match(/\*\*(.+?)\*\*/g);
    if (boldMatches) {
      await convertBold(para, boldMatches);
      conversions.bold += boldMatches.length;
    }
  }

  const totalConversions = conversions.headings + conversions.lists + conversions.bold;
  
  if (totalConversions === 0) {
    return { 
      success: true, 
      message: 'Markdown記法が見つかりませんでした',
      details: conversions
    };
  }

  return { 
    success: true, 
    message: `${totalConversions}個の要素を変換しました`,
    details: conversions
  };
}

// 見出しに変換
async function convertHeading(para, level) {
  // 段落をクリックして選択
  para.click();
  
  // 少し待機
  await sleep(50);
  
  // Ctrl+A で段落全体を選択
  simulateKeyPress(65, true, false);
  
  await sleep(50);
  
  // 見出しを適用
  if (level === 1) {
    applyFormatting('heading1');
  } else if (level === 2) {
    applyFormatting('heading2');
  } else if (level === 3) {
    applyFormatting('heading3');
  }
  
  await sleep(50);
  
  // 行頭に移動
  simulateKeyPress(36, false, false); // Home key
  
  await sleep(50);
  
  // # 記号を削除（Shift+→で選択してDelete）
  const hashCount = level;
  for (let i = 0; i < hashCount + 1; i++) { // +1 はスペース分
    simulateKeyPress(39, false, false, true); // →キー + Shift
  }
  
  await sleep(50);
  
  deleteSelectedText();
  
  await sleep(50);
}

// 箇条書きリストに変換
async function convertBulletList(para) {
  para.click();
  await sleep(50);
  
  simulateKeyPress(65, true, false); // Ctrl+A
  await sleep(50);
  
  applyFormatting('bulletList');
  await sleep(50);
  
  // 行頭に移動して記号削除
  simulateKeyPress(36, false, false);
  await sleep(50);
  
  // - または * とスペースを削除
  simulateKeyPress(39, false, false, true);
  simulateKeyPress(39, false, false, true);
  await sleep(50);
  
  deleteSelectedText();
  await sleep(50);
}

// 番号付きリストに変換
async function convertNumberedList(para) {
  para.click();
  await sleep(50);
  
  simulateKeyPress(65, true, false);
  await sleep(50);
  
  applyFormatting('numberedList');
  await sleep(50);
  
  // 数字と. とスペースを削除
  simulateKeyPress(36, false, false);
  await sleep(50);
  
  // 数字の桁数に応じて削除（とりあえず最大3桁まで対応）
  const text = para.textContent;
  const match = text.match(/^(\d+)\.\s/);
  if (match) {
    const deleteCount = match[0].length;
    for (let i = 0; i < deleteCount; i++) {
      simulateKeyPress(39, false, false, true);
    }
    await sleep(50);
    deleteSelectedText();
  }
  
  await sleep(50);
}

// 太字に変換
async function convertBold(para, matches) {
  // 各 **text** を順番に処理
  for (let match of matches) {
    const text = para.textContent;
    const index = text.indexOf(match);
    
    if (index === -1) continue;
    
    // 段落をクリック
    para.click();
    await sleep(50);
    
    // 行頭に移動
    simulateKeyPress(36, false, false);
    await sleep(50);
    
    // マッチ位置まで移動
    for (let i = 0; i < index; i++) {
      simulateKeyPress(39, false, false);
      await sleep(10);
    }
    
    // ** を削除（前）
    simulateKeyPress(46, false, false); // Delete
    await sleep(30);
    simulateKeyPress(46, false, false);
    await sleep(30);
    
    // テキスト部分を選択
    const innerText = match.slice(2, -2);
    for (let i = 0; i < innerText.length; i++) {
      simulateKeyPress(39, false, false, true); // Shift+→
      await sleep(10);
    }
    
    await sleep(50);
    
    // 太字を適用
    applyFormatting('bold');
    await sleep(50);
    
    // 選択解除して右端に移動
    simulateKeyPress(39, false, false);
    await sleep(30);
    
    // ** を削除（後）
    simulateKeyPress(46, false, false);
    await sleep(30);
    simulateKeyPress(46, false, false);
    await sleep(50);
  }
}

// 待機関数
function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// メッセージリスナー
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === 'convertMarkdown') {
    convertMarkdown()
      .then(result => sendResponse(result))
      .catch(error => sendResponse({ 
        success: false, 
        message: error.message 
      }));
    return true; // 非同期レスポンスを示す
  }
});

console.log('Google Docs Markdown Converter loaded');
