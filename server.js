const express = require('express');
const cors = require('cors');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const WebSocket = require('ws');

const app = express();
const port = process.env.PORT || 8080; // Zeabur uses port 8080

console.log(`Starting server on port ${port}`);

// Create WebSocket server
const wss = new WebSocket.Server({ noServer: true });

// Store tokens in memory (in production, use a proper database)
const validTokens = new Map();

// Store WebSocket connections by token
const wsConnections = new Map();

// Store SSE connections by token
const sseConnections = new Map();

// WebSocket connection handling
wss.on('connection', (ws, request) => {
  console.log('WebSocket connection attempt from:', request.url);
  
  try {
    const url = new URL(request.url, `http://${request.headers.host}`);
    const token = url.searchParams.get('token');
    
    console.log('Extracted token:', token);
    
    if (token) {
      wsConnections.set(token, ws);
      console.log(`WebSocket connected for token: ${token}`);
      console.log('Total active connections:', wsConnections.size);
      
      // Send confirmation message
      ws.send(JSON.stringify({
        type: 'CONNECTION_CONFIRMED',
        message: 'Connected successfully'
      }));
      
      ws.on('close', () => {
        wsConnections.delete(token);
        console.log(`WebSocket disconnected for token: ${token}`);
        console.log('Remaining connections:', wsConnections.size);
      });
      
      ws.on('error', (error) => {
        console.error(`WebSocket error for token ${token}:`, error);
        wsConnections.delete(token);
      });
    } else {
      console.log('No token provided, closing connection');
      ws.close(1008, 'Token required');
    }
  } catch (error) {
    console.error('Error parsing WebSocket URL:', error);
    ws.close(1011, 'Invalid URL');
  }
});

// Enable CORS with specific origin
app.use(cors({
  origin: ['chrome-extension://*', 'https://autofill-server.zeabur.app'],
  methods: ['GET', 'POST'],
  allowedHeaders: ['Content-Type', 'X-API-Key']
}));

app.use(express.json());

// Serve static files
app.use(express.static(path.join(__dirname, 'public')));

// Configure multer for file upload
const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    const uploadDir = path.join(__dirname, 'uploads');
    if (!fs.existsSync(uploadDir)) {
      fs.mkdirSync(uploadDir, { recursive: true });
    }
    cb(null, uploadDir);
  },
  filename: function (req, file, cb) {
    cb(null, Date.now() + path.extname(file.originalname));
  }
});

const upload = multer({ 
  storage: storage,
  limits: {
    fileSize: 5 * 1024 * 1024 // 5MB limit
  },
  fileFilter: (req, file, cb) => {
    // Accept only image files
    if (file.mimetype.startsWith('image/')) {
      cb(null, true);
    } else {
      cb(new Error('Only image files are allowed!'), false);
    }
  }
});

// Token validation middleware
const validateToken = (req, res, next) => {
  const token = req.query.token;
  if (!token) {
    return res.status(401).json({ message: 'Token is required' });
  }

  const tokenData = validTokens.get(token);
  if (!tokenData) {
    return res.status(401).json({ message: 'Invalid token' });
  }

  if (Date.now() > tokenData.expires) {
    validTokens.delete(token);
    return res.status(401).json({ message: 'Token has expired' });
  }

  next();
};

// Register token endpoint
app.post('/register-token', (req, res) => {
  const { token, expires } = req.body;
  if (!token || !expires) {
    return res.status(400).json({ message: 'Token and expiration time are required' });
  }

  validTokens.set(token, { expires });
  console.log(`Token registered: ${token}`);
  res.json({ message: 'Token registered successfully' });
});

// Health check endpoint
app.get('/health', (req, res) => {
  res.json({ 
    status: 'ok', 
    timestamp: new Date().toISOString(),
    connections: wsConnections.size
  });
});

// Routes
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'upload.html'));
});

app.get('/test', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'test.html'));
});

app.get('/upload', validateToken, (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'upload.html'));
});

app.post('/upload', validateToken, upload.single('file'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ message: 'No file uploaded' });
    }

    const apiKey = req.headers['x-api-key'];
    if (!apiKey) {
      return res.status(401).json({ message: 'API key is required' });
    }

    // Log API key for debugging (remove in production)
    console.log('API Key received:', apiKey.substring(0, 10) + '...');

    // Read file and convert to base64
    const fileBuffer = fs.readFileSync(req.file.path);
    const base64Image = fileBuffer.toString('base64');

    // Enhanced prompt for flexible document analysis
    const analysisPrompt = `請仔細分析這份文件，並提取所有可能的資訊。

請以結構化JSON格式回傳結果，格式如下：
{
  "documentType": "文件類型（如：身分證、護照、駕照、發票、收據、名片、證書、表格等）",
  "confidence": 分析信心度（0-100的數字）,
  "extractedData": {
    // 請根據文件內容自由定義Key-Value對
    // 例如：
    // "姓名": "張三",
    // "身分證號": "A123456789",
    // "出生日期": "1990-01-01",
    // "地址": "台北市信義區信義路五段7號",
    // "電話": "0912345678",
    // "電子郵件": "example@email.com",
    // "公司名稱": "某某公司",
    // "職位": "工程師",
    // "金額": "1000",
    // "貨幣": "TWD",
    // "發票號碼": "AB-12345678",
    // "發票日期": "2024-01-01",
    // "統一編號": "12345678",
    // "條碼": "1234567890123",
    // 等等...
  },
  "rawText": "原始文字內容（如果無法結構化）",
  "notes": "任何額外的分析註解或說明"
}

重要說明：
1. 請根據文件內容自由定義Key-Value對，不要受限於預設的欄位名稱
2. 使用中文作為Key名稱，讓使用者容易理解
3. 只包含實際在文件中找到的資訊，如果某個欄位沒有找到請省略
4. 對於敏感資訊（如卡號），請進行適當遮蔽
5. 確保回傳的是有效的JSON格式
6. 如果無法識別文件類型，請標記為 "未知文件"
7. 分析信心度表示對整體識別結果的信心程度
8. 在extractedData中，請盡可能詳細地提取所有可見的資訊

請開始分析文件：`;

    // Call Gemini API using REST
    const geminiResponse = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-pro-vision:generateContent?key=${apiKey}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        contents: [
          {
            parts: [
              {
                text: analysisPrompt
              },
              {
                inline_data: {
                  mime_type: req.file.mimetype,
                  data: base64Image
                }
              }
            ]
          }
        ],
        generationConfig: {
          temperature: 0.1,
          topK: 32,
          topP: 1,
          maxOutputTokens: 4096,
        }
      })
    });

    if (!geminiResponse.ok) {
      const errorData = await geminiResponse.json();
      console.error('Gemini API Error:', errorData);
      throw new Error(`Gemini API error: ${errorData.error?.message || geminiResponse.statusText}`);
    }

    const geminiData = await geminiResponse.json();
    
    if (!geminiData.candidates || !geminiData.candidates[0] || !geminiData.candidates[0].content) {
      throw new Error('Invalid response from Gemini API');
    }

    let text = geminiData.candidates[0].content.parts[0].text;
    
    // Try to parse the response as JSON
    let parsedResults;
    try {
      // Clean up the response text (remove markdown code blocks if present)
      text = text.replace(/```json\s*/g, '').replace(/```\s*$/g, '').trim();
      parsedResults = JSON.parse(text);
    } catch (parseError) {
      console.log('Failed to parse as JSON, treating as raw text');
      // If parsing fails, create a structured object with raw text
      parsedResults = {
        documentType: "Unknown",
        confidence: 0,
        rawText: text,
        otherInfo: {
          notes: "Raw extracted text (JSON parsing failed)"
        }
      };
    }

    // Clean up uploaded file
    fs.unlinkSync(req.file.path);

    // Delete token after successful upload
    validTokens.delete(req.query.token);

    // Send results via WebSocket if connection exists
    const ws = wsConnections.get(req.query.token);
    console.log('Looking for WebSocket connection for token:', req.query.token);
    console.log('Available WebSocket connections:', Array.from(wsConnections.keys()));
    
    if (ws && ws.readyState === WebSocket.OPEN) {
      const message = JSON.stringify({
        type: 'SCAN_RESULTS',
        results: parsedResults
      });
      
      console.log('Sending results via WebSocket:', message.substring(0, 100) + '...');
      
      ws.send(message, (error) => {
        if (error) {
          console.error('Error sending WebSocket message:', error);
        } else {
          console.log('Results sent via WebSocket successfully');
        }
        // Close connection after sending
        wsConnections.delete(req.query.token);
        ws.close();
        console.log('WebSocket connection closed after sending results');
      });
    } else {
      console.log('No active WebSocket connection found for token:', req.query.token);
      if (ws) {
        console.log('WebSocket state:', ws.readyState);
      }
    }

    // Also try SSE connection
    const sse = sseConnections.get(req.query.token);
    console.log('Available SSE connections:', Array.from(sseConnections.keys()));
    
    if (sse) {
      const message = JSON.stringify({
        type: 'SCAN_RESULTS',
        results: parsedResults
      });
      
      console.log('Sending results via SSE:', message.substring(0, 100) + '...');
      
      try {
        sse.write(`data: ${message}\n\n`);
        console.log('Results sent via SSE successfully');
        // Close SSE connection after sending
        sseConnections.delete(req.query.token);
        sse.end();
        console.log('SSE connection closed after sending results');
      } catch (error) {
        console.error('Error sending SSE message:', error);
      }
    } else {
      console.log('No active SSE connection found for token:', req.query.token);
    }

    res.json({
      success: true,
      results: parsedResults
    });
  } catch (error) {
    console.error('Error:', error);
    // Clean up file if it exists
    if (req.file && fs.existsSync(req.file.path)) {
      fs.unlinkSync(req.file.path);
    }
    res.status(500).json({
      success: false,
      message: error.message || 'An error occurred during processing'
    });
  }
});

// SSE endpoint for results
app.get('/sse/:token', (req, res) => {
  const token = req.params.token;
  
  if (!token) {
    return res.status(400).json({ message: 'Token is required' });
  }

  // Set SSE headers
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    'Connection': 'keep-alive',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Cache-Control'
  });

  // Send initial connection message
  res.write(`data: ${JSON.stringify({ type: 'CONNECTION_CONFIRMED', message: 'Connected successfully' })}\n\n`);

  // Store connection
  sseConnections.set(token, res);
  console.log(`SSE connected for token: ${token}`);

  // Handle client disconnect
  req.on('close', () => {
    sseConnections.delete(token);
    console.log(`SSE disconnected for token: ${token}`);
  });
});

// Error handling middleware
app.use((err, req, res, next) => {
  console.error('Error:', err);
  res.status(500).json({
    success: false,
    message: err.message || 'An error occurred'
  });
});

// Create HTTP server
const server = app.listen(port, () => {
  console.log(`Server is running on port ${port}`);
  console.log(`Health check available at: http://localhost:${port}/health`);
});

// Attach WebSocket server to HTTP server
server.on('upgrade', (request, socket, head) => {
  console.log('WebSocket upgrade request:', request.url);
  wss.handleUpgrade(request, socket, head, (ws) => {
    wss.emit('connection', ws, request);
  });
});

// Graceful shutdown
process.on('SIGTERM', () => {
  console.log('SIGTERM received, shutting down gracefully...');
  server.close(() => {
    console.log('HTTP server closed');
    wss.close(() => {
      console.log('WebSocket server closed');
      process.exit(0);
    });
  });
});

process.on('SIGINT', () => {
  console.log('SIGINT received, shutting down gracefully...');
  server.close(() => {
    console.log('HTTP server closed');
    wss.close(() => {
      console.log('WebSocket server closed');
      process.exit(0);
    });
  });
}); 