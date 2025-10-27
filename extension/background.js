// ============================================================================
// Background Service Worker - Google Docs Markdown Converter
// ============================================================================

console.log('🚀 Background Service Worker loaded');

// ============================================================================
// 1. 認証関連
// ============================================================================

/**
 * OAuth トークンを取得
 * @returns {Promise<string>} 認証トークン
 */
async function getAuthToken() {
  return new Promise((resolve, reject) => {
    chrome.identity.getAuthToken({ interactive: true }, (token) => {
      if (chrome.runtime.lastError) {
        console.error('認証エラー:', chrome.runtime.lastError);
        reject(chrome.runtime.lastError);
      } else {
        console.log('✅ 認証トークン取得成功');
        resolve(token);
      }
    });
  });
}

// ============================================================================
// 2. Google Docs API 関連
// ============================================================================

/**
 * URLからドキュメントIDを抽出
 * @param {string} url - Google DocsのURL
 * @returns {string|null} ドキュメントID
 */
function getDocumentIdFromUrl(url) {
  const match = url.match(/\/document\/d\/([a-zA-Z0-9-_]+)/);
  return match ? match[1] : null;
}

/**
 * ドキュメントの内容を取得
 * @param {string} documentId - ドキュメントID
 * @param {string} token - 認証トークン
 * @returns {Promise<Object>} ドキュメントオブジェクト
 */
async function getDocumentContent(documentId, token) {
  const url = `https://docs.googleapis.com/v1/documents/${documentId}`;
  
  const response = await fetch(url, {
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json'
    }
  });
  
  if (!response.ok) {
    throw new Error(`API Error: ${response.status} ${response.statusText}`);
  }
  
  return await response.json();
}

/**
 * バッチ更新リクエストを送信
 * @param {string} documentId - ドキュメントID
 * @param {string} token - 認証トークン
 * @param {Array} requests - リクエスト配列
 * @returns {Promise<Object>} レスポンス
 */
async function applyFormatting(documentId, token, requests) {
  const url = `https://docs.googleapis.com/v1/documents/${documentId}:batchUpdate`;
  
  console.log('📝 書式適用リクエスト数:', requests.length);
  
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ requests })
  });
  
  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`API Error: ${response.status} - ${errorText}`);
  }
  
  return await response.json();
}

// ============================================================================
// 3. バックアップと復元
// ============================================================================

/**
 * ドキュメントの現在の状態をバックアップ
 * @param {string} documentId - ドキュメントID
 * @param {Object} doc - ドキュメントオブジェクト
 */
async function saveBackup(documentId, doc) {
  const backup = {
    timestamp: Date.now(),
    content: JSON.stringify(doc),
    documentId: documentId
  };
  
  await chrome.storage.local.set({
    [`backup_${documentId}`]: backup
  });
  
  console.log('💾 バックアップ保存完了');
}

/**
 * バックアップを取得
 * @param {string} documentId - ドキュメントID
 * @returns {Promise<Object|null>} バックアップデータ
 */
async function getBackup(documentId) {
  return new Promise((resolve) => {
    chrome.storage.local.get([`backup_${documentId}`], (result) => {
      resolve(result[`backup_${documentId}`] || null);
    });
  });
}

/**
 * バックアップを削除
 * @param {string} documentId - ドキュメントID
 */
async function clearBackup(documentId) {
  await chrome.storage.local.remove([`backup_${documentId}`]);
  console.log('🗑️ バックアップ削除完了');
}

/**
 * ドキュメントを完全に置き換える
 * @param {string} documentId - ドキュメントID
 * @param {string} token - 認証トークン
 * @param {Object} originalDoc - 元のドキュメント
 */
async function restoreDocument(documentId, token, originalDoc) {
  console.log('📥 ドキュメント復元開始...');
  
  // 現在のドキュメントを取得
  const currentDoc = await getDocumentContent(documentId, token);
  
  // すべてのコンテンツを削除
  const deleteRequests = [{
    deleteContentRange: {
      range: {
        startIndex: 1,
        endIndex: currentDoc.body.content[currentDoc.body.content.length - 1].endIndex - 1
      }
    }
  }];
  
  await applyFormatting(documentId, token, deleteRequests);
  console.log('🗑️ 既存コンテンツ削除完了');
  
  // 元のコンテンツを挿入
  const insertRequests = [];
  const originalBody = originalDoc.body;
  
  // テキストを抽出して挿入
  let textToInsert = '';
  for (const element of originalBody.content) {
    if (element.paragraph && element.paragraph.elements) {
      for (const textElement of element.paragraph.elements) {
        if (textElement.textRun && textElement.textRun.content) {
          textToInsert += textElement.textRun.content;
        }
      }
    }
  }
  
  if (textToInsert) {
    insertRequests.push({
      insertText: {
        location: { index: 1 },
        text: textToInsert
      }
    });
  }
  
  await applyFormatting(documentId, token, insertRequests);
  console.log('✅ ドキュメント復元完了');
}

// ============================================================================
// 4. テキスト抽出
// ============================================================================

/**
 * ドキュメントからテキストを抽出
 * @param {Object} doc - ドキュメントオブジェクト
 * @returns {string} 抽出されたテキスト
 */
function extractText(doc) {
  let fullText = '';
  const body = doc.body;
  
  if (!body || !body.content) {
    return fullText;
  }
  
  for (const element of body.content) {
    if (element.paragraph && element.paragraph.elements) {
      for (const textElement of element.paragraph.elements) {
        if (textElement.textRun && textElement.textRun.content) {
          fullText += textElement.textRun.content;
        }
      }
    }
  }
  
  return fullText;
}

/**
 * テキストの位置を検索
 * @param {Object} doc - ドキュメントオブジェクト
 * @param {string} searchText - 検索するテキスト
 * @returns {Object|null} 位置情報 {startIndex, endIndex}
 */
function findTextPosition(doc, searchText) {
  let currentIndex = 1; // Google Docs API はインデックス1から開始
  const body = doc.body;
  
  if (!body || !body.content) {
    return null;
  }
  
  for (const element of body.content) {
    if (element.paragraph && element.paragraph.elements) {
      for (const textElement of element.paragraph.elements) {
        if (textElement.textRun && textElement.textRun.content) {
          const content = textElement.textRun.content;
          const foundIndex = content.indexOf(searchText);
          
          if (foundIndex !== -1) {
            return {
              startIndex: currentIndex + foundIndex,
              endIndex: currentIndex + foundIndex + searchText.length
            };
          }
          
          currentIndex += content.length;
        }
      }
    }
  }
  
  return null;
}

// ============================================================================
// 5. Markdown検出
// ============================================================================

/**
 * 見出しとリストのMarkdown記法を検出
 * @param {string} text - テキスト
 * @returns {Array} 検出結果の配列
 */
function detectMarkdown(text) {
  const lines = text.split('\n');
  const detections = [];
  
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmedLine = line.trim();
    
    if (!trimmedLine) continue;
    
    // 見出し1
    if (trimmedLine.match(/^#\s+(.+)/)) {
      detections.push({ line: i, type: 'heading1', text: line });
    }
    // 見出し2
    else if (trimmedLine.match(/^##\s+(.+)/)) {
      detections.push({ line: i, type: 'heading2', text: line });
    }
    // 見出し3
    else if (trimmedLine.match(/^###\s+(.+)/)) {
      detections.push({ line: i, type: 'heading3', text: line });
    }
    // 箇条書き
    else if (trimmedLine.match(/^[-*]\s*(.+)/)) {
      detections.push({ line: i, type: 'bullet', text: line });
    }
    // 番号付きリスト
    else if (trimmedLine.match(/^\d+\.\s*(.+)/)) {
      detections.push({ line: i, type: 'numbered', text: line });
    }
  }
  
  return detections;
}

/**
 * 太字のMarkdown記法を検出（要素ベース）
 * @param {Object} doc - ドキュメントオブジェクト
 * @returns {Array} 検出結果の配列
 */
function detectBoldMarkdown(doc) {
  const detections = [];
  const body = doc.body;
  
  if (!body || !body.content) {
    return detections;
  }
  
  const boldPattern = /\*\*(.+?)\*\*/g;
  
  for (const element of body.content) {
    const para = element.paragraph;
    if (!para || !para.elements) {
      continue;
    }
    
    for (const textElement of para.elements) {
      const textRun = textElement.textRun;
      if (!textRun || !textRun.content) {
        continue;
      }
      
      const content = textRun.content;
      const baseIndex = textElement.startIndex;
      
      const matches = [...content.matchAll(boldPattern)];
      for (const match of matches) {
        const matchStart = match.index;
        const matchEnd = matchStart + match[0].length;
        
        detections.push({
          type: 'bold',
          startIndex: baseIndex + matchStart,
          endIndex: baseIndex + matchEnd,
          innerStart: baseIndex + matchStart + 2,
          innerEnd: baseIndex + matchEnd - 2,
          innerText: match[1],
          fullMatch: match[0]
        });
      }
    }
  }
  
  return detections;
}

// ============================================================================
// 6. 書式リクエスト生成
// ============================================================================

/**
 * 見出しとリスト用の書式リクエストを生成
 */
function createFormattingRequestsForHeadingsAndLists(doc, detections) {
  const requests = [];
  
  for (let i = detections.length - 1; i >= 0; i--) {
    const detection = detections[i];
    const trimmedText = detection.text.trim();
    const position = findTextPosition(doc, detection.text) || findTextPosition(doc, trimmedText);
    
    if (!position) {
      console.warn(`⚠️ テキストが見つかりません: "${detection.text}"`);
      continue;
    }
    
    // 書式を適用
    if (detection.type === 'heading1') {
      requests.push({
        updateParagraphStyle: {
          range: { startIndex: position.startIndex, endIndex: position.endIndex },
          paragraphStyle: { namedStyleType: 'HEADING_1' },
          fields: 'namedStyleType'
        }
      });
    } else if (detection.type === 'heading2') {
      requests.push({
        updateParagraphStyle: {
          range: { startIndex: position.startIndex, endIndex: position.endIndex },
          paragraphStyle: { namedStyleType: 'HEADING_2' },
          fields: 'namedStyleType'
        }
      });
    } else if (detection.type === 'heading3') {
      requests.push({
        updateParagraphStyle: {
          range: { startIndex: position.startIndex, endIndex: position.endIndex },
          paragraphStyle: { namedStyleType: 'HEADING_3' },
          fields: 'namedStyleType'
        }
      });
    } else if (detection.type === 'bullet') {
      requests.push({
        createParagraphBullets: {
          range: { startIndex: position.startIndex, endIndex: position.endIndex },
          bulletPreset: 'BULLET_DISC_CIRCLE_SQUARE'
        }
      });
    } else if (detection.type === 'numbered') {
      requests.push({
        createParagraphBullets: {
          range: { startIndex: position.startIndex, endIndex: position.endIndex },
          bulletPreset: 'NUMBERED_DECIMAL_ALPHA_ROMAN'
        }
      });
    }
    
    // Markdown記号を削除
    let symbolLength = 0;
    const trimmedLine = detection.text.trim();
    
    if (detection.type === 'heading1') {
      const match = trimmedLine.match(/^#\s+/);
      symbolLength = match ? match[0].length : 2;
    } else if (detection.type === 'heading2') {
      const match = trimmedLine.match(/^##\s+/);
      symbolLength = match ? match[0].length : 3;
    } else if (detection.type === 'heading3') {
      const match = trimmedLine.match(/^###\s+/);
      symbolLength = match ? match[0].length : 4;
    } else if (detection.type === 'bullet') {
      const match = trimmedLine.match(/^[-*]\s*/);
      symbolLength = match ? match[0].length : 2;
    } else if (detection.type === 'numbered') {
      const match = trimmedLine.match(/^\d+\.\s*/);
      symbolLength = match ? match[0].length : 3;
    }
    
    const leadingSpaces = detection.text.length - detection.text.trimStart().length;
    const actualStart = position.startIndex + leadingSpaces;
    
    if (symbolLength > 0) {
      requests.push({
        deleteContentRange: {
          range: { startIndex: actualStart, endIndex: actualStart + symbolLength }
        }
      });
    }
  }
  
  return requests;
}

/**
 * 太字用の書式リクエストを生成
 */
function createFormattingRequestsForBold(boldDetections) {
  const requests = [];
  
  for (let i = boldDetections.length - 1; i >= 0; i--) {
    const detection = boldDetections[i];
    
    requests.push({
      updateTextStyle: {
        range: { startIndex: detection.innerStart, endIndex: detection.innerEnd },
        textStyle: { bold: true },
        fields: 'bold'
      }
    });
    
    requests.push({
      deleteContentRange: {
        range: { startIndex: detection.endIndex - 2, endIndex: detection.endIndex }
      }
    });
    
    requests.push({
      deleteContentRange: {
        range: { startIndex: detection.startIndex, endIndex: detection.startIndex + 2 }
      }
    });
  }
  
  return requests;
}

// ============================================================================
// 7. メイン変換処理
// ============================================================================

/**
 * Markdown を Google Docs の書式に変換
 */
async function convertMarkdown(tabUrl) {
  console.log('\n=== Markdown変換開始 ===');
  
  try {
    const documentId = getDocumentIdFromUrl(tabUrl);
    if (!documentId) {
      throw new Error('ドキュメントIDを取得できませんでした');
    }
    
    const token = await getAuthToken();
    const doc = await getDocumentContent(documentId, token);
    
    // バックアップを保存
    await saveBackup(documentId, doc);
    
    const text = extractText(doc);
    const headingsAndLists = detectMarkdown(text);
    const boldDetections = detectBoldMarkdown(doc);
    
    console.log('🔍 見出し/リスト:', headingsAndLists.length + '個');
    console.log('🔍 太字:', boldDetections.length + '個');
    
    if (headingsAndLists.length === 0 && boldDetections.length === 0) {
      return {
        success: false,
        message: 'Markdown記法が見つかりませんでした'
      };
    }
    
    // 見出しとリストを変換
    if (headingsAndLists.length > 0) {
      const headingRequests = createFormattingRequestsForHeadingsAndLists(doc, headingsAndLists);
      await applyFormatting(documentId, token, headingRequests);
      console.log('✅ 見出し/リスト変換完了');
    }
    
    // 太字を変換
    if (boldDetections.length > 0) {
      const docAfter = await getDocumentContent(documentId, token);
      const boldDetectionsAfter = detectBoldMarkdown(docAfter);
      
      if (boldDetectionsAfter.length > 0) {
        const boldRequests = createFormattingRequestsForBold(boldDetectionsAfter);
        await applyFormatting(documentId, token, boldRequests);
        console.log('✅ 太字変換完了');
      }
    }
    
    return {
      success: true,
      message: `${headingsAndLists.length + boldDetections.length}個のMarkdown記法を変換しました`,
      details: {
        headings: headingsAndLists.filter(d => d.type.startsWith('heading')).length,
        lists: headingsAndLists.filter(d => d.type === 'bullet' || d.type === 'numbered').length,
        bold: boldDetections.length
      }
    };
    
  } catch (error) {
    console.error('❌ エラー:', error);
    return { success: false, message: 'エラー: ' + error.message };
  }
}

/**
 * 変換を元に戻す
 */
async function undoConversion(tabUrl) {
  console.log('\n=== 元に戻す処理開始 ===');
  
  try {
    const documentId = getDocumentIdFromUrl(tabUrl);
    if (!documentId) {
      throw new Error('ドキュメントIDを取得できませんでした');
    }
    
    const backup = await getBackup(documentId);
    if (!backup) {
      throw new Error('バックアップが見つかりません');
    }
    
    const token = await getAuthToken();
    const originalDoc = JSON.parse(backup.content);
    
    await restoreDocument(documentId, token, originalDoc);
    await clearBackup(documentId);
    
    return {
      success: true,
      message: '元の状態に復元しました'
    };
    
  } catch (error) {
    console.error('❌ エラー:', error);
    return { success: false, message: 'エラー: ' + error.message };
  }
}

// ============================================================================
// 8. メッセージリスナー
// ============================================================================

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === 'convertMarkdown') {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      if (tabs[0]) {
        convertMarkdown(tabs[0].url)
          .then(result => sendResponse(result))
          .catch(error => sendResponse({ success: false, message: error.message }));
      }
    });
    return true;
  }
  
  if (request.action === 'undoConversion') {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      if (tabs[0]) {
        undoConversion(tabs[0].url)
          .then(result => sendResponse(result))
          .catch(error => sendResponse({ success: false, message: error.message }));
      }
    });
    return true;
  }
});