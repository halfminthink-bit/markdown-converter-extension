// Background Service Worker - OAuth認証とDocs API処理

console.log('🚀 Background Service Worker loaded');

// OAuth トークンを取得
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

// URLからドキュメントIDを抽出
function getDocumentIdFromUrl(url) {
  const match = url.match(/\/document\/d\/([a-zA-Z0-9-_]+)/);
  return match ? match[1] : null;
}

// Google Docs API: ドキュメントの内容を取得
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

// ドキュメントからテキストを抽出
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

// Markdown記法を検出（見出しとリストのみ）
function detectMarkdown(text) {
  const lines = text.split('\n');
  const detections = [];
  
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    
    // 見出し1
    if (line.match(/^#\s+(.+)/)) {
      detections.push({ line: i, type: 'heading1', text: line });
    }
    // 見出し2
    else if (line.match(/^##\s+(.+)/)) {
      detections.push({ line: i, type: 'heading2', text: line });
    }
    // 見出し3
    else if (line.match(/^###\s+(.+)/)) {
      detections.push({ line: i, type: 'heading3', text: line });
    }
    // 箇条書き
    else if (line.match(/^[-*]\s+(.+)/)) {
      detections.push({ line: i, type: 'bullet', text: line });
    }
    // 番号付きリスト
    else if (line.match(/^\d+\.\s+(.+)/)) {
      detections.push({ line: i, type: 'numbered', text: line });
    }
  }
  
  return detections;
}

// 太字の検出（要素ベース - Python版と同じロジック）
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
      
      // すべての **text** パターンを検出
      const matches = [...content.matchAll(boldPattern)];
      for (const match of matches) {
        const matchStart = match.index;
        const matchEnd = matchStart + match[0].length;
        
        detections.push({
          type: 'bold',
          startIndex: baseIndex + matchStart,      // ** の開始位置
          endIndex: baseIndex + matchEnd,          // ** の終了位置
          innerStart: baseIndex + matchStart + 2,  // 内側テキストの開始
          innerEnd: baseIndex + matchEnd - 2,      // 内側テキストの終了
          innerText: match[1],
          fullMatch: match[0]
        });
      }
    }
  }
  
  return detections;
}

// テキストの位置を検索
function findTextPosition(doc, searchText) {
  let currentIndex = 1; // ⚠️ Google Docs API はインデックス1から開始
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

// Google Docs API: バッチ更新リクエストを送信
async function applyFormatting(documentId, token, requests) {
  const url = `https://docs.googleapis.com/v1/documents/${documentId}:batchUpdate`;
  
  console.log('📝 書式適用リクエスト:', JSON.stringify(requests, null, 2));
  
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

// Markdown記法に基づいて書式リクエストを生成（見出しとリスト）
function createFormattingRequests(doc, detections) {
  const requests = [];
  
  // 逆順で処理（後ろから削除しないと位置がずれる）
  for (let i = detections.length - 1; i >= 0; i--) {
    const detection = detections[i];
    console.log(`処理中: ${detection.type} - "${detection.text.substring(0, 50)}"`);
    
    // テキストの位置を検索
    const position = findTextPosition(doc, detection.text);
    
    if (!position) {
      console.warn(`⚠️ テキストが見つかりません: "${detection.text}"`);
      continue;
    }
    
    console.log(`✅ 位置検出: ${position.startIndex} - ${position.endIndex}`);
    
    // まず書式を適用（削除前に）
    if (detection.type === 'heading1') {
      requests.push({
        updateParagraphStyle: {
          range: {
            startIndex: position.startIndex,
            endIndex: position.endIndex
          },
          paragraphStyle: {
            namedStyleType: 'HEADING_1'
          },
          fields: 'namedStyleType'
        }
      });
    } else if (detection.type === 'heading2') {
      requests.push({
        updateParagraphStyle: {
          range: {
            startIndex: position.startIndex,
            endIndex: position.endIndex
          },
          paragraphStyle: {
            namedStyleType: 'HEADING_2'
          },
          fields: 'namedStyleType'
        }
      });
    } else if (detection.type === 'heading3') {
      requests.push({
        updateParagraphStyle: {
          range: {
            startIndex: position.startIndex,
            endIndex: position.endIndex
          },
          paragraphStyle: {
            namedStyleType: 'HEADING_3'
          },
          fields: 'namedStyleType'
        }
      });
    } else if (detection.type === 'bullet') {
      requests.push({
        createParagraphBullets: {
          range: {
            startIndex: position.startIndex,
            endIndex: position.endIndex
          },
          bulletPreset: 'BULLET_DISC_CIRCLE_SQUARE'
        }
      });
    }
    
    // その後、Markdown記号を削除
    let symbolLength = 0;
    if (detection.type === 'heading1') symbolLength = 2; // "# "
    else if (detection.type === 'heading2') symbolLength = 3; // "## "
    else if (detection.type === 'heading3') symbolLength = 4; // "### "
    else if (detection.type === 'bullet') symbolLength = 2; // "- "
    
    if (symbolLength > 0) {
      requests.push({
        deleteContentRange: {
          range: {
            startIndex: position.startIndex,
            endIndex: position.startIndex + symbolLength
          }
        }
      });
    }
  }
  
  return requests;
}

// 太字用の書式リクエストを生成（Python版と同じロジック）
function createFormattingRequestsForBold(boldDetections) {
  const requests = [];
  
  // 逆順で処理（後ろから削除しないと位置がずれる）
  for (let i = boldDetections.length - 1; i >= 0; i--) {
    const detection = boldDetections[i];
    console.log(`太字処理中: "${detection.innerText}" at ${detection.innerStart}-${detection.innerEnd}`);
    
    // 1. まず内側のテキストに太字スタイルを適用
    requests.push({
      updateTextStyle: {
        range: {
          startIndex: detection.innerStart,
          endIndex: detection.innerEnd
        },
        textStyle: {
          bold: true
        },
        fields: 'bold'
      }
    });
  }
  
  // 次に、すべての ** を削除（逆順）
  for (let i = boldDetections.length - 1; i >= 0; i--) {
    const detection = boldDetections[i];
    
    // 後ろの ** を削除（2文字）
    requests.push({
      deleteContentRange: {
        range: {
          startIndex: detection.endIndex - 2,
          endIndex: detection.endIndex
        }
      }
    });
    
    // 前の ** を削除（2文字）
    requests.push({
      deleteContentRange: {
        range: {
          startIndex: detection.startIndex,
          endIndex: detection.startIndex + 2
        }
      }
    });
  }
  
  return requests;
}

// メインの変換処理
async function convertMarkdown(tabUrl) {
  console.log('\n=== Markdown変換開始 ===');
  console.log('URL:', tabUrl);
  
  try {
    // 1. ドキュメントIDを取得
    const documentId = getDocumentIdFromUrl(tabUrl);
    if (!documentId) {
      throw new Error('ドキュメントIDを取得できませんでした');
    }
    console.log('✅ ドキュメントID:', documentId);
    
    // 2. 認証トークンを取得
    console.log('🔐 認証中...');
    const token = await getAuthToken();
    
    // 3. ドキュメントの内容を取得
    console.log('📥 ドキュメント取得中...');
    const doc = await getDocumentContent(documentId, token);
    console.log('✅ ドキュメント取得成功');
    
    // 4. テキストを抽出
    const text = extractText(doc);
    console.log('📝 テキスト抽出:', text.substring(0, 200) + '...');
    
    // 5. Markdown記法を検出（見出しとリスト）
    const detections = detectMarkdown(text);
    console.log('🔍 見出し/リスト検出:', detections.length + '個');
    
    // 6. 太字を検出
    const boldDetections = detectBoldMarkdown(doc);
    console.log('🔍 太字検出:', boldDetections.length + '個');
    
    if (detections.length === 0 && boldDetections.length === 0) {
      return {
        success: false,
        message: 'Markdown記法が見つかりませんでした'
      };
    }
    
    detections.forEach(d => {
      console.log(`  - ${d.type}: "${d.text.substring(0, 50)}..."`);
    });
    
    boldDetections.forEach(d => {
      console.log(`  - bold: "**${d.innerText}**"`);
    });
    
    // 7. 見出しとリストの書式を適用
    if (detections.length > 0) {
      const requests = createFormattingRequests(doc, detections);
      console.log('📋 見出し/リスト書式リクエスト:', requests.length + '個');
      console.log('✏️ 見出し/リスト書式適用中...');
      await applyFormatting(documentId, token, requests);
      console.log('✅ 見出し/リスト書式適用完了');
    }
    
    // 8. 太字の書式を適用（ドキュメントを再取得してから）
    if (boldDetections.length > 0) {
      console.log('📥 ドキュメント再取得中...');
      const docAfter = await getDocumentContent(documentId, token);
      const boldDetectionsAfter = detectBoldMarkdown(docAfter);
      console.log('🔍 太字再検出:', boldDetectionsAfter.length + '個');
      
      if (boldDetectionsAfter.length > 0) {
        const boldRequests = createFormattingRequestsForBold(boldDetectionsAfter);
        console.log('📋 太字書式リクエスト:', boldRequests.length + '個');
        console.log('✏️ 太字書式適用中...');
        await applyFormatting(documentId, token, boldRequests);
        console.log('✅ 太字書式適用完了');
      }
    }
    
    return {
      success: true,
      message: `${detections.length + boldDetections.length}個のMarkdown記法を変換しました`,
      details: {
        headings: detections.filter(d => d.type.startsWith('heading')).length,
        lists: detections.filter(d => d.type === 'bullet' || d.type === 'numbered').length,
        bold: boldDetections.length
      }
    };
    
  } catch (error) {
    console.error('❌ エラー:', error);
    return {
      success: false,
      message: 'エラー: ' + error.message
    };
  }
}

// メッセージリスナー
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === 'convertMarkdown') {
    console.log('📨 変換リクエスト受信');
    
    // 現在のタブのURLを取得
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      if (tabs[0]) {
        convertMarkdown(tabs[0].url)
          .then(result => {
            console.log('📤 変換結果:', result);
            sendResponse(result);
          })
          .catch(error => {
            console.error('❌ 変換エラー:', error);
            sendResponse({
              success: false,
              message: error.message
            });
          });
      }
    });
    
    return true; // 非同期レスポンス
  }
});