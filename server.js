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

    // Call Gemini API using REST
    const geminiResponse = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${apiKey}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        contents: [
          {
            parts: [
              {
                text: `Analyze this document and extract all information in a structured JSON format. 
                
Please return the results as a valid JSON object with the following structure:
{
  "documentType": "type of document (e.g., ID card, invoice, receipt, form, etc.)",
  "personalInfo": {
    "fullName": "extracted full name if found",
    "firstName": "first name if found",
    "lastName": "last name if found",
    "dateOfBirth": "date of birth if found"
  },
  "contactInfo": {
    "email": "email address if found",
    "phone": "phone number if found",
    "mobile": "mobile number if found"
  },
  "addressInfo": {
    "street": "street address if found",
    "city": "city if found",
    "state": "state/province if found",
    "zipCode": "zip/postal code if found",
    "country": "country if found"
  },
  "financialInfo": {
    "amount": "amount if found",
    "currency": "currency if found",
    "accountNumber": "account number if found",
    "cardNumber": "card number if found (masked for security)"
  },
  "dates": {
    "issueDate": "issue date if found",
    "expiryDate": "expiry date if found",
    "createdDate": "created date if found"
  },
  "otherInfo": {
    "documentNumber": "document number if found",
    "organization": "organization/company if found",
    "notes": "any other relevant information"
  },
  "rawText": "complete extracted text as fallback"
}

Only include fields that are actually found in the document. If a field is not found, omit it from the JSON. Ensure the response is valid JSON that can be parsed.`
              },
              {
                inline_data: {
                  mime_type: req.file.mimetype,
                  data: base64Image
                }
              }
            ]
          }
        ]
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
      } catch (error) {
        console.error('Error sending SSE message:', error);
      }
    } else {
      console.log('No active SSE connection found for token:', req.query.token);
    }

    // Clean up connections after sending results
    if (ws) {
      wsConnections.delete(req.query.token);
      ws.close();
      console.log('WebSocket connection cleaned up');
    }
    
    if (sse) {
      sseConnections.delete(req.query.token);
      sse.end();
      console.log('SSE connection cleaned up');
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