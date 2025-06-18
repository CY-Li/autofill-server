const express = require('express');
const cors = require('cors');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const { GoogleGenerativeAI } = require('@google/generative-ai');

const app = express();
const port = process.env.PORT || 3000;

// Store tokens in memory (in production, use a proper database)
const validTokens = new Map();

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
  res.json({ message: 'Token registered successfully' });
});

// Routes
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'upload.html'));
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

    // Initialize Gemini API
    const genAI = new GoogleGenerativeAI(apiKey);
    const model = genAI.getGenerativeModel({ model: 'gemini-pro-vision' });

    // Read file and convert to base64
    const fileBuffer = fs.readFileSync(req.file.path);
    const base64Image = fileBuffer.toString('base64');

    // Call Gemini API
    const result = await model.generateContent([
      'Analyze this document and extract all text content. Return the results in a structured format.',
      {
        inlineData: {
          mimeType: req.file.mimetype,
          data: base64Image
        }
      }
    ]);

    const response = await result.response;
    const text = response.text();

    // Clean up uploaded file
    fs.unlinkSync(req.file.path);

    // Delete token after successful upload
    validTokens.delete(req.query.token);

    res.json({
      success: true,
      results: text
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

// Error handling middleware
app.use((err, req, res, next) => {
  console.error('Error:', err);
  res.status(500).json({
    success: false,
    message: err.message || 'An error occurred'
  });
});

// Start server
app.listen(port, () => {
  console.log(`Server is running on port ${port}`);
}); 